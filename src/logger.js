/**
 * Production-ready Console Logger
 * Features:
 * - Automatic redaction of sensitive tokens and authenticated URLs
 * - Structured formatting with ISO timestamps and log levels
 * - Colored output for terminal readability
 */

let sensitiveValues = [];

/**
 * Register sensitive tokens or strings that must never appear in logs.
 * @param {string[]} secrets
 */
export function registerSecrets(secrets) {
  sensitiveValues = secrets
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter((s) => s.length > 3); // Avoid masking single/few characters
}

/**
 * Redact sensitive tokens and credentials from message strings.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') {
    try {
      text = JSON.stringify(text);
    } catch {
      text = String(text);
    }
  }

  // Redact registered secret values
  for (const secret of sensitiveValues) {
    if (text.includes(secret)) {
      text = text.split(secret).join('***REDACTED***');
    }
  }

  // Redact standard URL passwords/tokens (e.g., https://username:password@github.com)
  text = text.replace(/https?:\/\/([^:]+):([^@]+)@/gi, 'https://***:***@');

  return text;
}

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  info: '\x1b[36m',    // Cyan
  success: '\x1b[32m', // Green
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  accent: '\x1b[35m',  // Magenta
};

function formatPrefix(level, color) {
  const timestamp = new Date().toISOString();
  return `${colors.dim}[${timestamp}]${colors.reset} ${color}[${level}]${colors.reset}`;
}

export const logger = {
  info(message, ...args) {
    const formatted = redactSecrets(typeof message === 'string' ? message : JSON.stringify(message));
    const formattedArgs = args.map((a) => redactSecrets(typeof a === 'string' ? a : JSON.stringify(a)));
    console.log(`${formatPrefix('INFO', colors.info)} ${formatted}`, ...formattedArgs);
  },

  success(message, ...args) {
    const formatted = redactSecrets(typeof message === 'string' ? message : JSON.stringify(message));
    const formattedArgs = args.map((a) => redactSecrets(typeof a === 'string' ? a : JSON.stringify(a)));
    console.log(`${formatPrefix('SUCCESS', colors.success)} ${formatted}`, ...formattedArgs);
  },

  warn(message, ...args) {
    const formatted = redactSecrets(typeof message === 'string' ? message : JSON.stringify(message));
    const formattedArgs = args.map((a) => redactSecrets(typeof a === 'string' ? a : JSON.stringify(a)));
    console.warn(`${formatPrefix('WARN', colors.warn)} ${formatted}`, ...formattedArgs);
  },

  error(message, error = null) {
    const formatted = redactSecrets(typeof message === 'string' ? message : JSON.stringify(message));
    console.error(`${formatPrefix('ERROR', colors.error)} ${formatted}`);
    if (error) {
      const errDetails = redactSecrets(error.stack || error.message || String(error));
      console.error(`${colors.error}${errDetails}${colors.reset}`);
    }
  },

  retry(attempt, maxRetries, delayMs, reason = '') {
    const reasonText = reason ? ` (Reason: ${redactSecrets(reason)})` : '';
    console.warn(
      `${formatPrefix('RETRY', colors.accent)} Attempt ${attempt}/${maxRetries} scheduled in ${delayMs / 1000}s${reasonText}`
    );
  },
};
