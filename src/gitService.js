import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import { config } from './config.js';
import { logger } from './logger.js';

let heartbeatCounter = 0;

/**
 * Sleep helper for retry backoff
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a human-readable status metric entry
 * @param {string} isoTimestamp
 * @returns {string}
 */
function formatHeartbeatMetric(isoTimestamp) {
  heartbeatCounter += 1;
  const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const uptimeMinutes = (process.uptime() / 60).toFixed(1);
  return `[${isoTimestamp}] Heartbeat #${heartbeatCounter} | Status: Healthy | Uptime: ${uptimeMinutes}m | Memory: ${memoryMB}MB | Platform: ${process.platform}\n`;
}

/**
 * Service to manage Git repository synchronization, commits, and pushes
 */
export class GitService {
  constructor() {
    this.repoDir = config.repoDir;
    this.git = null;
  }

  /**
   * Initializes the repository workspace. Clones if not present or configures existing.
   */
  async initialize() {
    logger.info(`Initializing Git workspace at ${this.repoDir}`);

    const isGitRepo = fs.existsSync(path.join(this.repoDir, '.git'));

    if (!isGitRepo) {
      if (!fs.existsSync(this.repoDir)) {
        fs.mkdirSync(this.repoDir, { recursive: true });
      }

      logger.info(`Repository not found locally. Cloning from ${config.repoUrl}...`);
      const baseGit = simpleGit();

      try {
        await baseGit.clone(config.authenticatedRepoUrl, this.repoDir, [
          '--branch',
          config.branchName,
          '--single-branch',
        ]);
        logger.success(`Cloned branch '${config.branchName}' successfully.`);
      } catch (cloneErr) {
        logger.warn(
          `Could not clone specific branch '${config.branchName}' (might be a fresh repository). Attempting standard clone...`
        );
        try {
          await baseGit.clone(config.authenticatedRepoUrl, this.repoDir);
          logger.success('Cloned default branch successfully.');
        } catch (err) {
          logger.warn('Remote repository might be empty or uninitialized. Initializing local repository...');
          const localGit = simpleGit(this.repoDir);
          await localGit.init();
          await localGit.addRemote('origin', config.authenticatedRepoUrl);
        }
      }
    }

    this.git = simpleGit(this.repoDir);

    // Update origin remote with authenticated URL (ensures tokens remain fresh)
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (origin) {
        await this.git.remote(['set-url', 'origin', config.authenticatedRepoUrl]);
      } else {
        await this.git.addRemote('origin', config.authenticatedRepoUrl);
      }
    } catch (remoteErr) {
      logger.warn(`Could not update remote URL: ${remoteErr.message}`);
    }

    // Configure local git user identity (scoped to this repository)
    await this.git.addConfig('user.name', config.commitUsername, false, 'local');
    await this.git.addConfig('user.email', config.commitEmail, false, 'local');
    // Ensure line endings are handled reliably
    await this.git.addConfig('core.autocrlf', 'input', false, 'local');

    // Ensure we are on target branch
    try {
      const status = await this.git.status();
      if (status.current !== config.branchName) {
        logger.info(`Switching branch from '${status.current}' to '${config.branchName}'...`);
        const branchSummary = await this.git.branchLocal();
        if (branchSummary.all.includes(config.branchName)) {
          await this.git.checkout(config.branchName);
        } else {
          await this.git.checkoutLocalBranch(config.branchName);
        }
      }
    } catch (branchErr) {
      logger.warn(`Branch configuration warning: ${branchErr.message}`);
    }

    logger.success(`Git repository ready on branch '${config.branchName}'.`);
  }

  /**
   * Pulls latest changes from remote to avoid merge conflicts
   */
  async pullLatest() {
    logger.info(`Pulling latest changes from origin/${config.branchName} (rebase mode)...`);
    try {
      await this.git.pull('origin', config.branchName, ['--rebase', '--autostash']);
      logger.info('Repository is up to date.');
    } catch (pullErr) {
      const msg = pullErr.message || '';
      if (
        msg.includes("couldn't find remote ref") ||
        msg.includes("fatal: couldn't find remote ref") ||
        msg.includes('no tracking information') ||
        msg.includes('does not appear to be a git repository') ||
        msg.includes('fatal: couldn\'t find remote ref') ||
        msg.includes('Couldn\'t find remote ref') ||
        msg.includes('does not have any commits yet')
      ) {
        logger.info(`Remote branch '${config.branchName}' not yet published or empty. Proceeding with initial commit.`);
      } else {
        logger.warn(`Pull with rebase encountered an issue: ${msg}. Attempting recovery...`);
        try {
          await this.git.rebase(['--abort']);
        } catch {}
        // If abort fails or pull failed for other non-fatal reasons, don't crash
        // but log and allow the cycle to attempt staging and pushing if appropriate
      }
    }
  }

  /**
   * Pushes commits to remote repository with exponential backoff retry logic
   */
  async pushWithRetry() {
    const maxRetries = config.maxRetries;
    const baseDelay = config.retryDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Pushing to origin/${config.branchName} (Attempt ${attempt}/${maxRetries})...`);
        const pushResult = await this.git.push('origin', config.branchName, ['--set-upstream']);
        logger.success(`Successfully pushed commit to origin/${config.branchName}!`);
        return pushResult;
      } catch (err) {
        if (attempt === maxRetries) {
          logger.error(`All ${maxRetries} push attempts failed.`, err);
          throw err;
        }

        const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 400);
        logger.retry(attempt, maxRetries, delay, err.message);
        await sleep(delay);

        // Before retrying push, attempt a pull rebase in case a concurrent commit was added
        try {
          logger.info('Attempting pull rebase before retrying push...');
          await this.git.pull('origin', config.branchName, ['--rebase']);
        } catch (rebaseErr) {
          logger.warn(`Pre-push pull rebase failed: ${rebaseErr.message}`);
        }
      }
    }
  }

  /**
   * Executes a full heartbeat cycle:
   * 1. Pull latest changes
   * 2. Append timestamp & metric to activity-log.txt
   * 3. Stage activity-log.txt
   * 4. Commit with exact message 'chore(bot): automated heartbeat commit [timestamp]'
   * 5. Push with retry logic
   *
   * @returns {Promise<{ success: boolean, timestamp: string, commitHash?: string, error?: Error }>}
   */
  async executeHeartbeatCycle() {
    const isoTimestamp = new Date().toISOString();
    const logFilePath = path.join(this.repoDir, config.logFileName);
    const commitMessage = `chore(bot): automated heartbeat commit [${isoTimestamp}]`;

    logger.info(`=== Starting Heartbeat Cycle at ${isoTimestamp} ===`);

    try {
      // Step 1: Pull latest changes
      await this.pullLatest();

      // Step 2: Append ISO timestamp and status metric to log file
      const entry = formatHeartbeatMetric(isoTimestamp);
      fs.appendFileSync(logFilePath, entry, { encoding: 'utf-8' });
      logger.info(`Appended entry to ${config.logFileName}`);

      // Step 3: Stage the file
      await this.git.add(config.logFileName);

      // Verify staged changes
      const status = await this.git.status();
      if (status.staged.length === 0) {
        logger.warn('No changes detected to commit.');
        return { success: true, timestamp: isoTimestamp, skipped: true };
      }

      // Step 4: Commit with specified message
      const commitResult = await this.git.commit(commitMessage);
      const commitHash = commitResult.commit || 'unknown';
      logger.success(`Created commit [${commitHash}]: "${commitMessage}"`);

      // Step 5: Push to remote with retry logic
      await this.pushWithRetry();

      logger.success(`=== Heartbeat Cycle Completed Successfully [${isoTimestamp}] ===\n`);
      return { success: true, timestamp: isoTimestamp, commitHash };
    } catch (error) {
      logger.error(`Heartbeat cycle failed for ${isoTimestamp}`, error);
      return { success: false, timestamp: isoTimestamp, error };
    }
  }
}
