// main.entry.test.tsx — Proves the Wizard file starts the app on its own (no boot data, no ServiceNow tab needed) and
// opens nothing until the user presses Connect.

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Wizard file entry', () => {
  it('mounts the Wizard on the Connect screen without opening any tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    await import('./main.entry.tsx');
    await waitFor(() => expect(document.body.textContent).toContain('Connect to ServiceNow and Jira'));
    expect(document.getElementById('wizard-root')).not.toBeNull();
    expect(document.body.textContent).toContain('SNow Wizard dev');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
