import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { config } from './config.js';
import { GitService } from './gitService.js';
import { logger } from './logger.js';

const TICK_MS = 15 * 1000; // scheduler tick; compares wall-clock so sleep/wake never stalls it
const LOCK_STALE_MS = 90 * 1000; // lock older than this is considered abandoned
const FAILURE_RETRY_MS = 2 * 60 * 1000; // retry sooner after a failed cycle

export class HeartbeatBot {
  constructor() {
    this.gitService = new GitService();
    this.cronTask = null;
    this.tickTimer = null;
    this.nextRunAt = 0;
    this.isExecuting = false;
    this.isShuttingDown = false;
    this.lockFile = path.resolve(process.cwd(), 'bot.pid');
  }

  /**
   * Singleton lock. A lock is only honoured if its PID is alive AND it was
   * refreshed recently, so a stale file (or a reused PID after reboot) can
   * never block the bot from starting.
   */
  acquireLock() {
    try {
      if (fs.existsSync(this.lockFile)) {
        const age = Date.now() - fs.statSync(this.lockFile).mtimeMs;
        const pid = parseInt(fs.readFileSync(this.lockFile, 'utf-8').trim(), 10);
        if (pid && pid !== process.pid && age < LOCK_STALE_MS) {
          let alive = true;
          try {
            process.kill(pid, 0);
          } catch {
            alive = false;
          }
          if (alive) {
            logger.warn(`Another instance is already running (PID ${pid}). Exiting duplicate.`);
            process.exit(0);
          }
        }
      }
    } catch {}
    fs.writeFileSync(this.lockFile, String(process.pid), 'utf-8');
  }

  touchLock() {
    try {
      const now = new Date();
      fs.utimesSync(this.lockFile, now, now);
    } catch {
      try {
        fs.writeFileSync(this.lockFile, String(process.pid), 'utf-8');
      } catch {}
    }
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.lockFile) && parseInt(fs.readFileSync(this.lockFile, 'utf-8').trim(), 10) === process.pid) {
        fs.unlinkSync(this.lockFile);
      }
    } catch {}
  }

  /**
   * Safe execution wrapper preventing overlapping cycles.
   * @returns {Promise<boolean>} true if the cycle succeeded
   */
  async runCycle() {
    if (this.isShuttingDown) return true;
    if (this.isExecuting) {
      logger.warn('Previous heartbeat cycle is still running. Skipping.');
      return true;
    }

    this.isExecuting = true;
    try {
      const result = await this.gitService.executeHeartbeatCycle();
      return Boolean(result && result.success);
    } catch (err) {
      logger.error('Unhandled error during heartbeat execution:', err);
      return false;
    } finally {
      this.isExecuting = false;
    }
  }

  scheduleNext(afterFailure = false) {
    let delayMs;
    if (afterFailure) {
      delayMs = FAILURE_RETRY_MS;
      logger.warn(`Cycle failed. Retrying in ${delayMs / 60000} mins.`);
    } else {
      const min = Math.max(1, config.minIntervalMinutes);
      const max = Math.max(min, config.maxIntervalMinutes);
      const minutes = min + Math.random() * (max - min);
      delayMs = Math.round(minutes * 60 * 1000);
      logger.info(`Next commit in ${(delayMs / 60000).toFixed(1)} mins (around ${new Date(Date.now() + delayMs).toLocaleTimeString()})`);
    }
    this.nextRunAt = Date.now() + delayMs;
  }

  /**
   * Wall-clock tick loop. Unlike a long setTimeout, this recovers immediately
   * after the PC wakes from sleep: the first tick after wake sees the run is
   * overdue and fires it.
   */
  startTickLoop() {
    this.tickTimer = setInterval(async () => {
      this.touchLock();
      if (this.isShuttingDown || this.isExecuting) return;
      if (Date.now() >= this.nextRunAt) {
        const ok = await this.runCycle();
        this.scheduleNext(!ok);
      }
    }, TICK_MS);
  }

  async start() {
    logger.info('====================================================');
    logger.info('   GitHub Heartbeat Bot Daemon Starting Up');
    logger.info('====================================================');

    config.validate();

    if (config.runOnce) {
      logger.info('RUN_ONCE mode: executing single cycle and exiting...');
      await this.gitService.initialize();
      const ok = await this.runCycle();
      process.exit(ok ? 0 : 1);
    }

    this.acquireLock();

    logger.info(`Target Repository : ${config.repoUrl}`);
    logger.info(`Target Branch     : ${config.branchName}`);
    logger.info(`Commit Author     : ${config.commitUsername} <${config.commitEmail}>`);
    logger.info(
      config.randomInterval
        ? `Timing Mode       : every ${config.minIntervalMinutes}-${config.maxIntervalMinutes} mins`
        : `Timing Mode       : fixed cron [${config.cronSchedule}]`
    );

    // Retry initialisation (network may not be up yet right after boot/login)
    for (let attempt = 1; ; attempt++) {
      try {
        await this.gitService.initialize();
        break;
      } catch (err) {
        logger.error(`Init failed (attempt ${attempt}). Retrying in 30s.`, err);
        await new Promise((r) => setTimeout(r, 30000));
        this.touchLock();
      }
    }

    if (config.runOnStartup) {
      logger.info('Initial heartbeat on startup...');
      await this.runCycle();
    }

    if (config.randomInterval) {
      this.scheduleNext();
      this.startTickLoop();
    } else {
      if (!cron.validate(config.cronSchedule)) {
        throw new Error(`Invalid cron expression: "${config.cronSchedule}"`);
      }
      this.cronTask = cron.schedule(config.cronSchedule, () => this.runCycle());
      this.tickTimer = setInterval(() => this.touchLock(), TICK_MS);
    }

    logger.success('Heartbeat Bot is running.');
    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const handleShutdown = async (signal) => {
      logger.info(`Received ${signal}. Shutting down...`);
      this.isShuttingDown = true;
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.cronTask) this.cronTask.stop();

      for (let i = 0; this.isExecuting && i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      this.releaseLock();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('exit', () => this.releaseLock());
  }
}
