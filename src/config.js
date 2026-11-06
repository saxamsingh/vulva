import dotenv from 'dotenv';
import path from 'path';
import { registerSecrets } from './logger.js';

// Load .env from current working directory or specified path
dotenv.config();

/**
 * Validates and normalizes the repository URL, returning an authenticated URL.
 * Handles HTTPS, SSH format, or bare github.com paths.
 *
 * @param {string} rawUrl
 * @param {string} token
 * @returns {string} Authenticated git clone/push URL
 */
function buildAuthenticatedUrl(rawUrl, token) {
  if (!rawUrl) {
    throw new Error('REPO_URL is required in configuration.');
  }

  let cleanUrl = rawUrl.trim();

  // If local file path or file:// URL (used for local testing), pass through without token
  if (cleanUrl.startsWith('file://') || path.isAbsolute(cleanUrl)) {
    return cleanUrl;
  }

  // If token is missing, return raw URL as fallback
  if (!token) {
    return cleanUrl;
  }

  // Handle SSH format: git@github.com:user/repo.git -> github.com/user/repo.git
  if (cleanUrl.startsWith('git@')) {
    cleanUrl = cleanUrl.replace(/^git@([^:]+):/, '$1/');
  }

  // Remove existing protocol and any embedded credentials
  cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
  cleanUrl = cleanUrl.replace(/^[^@]+@/, '');

  // Ensure .git suffix
  if (!cleanUrl.endsWith('.git')) {
    cleanUrl += '.git';
  }

  // GitHub supports authentication via token username or x-access-token:
  return `https://x-access-token:${token.trim()}@${cleanUrl}`;
}

/**
 * Validates that all required environment variables are set.
 */
function validateConfig(config) {
  const missing = [];
  if (!config.githubToken) missing.push('GITHUB_TOKEN');
  if (!config.repoUrl) missing.push('REPO_URL');
  if (!config.branchName) missing.push('BRANCH_NAME');
  if (!config.commitEmail) missing.push('COMMIT_EMAIL');
  if (!config.commitUsername) missing.push('COMMIT_USERNAME');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Please check your .env file or environment variables.`
    );
  }
}

const githubToken = process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.trim() : '';
const repoUrl = process.env.REPO_URL ? process.env.REPO_URL.trim() : '';

// Register the secret token so logger automatically redacts it
if (githubToken) {
  registerSecrets([githubToken]);
}

export const config = {
  githubToken,
  repoUrl,
  authenticatedRepoUrl: repoUrl ? buildAuthenticatedUrl(repoUrl, githubToken) : '',
  branchName: (process.env.BRANCH_NAME || 'main').trim(),
  commitEmail: (process.env.COMMIT_EMAIL || 'bot@users.noreply.github.com').trim(),
  commitUsername: (process.env.COMMIT_USERNAME || 'heartbeat-bot').trim(),

  // Operational settings
  cronSchedule: process.env.CRON_SCHEDULE || '*/10 * * * *', // Every 10 minutes default
  repoDir: path.resolve(process.cwd(), process.env.REPO_DIR || './repo'),
  logFileName: process.env.LOG_FILE_NAME || 'activity-log.txt',
  runOnStartup: process.env.RUN_ON_STARTUP === 'true' || process.env.RUN_ON_STARTUP === undefined,
  runOnce: process.env.RUN_ONCE === 'true',
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000', 10),

  validate() {
    validateConfig(this);
  },
};
