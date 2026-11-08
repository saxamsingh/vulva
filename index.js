import { HeartbeatBot } from './src/bot.js';
import { logger } from './src/logger.js';

// Never let a stray error kill the daemon
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err));

async function main() {
  try {
    const bot = new HeartbeatBot();
    await bot.start();
  } catch (error) {
    logger.error('Fatal initialization error:', error);
    process.exit(1);
  }
}

main();
