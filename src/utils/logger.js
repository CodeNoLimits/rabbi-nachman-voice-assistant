/**
 * Simple but effective logger for Rabbi Nachman Voice Assistant
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m',  // Yellow
  info: '\x1b[36m',  // Cyan
  debug: '\x1b[90m', // Gray
  reset: '\x1b[0m'
};

class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'info';
    this.enableColors = process.env.NODE_ENV !== 'production';
  }

  _log(level, message, ...args) {
    if (LOG_LEVELS[level] > LOG_LEVELS[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const color = this.enableColors ? COLORS[level] : '';
    const reset = this.enableColors ? COLORS.reset : '';

    const prefix = `${color}[${timestamp}] [${level.toUpperCase()}]${reset}`;

    if (args.length > 0) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix, message);
    }
  }

  error(message, ...args) {
    this._log('error', message, ...args);
  }

  warn(message, ...args) {
    this._log('warn', message, ...args);
  }

  info(message, ...args) {
    this._log('info', message, ...args);
  }

  debug(message, ...args) {
    this._log('debug', message, ...args);
  }

  // Special method for citation logging
  citation(message, source, confidence) {
    this.info(`📖 ${message}`, { source, confidence });
  }

  // Special method for query logging
  query(frenchQuery, hebrewQuery, results) {
    this.info(`🔍 Query: "${frenchQuery}"`, {
      hebrew: hebrewQuery,
      resultCount: results?.length
    });
  }
}

export const logger = new Logger();