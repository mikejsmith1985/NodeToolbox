// src/utils/logBuffer.test.js — Unit tests for the in-memory ring-buffer log interceptor.
// Tests verify that entries are captured, the ring buffer evicts oldest entries at capacity,
// and clearEntries() resets state without side-effects.

'use strict';

const { installConsoleInterceptor, getAllEntries, clearEntries } = require('./logBuffer');

// Install the interceptor once for all tests in this file.
// Because logBuffer is a singleton (module-level state), we clear after each test.
installConsoleInterceptor();

afterEach(() => {
  clearEntries();
});

describe('logBuffer', () => {
  it('captures a console.log call as an info-level entry', () => {
    console.log('hello from test');
    const entries = getAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('hello from test');
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('captures console.warn as warn and console.error as error', () => {
    console.warn('a warning');
    console.error('an error');
    const entries = getAllEntries();
    expect(entries[0].level).toBe('warn');
    expect(entries[1].level).toBe('error');
  });

  it('serialises non-string arguments to JSON', () => {
    console.log({ key: 'value' });
    const entries = getAllEntries();
    expect(entries[0].message).toBe('{"key":"value"}');
  });

  it('returns a copy — mutations to the returned array do not affect the buffer', () => {
    console.log('original');
    const snapshot = getAllEntries();
    snapshot.push({ level: 'info', message: 'injected', timestamp: '' });
    expect(getAllEntries()).toHaveLength(1);
  });

  it('evicts the oldest entry when the buffer exceeds MAX_ENTRIES (300)', () => {
    // Fill buffer to capacity + 1
    for (let entryIndex = 0; entryIndex <= 300; entryIndex++) {
      console.log(`entry-${entryIndex}`);
    }
    const entries = getAllEntries();
    expect(entries).toHaveLength(300);
    // entry-0 should have been evicted; entry-1 should now be first
    expect(entries[0].message).toBe('entry-1');
    expect(entries[299].message).toBe('entry-300');
  });

  it('clearEntries() removes all entries', () => {
    console.log('to be cleared');
    clearEntries();
    expect(getAllEntries()).toHaveLength(0);
  });
});
