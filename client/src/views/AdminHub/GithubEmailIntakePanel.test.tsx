// GithubEmailIntakePanel.test.tsx — Render + interaction smoke tests for the intake Admin Hub panel.
// fetch is stubbed so the panel loads its config and status without a server.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../store/aiAssistStore.ts';
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
  customRules: [],
};

function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config') && (!init || init.method !== 'POST')) {
      return { ok: true, json: async () => DEFAULT_CONFIG } as Response;
    }
    if (url.endsWith('/jira-statuses')) {
      return { ok: true, json: async () => ({ statuses: ['In Progress', 'Ready for QA'] }) } as Response;
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
    const modeSelect = screen.getByRole('combobox', { name: /rollout mode/i }) as HTMLSelectElement;
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

  it('renders the transition fields as dropdowns populated from Jira statuses', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    // The "PR merged → status" field is a dropdown carrying the fetched Jira statuses.
    const prMergedSelect = await screen.findByRole('combobox', { name: /PR merged/i });
    expect(within(prMergedSelect).getByRole('option', { name: 'Ready for QA' })).toBeInTheDocument();
    expect(within(prMergedSelect).getByRole('option', { name: 'In Progress' })).toBeInTheDocument();
  });

  it('Rule Assist is gated behind the AI unlock', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    // Nothing about Rule Assist may show while locked — not the title, the buttons, and CRUCIALLY not any
    // hint that advertises how to unlock the gated feature (no "Ctrl+Alt+Z" leak to a locked user).
    expect(screen.queryByText(/Rule Assist \(AI\)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate rule prompt/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+Alt\+Z/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unlock AI Assist/i)).not.toBeInTheDocument();
  });

  it('generates a prompt and adds a validated custom rule when AI is unlocked', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /Generate prompt for one email/i }));
    expect(screen.getByDisplayValue(/PASTE THE FULL RAW GITHUB NOTIFICATION EMAIL/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/githubEmailRuleSet/), {
      target: { value: '{"kind":"githubEmailRule","rule":{"id":"org-pr-opened","eventType":"pr_opened","bodyPattern":"wants to merge","requiresPrNumber":true}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Validate & add rule/i }));

    await waitFor(() => expect(screen.getByText('org-pr-opened')).toBeInTheDocument());
    expect(screen.getByText(/Added rule "org-pr-opened"/)).toBeInTheDocument();
  });
});
