// GithubEmailIntakePanel.test.tsx — Render + interaction smoke tests for the intake Admin Hub panel.
// fetch is stubbed so the panel loads its config and status without a server.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubEmailIntakePanel } from './GithubEmailIntakePanel.tsx';

const DEFAULT_CONFIG = {
  isEnabled: false,
  mode: 'dryRun',
  scheduleTime: '07:00',
  intervalMin: 0,
  dropFolder: 'C:\\gh',
  processedArchiveFolder: '',
  errorFolder: '',
  fileExtensions: ['.eml', '.txt'],
  jiraProjectKeys: [],
  transitions: { branchCreated: '', commitPushed: '', prOpened: '', prMerged: '' },
  outlookExport: { isEnabled: false, sourceFolder: 'Inbox\\GitHub Intake', processedFolder: 'Inbox\\GitHub Processed' },
};

function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config') && (!init || init.method !== 'POST')) {
      return { ok: true, json: async () => DEFAULT_CONFIG } as Response;
    }
    if (url.endsWith('/status')) {
      return { ok: true, json: async () => ({ hasRun: false }) } as Response;
    }
    if (url.endsWith('/config')) {
      return { ok: true, json: async () => ({ ok: true, folderWarning: null, ...overrides }) } as Response;
    }
    if (url.endsWith('/preview') || url.endsWith('/run-now')) {
      return { ok: true, json: async () => ({ ok: true, result: { hasRun: true, mode: 'dryRun', postedCount: 0, skippedCount: 1, errorCount: 0, events: [{ fileName: 'a.eml', outcome: 'dry-run', eventType: 'pr_merged', jiraKey: 'DENP-1' }] } }) } as Response;
    }
    if (url.endsWith('/export-test')) {
      return { ok: true, json: async () => ({ ok: true, result: { ok: true, exportedCount: 3, total: 4 } }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GithubEmailIntakePanel', () => {
  it('loads and renders the config form with the mode selector and drop folder', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);

    expect(await screen.findByText('📧 GitHub Email Intake')).toBeInTheDocument();
    expect(screen.getByDisplayValue('C:\\gh')).toBeInTheDocument();
    // The rollout mode selector defaults to dry run.
    const modeSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(modeSelect.value).toBe('dryRun');
  });

  it('shows the preview results after clicking Preview', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/Preview complete/i)).toBeInTheDocument());
    expect(screen.getByText(/a\.eml/)).toBeInTheDocument();
  });

  it('runs the Outlook export test and shows the exported count', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    // The "Pull emails from Outlook" section and its source-folder default are rendered.
    expect(screen.getByDisplayValue('Inbox\\GitHub Intake')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Test Outlook export/i }));

    await waitFor(() => expect(screen.getByText(/Exported 3 of 4 Outlook message/i)).toBeInTheDocument());
  });
});
