// launcher.entry.test.ts — Proves opening the shared file mounts the installer page.

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('launcher entry', () => {
  it('mounts the installer page into the document body', async () => {
    await import('./launcher.entry.ts');
    expect(document.body.textContent).toContain('Put the SNow Wizard button on your bookmarks bar');
  });
});
