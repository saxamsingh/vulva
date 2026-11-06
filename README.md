# 🤖 GitHub Heartbeat Bot

A lightweight, production-ready GitHub bot that automatically creates and pushes commits to a target repository every 10 minutes.

This repository provides **two complete implementation options**:
- **Option A: Serverless via GitHub Actions** (Zero-infrastructure, runs inside GitHub's free scheduled workflows).
- **Option B: Standalone Daemon (Node.js & Python)** (Continuous background service or Docker container with network retries, merge conflict prevention, and token-masked logging).

---

## 📊 Comparison Matrix

| Feature | Option A: GitHub Actions | Option B: Standalone Daemon (Node.js / Python) |
| :--- | :--- | :--- |
| **Hosting Cost** | $0 (Free GitHub Actions minutes) | Minimal (local machine, Raspberry Pi, VPS, AWS ECS/EC2) |
| **Infrastructure** | Fully serverless | Requires Docker or Node.js / Python runtime |
| **Cron Precision** | ±5 to 15 mins jitter (GitHub shared queue) | Exact (fires precisely every 10 minutes) |
| **Inactivity Pause** | Disables after 60 days on inactive public repos | Runs 24/7 indefinitely without interruption |
| **Target Repository** | Operates on the host repository | Can commit to *any* remote repository via token |
| **Metric Logging** | Basic UTC timestamp in `heartbeat.log` | Rich system metrics (uptime, memory, platform) in `activity-log.txt` |
| **Push Failure Retry** | Fails the run, waits for next cron cycle | Exponential backoff (3 attempts with rebase recovery) |

---

## ⚡ Option A: Serverless via GitHub Actions

Option A requires zero servers. It runs directly inside GitHub's infrastructure using `.github/workflows/auto-commit.yml`.

### How It Works
1. Runs every 10 minutes via cron: `*/10 * * * *` (UTC).
2. Pulls with `--rebase` to prevent merge conflicts.
3. Appends an ISO UTC timestamp entry to `heartbeat.log`.
4. Commits with message `chore(bot): automated heartbeat commit [<TIMESTAMP>]`.
5. Pushes back to the repository using the built-in `GITHUB_TOKEN`.

### Setup Instructions
1. Push this repository (or copy `.github/workflows/auto-commit.yml`) to your GitHub repository.
2. Grant GitHub Actions write permissions:
   - Navigate to your repository on GitHub.
   - Go to **Settings** → **Actions** → **General**.
   - Under **Workflow permissions**, select **Read and write permissions**.
   - Click **Save**.
3. **Manual Verification**:
   - Go to the **Actions** tab in your repository.
   - Select **Automated Heartbeat Commit**.
   - Click **Run workflow** → **Run workflow** to test it immediately without waiting for the 10-minute cron trigger.

> [!NOTE]
> **GitHub Actions Cron Notice**: GitHub schedules cron jobs on a shared queue. During peak load, jobs may experience a 3–15 minute delay. If your repository is public and receives no commits for 60 days, GitHub will temporarily pause scheduled workflows until manually triggered. If strict timing is critical, use **Option B**.

---

## 🚀 Option B: Standalone Daemon (Node.js / Docker)

Option B is an autonomous service designed for 24/7 uptime on Docker, a VPS, or a local server.

### Key Architecture Features
- **Merge Conflict Prevention**: Executes `git pull --rebase origin <BRANCH_NAME>` prior to staging and committing.
- **Push Failure Retry Logic**: If network fails during `git push`, the daemon uses exponential backoff (e.g. 2s, 4s, 8s) and executes a rebase check before retrying.
- **Strict Secret Redaction**: The `logger` masks `GITHUB_TOKEN` and HTTP credentials so secrets can never be leaked to terminal output or logs.
- **Safe Concurrency & Shutdown**: Prevents overlapping execution cycles and handles `SIGINT` / `SIGTERM` gracefully.
- **Status Metrics**: Appends ISO timestamps along with process memory and uptime metrics to `activity-log.txt`.

---

### Step 1: Create a GitHub Personal Access Token (PAT)
1. Go to [GitHub Token Settings](https://github.com/settings/tokens).
2. Choose either:
   - **Fine-grained Personal Access Token** (Recommended): Set repository access to your target repository, and grant **Read and write** permissions to **Contents**.
   - **Classic Personal Access Token**: Check the `repo` scope.
3. Copy the generated token (`ghp_...`).

---

### Step 2: Configure Environment Variables

Create a `.env` file in the project root by copying the template:

```bash
cp .env.example .env
```

Edit `.env` with your repository settings:

```dotenv
# Required Configuration
GITHUB_TOKEN=ghp_yourActualGitHubTokenHere
REPO_URL=https://github.com/your-username/your-target-repo.git
BRANCH_NAME=main
COMMIT_USERNAME=github-actions[bot]
COMMIT_EMAIL=github-actions[bot]@users.noreply.github.com

# Optional Customizations
CRON_SCHEDULE=*/10 * * * *
REPO_DIR=./repo
LOG_FILE_NAME=activity-log.txt
RUN_ON_STARTUP=true
MAX_RETRIES=3
RETRY_DELAY_MS=2000
```

---

### Step 3: Deployment Methods

#### Method 1: One-Click Docker Compose (Recommended)

Requires [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/).

```bash
# 1. Build and start the container in detached mode
docker compose up -d

# 2. View live streaming logs
docker compose logs -f

# 3. Stop the daemon
docker compose down
```

*The `bot-repo-data` volume safely persists the cloned repository and git index across container restarts.*

---

#### Method 2: Standalone Node.js Service

Requires Node.js 18+ (tested on Node.js 20, 22, and 24).

```bash
# 1. Install dependencies
npm install

# 2. Run an instant one-off test commit
npm run test:commit

# 3. Start the continuous daemon
npm start
```

For development with live reloading:
```bash
npm run dev
```

---

#### Method 3: Standalone Python Service (Alternative)

A complete Python implementation using `schedule` and `GitPython` is provided in the `python/` directory:

```bash
# 1. Navigate to the python directory
cd python

# 2. Install requirements
pip install -r requirements.txt

# 3. Start Python bot daemon
python bot.py
```

*Or run the Python Dockerfile:*
```bash
docker build -t github-bot-python -f python/Dockerfile .
docker run -d --env-file .env -v bot-python-data:/app/repo github-bot-python
```

---

## 📁 Repository Structure

```
.
├── .github/
│   └── workflows/
│       └── auto-commit.yml      # Option A: Serverless GitHub Actions cron workflow
├── src/
│   ├── bot.js                   # Option B: Scheduler, concurrency lock & signal handlers
│   ├── config.js                # Option B: Configuration validator & URL builder
│   ├── gitService.js            # Option B: Git clone, pull-rebase, commit & push retry
│   └── logger.js                # Option B: Sanitized console logger (redacts GITHUB_TOKEN)
├── python/                      # Python daemon implementation
│   ├── bot.py                   # GitPython + schedule daemon
│   ├── requirements.txt         # Python dependencies
│   └── Dockerfile               # Python container definition
├── index.js                     # Node.js application entry point
├── package.json                 # Node.js dependencies and scripts
├── Dockerfile                   # Production Alpine Node.js container
├── docker-compose.yml           # Multi-platform container deployment
├── .env.example                 # Configuration environment template
├── .gitignore                   # Ignore node_modules, .env, and local repositories
└── README.md                    # Documentation
```

---

## 🛠️ Verification & Testing

### How to test Option B immediately:
Set `RUN_ON_STARTUP=true` in your `.env` (enabled by default). When you run:
```bash
npm start
```
The bot will:
1. Initialize/clone the target repository.
2. Pull latest changes.
3. Append a heartbeat status entry to `activity-log.txt`.
4. Create the commit `chore(bot): automated heartbeat commit [2026-11-06T...]`.
5. Push to the remote branch.
6. Arm the `node-cron` schedule to repeat every 10 minutes.

### Example Console Log Output:
```
[2026-11-06T05:59:42.522Z] [INFO] Initializing Git workspace at /app/repo
[2026-11-06T05:59:42.937Z] [SUCCESS] Cloned default branch successfully.
[2026-11-06T05:59:43.826Z] [SUCCESS] Git repository ready on branch 'main'.
[2026-11-06T05:59:43.826Z] [INFO] === Starting Heartbeat Cycle at 2026-11-06T05:59:43.826Z ===
[2026-11-06T05:59:43.826Z] [INFO] Pulling latest changes from origin/main (rebase mode)...
[2026-11-06T05:59:44.011Z] [INFO] Repository is up to date.
[2026-11-06T05:59:44.012Z] [INFO] Appended entry to activity-log.txt
[2026-11-06T05:59:44.329Z] [SUCCESS] Created commit [f89ed71]: "chore(bot): automated heartbeat commit [2026-11-06T05:59:43.826Z]"
[2026-11-06T05:59:44.329Z] [INFO] Pushing to origin/main (Attempt 1/3)...
[2026-11-06T05:59:44.633Z] [SUCCESS] Successfully pushed commit to origin/main!
[2026-11-06T05:59:44.633Z] [SUCCESS] === Heartbeat Cycle Completed Successfully [2026-11-06T05:59:43.826Z] ===
[2026-11-06T05:59:44.634Z] [SUCCESS] Heartbeat Bot is actively running in background.
```

---

## 🛡️ Production & Security Considerations

1. **Token Protection**: Never commit your `.env` file. The repository's `.gitignore` explicitly excludes `.env` and `repo/`.
2. **Secret Redaction**: The logger automatically filters registered tokens and URL credentials before writing to `stdout` or `stderr`.
3. **Branch Protection**: If the target branch has branch protection rules (e.g. required PR reviews or linear history), ensure the GitHub token's account has admin bypass permissions or point the bot to a designated automation branch.
4. **Git Dubious Ownership**: The Dockerfile automatically runs `git config --system --add safe.directory "*"` to prevent permissions issues when volume mounting into Linux containers.

---

## 📄 License
MIT
