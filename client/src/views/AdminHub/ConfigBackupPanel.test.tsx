// ConfigBackupPanel.test.tsx — Proves a restore is never applied before it has been described.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigBackupPanel } from './ConfigBackupPanel.tsx';

/** A backup file as the panel would receive it from a file input. */
function buildBackupFile(entries: Record<string, string>): File {
  return new File(
    [JSON.stringify({ version: 1, exportedAt: '2026-08-17T09:00:00.000Z', appVersion: '0.200.0', entries })],
    'nodetoolbox-settings-2026-08-17.json',
    { type: 'application/json' },
  );
}

/** Puts a chosen file into the panel's hidden input. */
function chooseFile(backupFile: File): void {
  const fileInput = screen.getByLabelText('Settings backup file');
  Object.defineProperty(fileInput, 'files', { value: [backupFile], configurable: true });
  fireEvent.change(fileInput);
}

describe('ConfigBackupPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('tbxBoardVocabulary', '{"columns":["old"]}');
  });

  it('says what a restore would REPLACE, and changes nothing yet', async () => {
    // The settings it would overwrite represent months of agreement about columns, mappings and team
    // shape. Nobody should discover afterwards that they were replaced.
    render(<ConfigBackupPanel />);

    chooseFile(buildBackupFile({ tbxBoardVocabulary: '{"columns":["new"]}' }));

    await waitFor(() => expect(screen.getByText(/would be REPLACED/)).toBeTruthy());
    expect(window.localStorage.getItem('tbxBoardVocabulary')).toBe('{"columns":["old"]}');
  });

  it('names the settings it would replace, not just how many', async () => {
    // A number is enough to worry somebody and not enough to let them decide.
    render(<ConfigBackupPanel />);

    chooseFile(buildBackupFile({ tbxBoardVocabulary: '{"columns":["new"]}' }));

    await waitFor(() => expect(screen.getByText('tbxBoardVocabulary')).toBeTruthy());
  });

  it('applies only after the second, explicit press', async () => {
    render(<ConfigBackupPanel />);
    chooseFile(buildBackupFile({ tbxBoardVocabulary: '{"columns":["new"]}' }));
    await waitFor(() => screen.getByRole('button', { name: /Replace my settings/ }));

    fireEvent.click(screen.getByRole('button', { name: /Replace my settings/ }));

    expect(window.localStorage.getItem('tbxBoardVocabulary')).toBe('{"columns":["new"]}');
  });

  it('can be cancelled, leaving everything as it was', async () => {
    render(<ConfigBackupPanel />);
    chooseFile(buildBackupFile({ tbxBoardVocabulary: '{"columns":["new"]}' }));
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(window.localStorage.getItem('tbxBoardVocabulary')).toBe('{"columns":["old"]}');
    expect(screen.queryByRole('button', { name: /Replace my settings/ })).toBeNull();
  });

  it('refuses a file that is not one of ours, rather than half-reading it', async () => {
    render(<ConfigBackupPanel />);

    chooseFile(new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' }));

    await waitFor(() => expect(screen.getByText(/no backup version/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Replace my settings/ })).toBeNull();
  });

  it('refuses a file that is not JSON at all', async () => {
    render(<ConfigBackupPanel />);

    chooseFile(new File(['not json'], 'notes.txt', { type: 'text/plain' }));

    await waitFor(() => expect(screen.getByText(/not readable JSON/)).toBeTruthy());
  });

  it('says out loud that the export leaves the secrets behind', () => {
    // The reassurance belongs where somebody is deciding whether to email the file to a colleague.
    const createObjectUrl = vi.fn(() => 'blob:test');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    render(<ConfigBackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Save my settings to a file/ }));

    expect(screen.getByText(/admin passphrase and the unlock flags are deliberately not in the file/))
      .toBeTruthy();
  });
});
