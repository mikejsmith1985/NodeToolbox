// relayProbe.entry.test.ts — Proves opening the probe file mounts its guided page.

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('relayProbe entry', () => {
  it('mounts the probe page into the document body', async () => {
    await import('./relayProbe.entry.ts');
    expect(document.body.textContent).toContain('SNow Wizard connection probe');
  });
});
