import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { config } from './config.js';
import { GitService } from './gitService.js';
import { logger } from './logger.js';

export class HeartbeatBot {
  constructor() {
    this.gitService = new GitService();
    this.cronTask = null;
    this.randomTimer = null;
    this.isExecuting = false;
    this.isShuttingDown = false;
    this.lockFile = path.resolve(process.cwd(), 'bot.pid');
  }

  /**
   * Prevents multiple instances from running concurrently
   */
  acquireLock() {
    if (fs.existsSync(this.lockFile)) {
      try {
        const rawPid = fs.readFileSync(this.lockFile, 'utf-8').trim();
        const pid = parseInt(rawPid, 10);
        if (pid && !isNaN(pid)) {
          try {
            // Check if process is alive
            process.kill(pid, 0);
            logger.warn(`Another instance of the bot is already active (PID: ${pid}). Exiting duplicate process.`);
            process.exit(0);
          } catch {
            // Process does not exist; lock is stale
          }
        }
      } catch {}
    }
    fs.writeFileSync(this.lockFile, String(process.pid), 'utf-8');
  }

  /**
   * Releases lock on exit
   */
  releaseLock() {
    try {
      if (fs.existsSync(this.lockFile)) {
        const rawPid = fs.readFileSync(this.lockFile, 'utf-8').trim();
        if (parseInt(rawPid, 10) === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch {}
  }

  /**
   * Safe execution wrapper preventing overlapping cycles
   */
  async runCycle() {
    if (this.isShuttingDown) {
      logger.warn('Bot is shutting down. Skipping scheduled cycle.');
      return;
    }

    if (this.isExecuting) {
      logger.warn('Previous heartbeat cycle is still running. Skipping to prevent race conditions.');
      return;
    }

    this.isExecuting = true;
    try {
      await this.gitService.executeHeartbeatCycle();
    } catch (err) {
      logger.error('Unhandled error during heartbeat execution:', err);
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Schedule the next cycle using randomized human-like intervals
   */
  scheduleNextRandomRun() {
    if (this.isShuttingDown) return;

    const min = Math.max(1, config.minIntervalMinutes);
    const max = Math.max(min, config.maxIntervalMinutes);
    const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
    const delayMs = randomMinutes * 60 * 1000;
    const nextTime = new Date(Date.now() + delayMs);

    logger.info(
      `🎲 Randomized schedule: Next commit in ${randomMinutes} mins (around ${nextTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    );

    this.randomTimer = setTimeout(async () => {
      await this.runCycle();
      this.scheduleNextRandomRun();
    }, delayMs);
  }

  /**
   * Starts the bot daemon
   */
  async start() {
    logger.info('====================================================');
    logger.info('   GitHub Heartbeat Bot Daemon Starting Up');
    logger.info('====================================================');

    // 1. Validate configuration
    config.validate();

    // 2. Handle runOnce mode (useful for manual testing or CI verification)
    if (config.runOnce) {
      logger.info('RUN_ONCE mode detected. Executing single cycle and exiting...');
      await this.gitService.initialize();
      await this.runCycle();
      process.exit(0);
    }

    // 3. Acquire singleton lock
    this.acquireLock();

    logger.info(`Target Repository : ${config.repoUrl}`);
    logger.info(`Target Branch     : ${config.branchName}`);
    logger.info(`Commit Author     : ${config.commitUsername} <${config.commitEmail}>`);
    if (config.randomInterval) {
      logger.info(`Timing Mode       : Randomized (${config.minIntervalMinutes} - ${config.maxIntervalMinutes} mins for natural commit activity)`);
    } else {
      logger.info(`Timing Mode       : Fixed Cron [${config.cronSchedule}]`);
    }
    logger.info(`Working Directory : ${config.repoDir}`);
    logger.info(`Max Retries       : ${config.maxRetries}`);

    // 4. Initialize Git repository
    await this.gitService.initialize();

    // 5. Optionally run immediately on startup
    if (config.runOnStartup) {
      logger.info('Initial heartbeat starting on boot...');
      await this.runCycle();
    }

    // 6. Setup schedule (Randomized natural intervals or fixed cron)
    if (config.randomInterval) {
      this.scheduleNextRandomRun();
    } else {
      if (!cron.validate(config.cronSchedule)) {
        throw new Error(`Invalid cron expression: "${config.cronSchedule}". Expected format: "*/10 * * * *"`);
      }

      logger.info(`Registering fixed cron schedule: [${config.cronSchedule}]`);
      this.cronTask = cron.schedule(config.cronSchedule, async () => {
        logger.info('Cron schedule triggered.');
        await this.runCycle();
      });
    }

    logger.success('Heartbeat Bot is actively running in background.');

    // 7. Register graceful shutdown handlers
    this.setupGracefulShutdown();
  }

  /**
   * Handles graceful shutdown on SIGINT / SIGTERM / EXIT
   */
  setupGracefulShutdown() {
    const handleShutdown = async (signal) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);
      this.isShuttingDown = true;

      if (this.randomTimer) {
        clearTimeout(this.randomTimer);
        this.randomTimer = null;
      }

      if (this.cronTask) {
        this.cronTask.stop();
        logger.info('Cron scheduler stopped.');
      }

      if (this.isExecuting) {
        logger.info('Waiting for active heartbeat cycle to complete...');
        let waitCount = 0;
        while (this.isExecuting && waitCount < 30) {
          await new Promise((r) => setTimeout(r, 1000));
          waitCount++;
        }
      }

      this.releaseLock();
      logger.success('Heartbeat Bot shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('exit', () => this.releaseLock());
  }
}
