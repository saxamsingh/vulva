#!/usr/bin/env python3
"""
Production-ready GitHub Heartbeat Bot Daemon (Python)
Uses schedule + GitPython
"""

import os
import sys
import time
import signal
import random
import logging
import datetime
from pathlib import Path
from urllib.parse import urlparse, urlunparse

try:
    import psutil
except ImportError:
    psutil = None

import schedule
from dotenv import load_dotenv
from git import Repo, GitCommandError

# Load environment variables
load_dotenv()

# Configuration
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()
REPO_URL = os.getenv("REPO_URL", "").strip()
BRANCH_NAME = os.getenv("BRANCH_NAME", "main").strip()
COMMIT_USERNAME = os.getenv("COMMIT_USERNAME", "github-actions[bot]").strip()
COMMIT_EMAIL = os.getenv("COMMIT_EMAIL", "github-actions[bot]@users.noreply.github.com").strip()
REPO_DIR = os.path.abspath(os.getenv("REPO_DIR", "./repo"))
LOG_FILE_NAME = os.getenv("LOG_FILE_NAME", "activity-log.txt").strip()
RUN_ON_STARTUP = os.getenv("RUN_ON_STARTUP", "true").lower() in ("true", "1", "yes")
INTERVAL_MINUTES = int(os.getenv("INTERVAL_MINUTES", "10"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
RETRY_DELAY_SECONDS = float(os.getenv("RETRY_DELAY_MS", "2000")) / 1000.0


class RedactingFormatter(logging.Formatter):
    """Custom logging formatter to prevent token leakage in logs."""

    def __init__(self, fmt=None, datefmt=None, secrets=None):
        super().__init__(fmt, datefmt)
        self.secrets = [s for s in (secrets or []) if s and len(s) > 3]

    def format(self, record):
        orig_msg = super().format(record)
        for secret in self.secrets:
            orig_msg = orig_msg.replace(secret, "***REDACTED***")
        return orig_msg


# Setup sanitized logging
logger = logging.getLogger("HeartbeatBot")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(
    RedactingFormatter(
        fmt="[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
        secrets=[GITHUB_TOKEN],
    )
)
logger.addHandler(handler)


def build_authenticated_url(raw_url: str, token: str) -> str:
    """Builds an authenticated Git clone/push URL."""
    if not token or raw_url.startswith("file://") or os.path.isabs(raw_url):
        return raw_url

    clean = raw_url.strip()
    if clean.startswith("git@"):
        clean = clean.replace("git@", "https://").replace("github.com:", "github.com/")

    if not clean.startswith("http://") and not clean.startswith("https://"):
        clean = "https://" + clean

    parsed = urlparse(clean)
    netloc = f"x-access-token:{token}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"

    path = parsed.path
    if not path.endswith(".git"):
        path += ".git"

    return urlunparse(("https", netloc, path, "", "", ""))


def validate_config():
    missing = []
    if not GITHUB_TOKEN:
        missing.append("GITHUB_TOKEN")
    if not REPO_URL:
        missing.append("REPO_URL")
    if not BRANCH_NAME:
        missing.append("BRANCH_NAME")
    if not COMMIT_USERNAME:
        missing.append("COMMIT_USERNAME")
    if not COMMIT_EMAIL:
        missing.append("COMMIT_EMAIL")

    if missing:
        logger.error(f"Missing required configuration: {', '.join(missing)}")
        sys.exit(1)


heartbeat_counter = 0


def get_status_metric(timestamp_iso: str) -> str:
    global heartbeat_counter
    heartbeat_counter += 1

    memory_mb = "N/A"
    uptime_sec = "N/A"
    if psutil:
        proc = psutil.Process()
        memory_mb = f"{proc.memory_info().rss // (1024 * 1024)}MB"
        uptime_sec = f"{int(time.time() - proc.create_time())}s"

    return (
        f"[{timestamp_iso}] Heartbeat #{heartbeat_counter} | "
        f"Status: OK | Memory: {memory_mb} | Uptime: {uptime_sec} | Python: {sys.version.split()[0]}\n"
    )


class GitBot:
    def __init__(self):
        self.repo = None
        self.auth_url = build_authenticated_url(REPO_URL, GITHUB_TOKEN)
        self.is_executing = False
        self.is_shutting_down = False

    def init_repo(self):
        logger.info(f"Initializing repository at {REPO_DIR}")
        os.makedirs(REPO_DIR, exist_ok=True)

        git_dir = os.path.join(REPO_DIR, ".git")
        if not os.path.isdir(git_dir):
            logger.info("Cloning repository...")
            try:
                self.repo = Repo.clone_from(self.auth_url, REPO_DIR, branch=BRANCH_NAME)
                logger.info(f"Cloned branch '{BRANCH_NAME}' successfully.")
            except Exception as e:
                logger.warning(f"Could not clone branch '{BRANCH_NAME}' ({e}). Cloning default branch...")
                try:
                    self.repo = Repo.clone_from(self.auth_url, REPO_DIR)
                except Exception as inner_e:
                    logger.warning("Empty remote. Initializing local repository...")
                    self.repo = Repo.init(REPO_DIR)
                    self.repo.create_remote("origin", self.auth_url)
        else:
            self.repo = Repo(REPO_DIR)
            try:
                origin = self.repo.remotes.origin
                origin.set_url(self.auth_url)
            except Exception:
                self.repo.create_remote("origin", self.auth_url)

        with self.repo.config_writer() as cw:
            cw.set_value("user", "name", COMMIT_USERNAME)
            cw.set_value("user", "email", COMMIT_EMAIL)
            cw.release()

        # Switch / create branch
        try:
            if self.repo.active_branch.name != BRANCH_NAME:
                if BRANCH_NAME in self.repo.heads:
                    self.repo.heads[BRANCH_NAME].checkout()
                else:
                    self.repo.create_head(BRANCH_NAME).checkout()
        except TypeError:
            # Detached head or empty repository
            if BRANCH_NAME not in self.repo.heads:
                self.repo.create_head(BRANCH_NAME).checkout()

        logger.info(f"Repository ready on branch '{BRANCH_NAME}'.")

    def pull_latest(self):
        logger.info(f"Pulling latest changes from origin/{BRANCH_NAME} with rebase...")
        try:
            self.repo.git.pull("origin", BRANCH_NAME, rebase=True, autostash=True)
            logger.info("Pull complete. Working tree is up-to-date.")
        except GitCommandError as e:
            err_str = str(e)
            if "couldn't find remote ref" in err_str or "no tracking information" in err_str:
                logger.info("Remote branch does not exist yet. Will create on first push.")
            else:
                logger.warning(f"Pull rebase issue: {e}")
                try:
                    self.repo.git.rebase("--abort")
                except Exception:
                    pass

    def push_with_retry(self):
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info(f"Pushing to origin/{BRANCH_NAME} (Attempt {attempt}/{MAX_RETRIES})...")
                self.repo.git.push("origin", BRANCH_NAME, set_upstream=True)
                logger.info(f"Successfully pushed to origin/{BRANCH_NAME}!")
                return
            except GitCommandError as e:
                if attempt == MAX_RETRIES:
                    logger.error(f"All {MAX_RETRIES} push attempts failed: {e}")
                    raise

                delay = RETRY_DELAY_SECONDS * (2 ** (attempt - 1)) + random.uniform(0.1, 0.5)
                logger.warning(f"Push failed. Retrying in {delay:.2f}s... (Error: {e})")
                time.sleep(delay)
                try:
                    self.repo.git.pull("origin", BRANCH_NAME, rebase=True)
                except Exception:
                    pass

    def run_cycle(self):
        if self.is_shutting_down:
            return
        if self.is_executing:
            logger.warning("Previous cycle is still running. Skipping overlapping execution.")
            return

        self.is_executing = True
        iso_timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        commit_message = f"chore(bot): automated heartbeat commit [{iso_timestamp}]"
        log_file_path = os.path.join(REPO_DIR, LOG_FILE_NAME)

        try:
            logger.info(f"=== Starting Heartbeat Cycle at {iso_timestamp} ===")
            self.pull_latest()

            metric_line = get_status_metric(iso_timestamp)
            with open(log_file_path, "a", encoding="utf-8") as f:
                f.write(metric_line)
            logger.info(f"Appended entry to {LOG_FILE_NAME}")

            self.repo.git.add(LOG_FILE_NAME)
            if not self.repo.is_dirty(untracked_files=False):
                logger.info("No changes to commit.")
                return

            commit = self.repo.index.commit(commit_message)
            logger.info(f"Created commit [{commit.hexsha[:7]}]: '{commit_message}'")

            self.push_with_retry()
            logger.info(f"=== Heartbeat Cycle Completed Successfully [{iso_timestamp}] ===\n")
        except Exception as e:
            logger.error(f"Heartbeat cycle failed: {e}")
        finally:
            self.is_executing = False


def main():
    validate_config()
    bot = GitBot()
    bot.init_repo()

    def handle_signal(sig, frame):
        logger.info(f"Received signal {sig}. Gracefully shutting down...")
        bot.is_shutting_down = True
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    if RUN_ON_STARTUP:
        logger.info("Executing initial startup heartbeat...")
        bot.run_cycle()

    logger.info(f"Scheduling heartbeat every {INTERVAL_MINUTES} minutes.")
    schedule.every(INTERVAL_MINUTES).minutes.do(bot.run_cycle)

    while not bot.is_shutting_down:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
