// main.test.tsx — Tests the React entry point bootstrap guard.
//
// main.tsx executes synchronously at import time (it calls createRoot immediately).
// This test verifies the guard throws a clear, actionable error when the expected
// #root DOM element is absent, preventing a cryptic React crash in deployment.

import { describe, it, expect } from 'vitest';

const MAIN_ENTRY_TEST_TIMEOUT_MS = 15000;

describe('main entry point', () => {
  it('throws a clear error when the #root DOM element is missing', async () => {
    // In jsdom (the test environment), <div id="root"> does not exist unless
    // we add it explicitly. main.tsx's guard should detect this and throw
    // instead of letting React throw a cryptic null-reference crash.
    //
    // Dynamic import is used so the throw happens inside this test rather than
    // at module-parse time, which would abort the entire test suite.
    await expect(import('./main.tsx')).rejects.toThrow(
      'Root element #root not found',
    );
  }, MAIN_ENTRY_TEST_TIMEOUT_MS);
});
