import { HeartbeatBot } from './src/bot.js';
import { logger } from './src/logger.js';

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
