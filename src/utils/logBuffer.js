// src/utils/logBuffer.js — In-memory ring buffer that captures server console output
// for consumption by the Dev Panel's Server Logs tab.
//
// Intercepts global console.log / console.warn / console.error so every server-side
// message is stored here as well as printed to the terminal. The buffer is capped at
// MAX_ENTRIES to prevent unbounded memory growth during long-running sessions.
// All state is in-process and resets on server restart — this is intentional.

'use strict';

/** Maximum number of log entries kept in the ring buffer before oldest are evicted. */
const MAX_ENTRIES = 300;

/** All captured log entries in insertion order. */
const logEntries = [];

/** Maps Node.js console method names to short level labels used by the client. */
const LEVEL_MAP = {
  log:   'info',
  info:  'info',
  warn:  'warn',
  error: 'error',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Appends one log entry to the ring buffer, evicting the oldest entry if the
 * buffer is at capacity.
 *
 * @param {'info'|'warn'|'error'} level - Severity of the message.
 * @param {string} message - The formatted console message text.
 */
function appendEntry(level, message) {
  logEntries.push({ level, message, timestamp: new Date().toISOString() });
  if (logEntries.length > MAX_ENTRIES) {
    logEntries.shift();
  }
}

// ── Console interception ──────────────────────────────────────────────────────

/**
 * Patches the global console object so each call also pushes a structured entry
 * into the log buffer. The original method is still called so terminal output
 * is not suppressed.
 *
 * Call this once at server startup (before any routes are wired).
 */
function installConsoleInterceptor() {
  for (const [methodName, level] of Object.entries(LEVEL_MAP)) {
    const originalMethod = console[methodName].bind(console);
    console[methodName] = function(...logArgs) {
      originalMethod(...logArgs);
      // Format arguments the same way Node's util.formatWithOptions would,
      // keeping it simple: join stringified values with a space.
      const formattedMessage = logArgs
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      appendEntry(level, formattedMessage);
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a shallow copy of all log entries currently in the buffer.
 * Each entry has { level, message, timestamp }.
 *
 * @returns {{ level: string, message: string, timestamp: string }[]}
 */
function getAllEntries() {
  return [...logEntries];
}

/**
 * Clears all entries from the ring buffer.
 * Called by POST /api/logs/clear from the Dev Panel UI.
 */
function clearEntries() {
  logEntries.length = 0;
}

module.exports = { installConsoleInterceptor, getAllEntries, clearEntries };
