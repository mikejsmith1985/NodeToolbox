// GithubEmailIntakePanel.test.tsx — Render + interaction smoke tests for the intake Admin Hub panel.
// fetch is stubbed so the panel loads its config and status without a server.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../store/aiAssistStore.ts';

// Mock the SharePoint pull service — the panel's wiring (button → service → summary) is what we test.
const { mockPullSharePointEmails, mockPreviewSharePointEmails } = vi.hoisted(() => ({
  mockPullSharePointEmails: vi.fn(),
  mockPreviewSharePointEmails: vi.fn(),
}));
vi.mock('../../services/githubEmailSharePointPull.ts', async (importOriginal) => ({
  // Keep the real pure helpers (the panel normalizes pasted URLs with them); mock only the relay I/O.
  ...(await importOriginal<typeof import('../../services/githubEmailSharePointPull.ts')>()),
  pullSharePointEmails: mockPullSharePointEmails,
  previewSharePointEmails: mockPreviewSharePointEmails,
}));

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

// Per-test run-log payload for the Activity Log section; reset in stubFetch.
let runLogOverride: unknown[] = [];

function stubFetch(overrides: Record<string, unknown> = {}, configOverride: Record<string, unknown> | null = null, runLog: unknown[] = []) {
  runLogOverride = runLog;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config') && (!init || init.method !== 'POST')) {
      return { ok: true, json: async () => (configOverride ?? DEFAULT_CONFIG) } as Response;
    }
    if (url.endsWith('/jira-statuses')) {
      return { ok: true, json: async () => ({ statuses: ['In Progress', 'Ready for QA'] }) } as Response;
    }
    if (url.endsWith('/sub-status-options')) {
      return { ok: true, json: async () => ({ options: ['Dev Complete', 'In QA'] }) } as Response;
    }
    if (url.endsWith('/status')) {
      return { ok: true, json: async () => ({ hasRun: false }) } as Response;
    }
    if (url.endsWith('/run-log')) {
      return { ok: true, json: async () => ({ ok: true, runs: runLogOverride }) } as Response;
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
  // ── Activity Log (user report: 90+ emails untouched, no way to see whether runs happen) ──

  it('renders the Activity Log with one row per recorded run and its outcome counts', async () => {
    stubFetch({}, null, [
      { ranAtIso: '2026-08-03T07:00:00.000Z', trigger: 'scheduled', mode: 'full', postedCount: 3, skippedCount: 2, errorCount: 1, events: [{ fileName: 'a.eml', outcome: 'posted', jiraKey: 'DENP-1', eventType: 'pr_merged' }] },
      { ranAtIso: '2026-08-02T07:00:00.000Z', trigger: 'manual', mode: 'dryRun', postedCount: 0, skippedCount: 5, errorCount: 0, events: [] },
    ]);
    render(<GithubEmailIntakePanel />);

    expect(await screen.findByText('Activity Log')).toBeInTheDocument();
    expect(screen.getAllByText(/scheduled/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 posted · 2 skipped · 1 error/)).toBeInTheDocument();
    expect(screen.getByText(/0 posted · 5 skipped · 0 errors/)).toBeInTheDocument();
  });

  it('expands a run row to show what was done to each email', async () => {
    stubFetch({}, null, [
      { ranAtIso: '2026-08-03T07:00:00.000Z', trigger: 'scheduled', mode: 'full', postedCount: 1, skippedCount: 0, errorCount: 0, events: [{ fileName: 'merge.eml', outcome: 'posted', jiraKey: 'DENP-1414', eventType: 'pr_merged' }] },
    ]);
    render(<GithubEmailIntakePanel />);
    await screen.findByText('Activity Log');

    fireEvent.click(screen.getByRole('button', { name: /details/i }));

    // Scoped to the expanded event row — "pr_merged" also appears in the default rules list.
    const eventRow = screen.getByText(/merge\.eml/).closest('li');
    expect(eventRow).toHaveTextContent('DENP-1414');
    expect(eventRow).toHaveTextContent('pr_merged');
    expect(eventRow).toHaveTextContent('posted');
  });

  it('states honestly when no run has ever been recorded', async () => {
    stubFetch({}, null, []);
    render(<GithubEmailIntakePanel />);

    expect(await screen.findByText('Activity Log')).toBeInTheDocument();
    expect(screen.getByText(/No runs recorded yet/i)).toBeInTheDocument();
  });

  // ── SharePoint source (macro-less pipeline: Power Automate → library → relay pull) ──

  it('renders the SharePoint folder URL from config and pulls through the relay service', async () => {
    stubFetch({}, { ...DEFAULT_CONFIG, sharePointFolderUrl: '/sites/Team/Shared Documents/GitHubEmails' });
    mockPullSharePointEmails.mockResolvedValue({
      listedCount: 3, newCount: 2, postedCount: 1, skippedCount: 1, errorCount: 0, batchCount: 1,
    });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    expect(screen.getByDisplayValue('/sites/Team/Shared Documents/GitHubEmails')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pull from sharepoint/i }));

    await waitFor(() => expect(mockPullSharePointEmails).toHaveBeenCalled());
    expect(mockPullSharePointEmails.mock.calls[0][0]).toBe('/sites/Team/Shared Documents/GitHubEmails');
    // The summary reports what the pull actually did — in the SharePoint section AND at the buttons.
    expect((await screen.findAllByText(/2 new email/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 posted/i).length).toBeGreaterThan(0);
  });

  it('normalizes a pasted SharePoint share link to the server-relative folder on pull', async () => {
    stubFetch({}, {
      ...DEFAULT_CONFIG,
      sharePointFolderUrl: 'https://myfyi.sharepoint.com/:f:/r/sites/Transformers-Playground/Shared%20Documents/gh_emails?d=w887&csf=1&web=1',
    });
    mockPullSharePointEmails.mockReset();
    mockPullSharePointEmails.mockResolvedValue({
      listedCount: 0, newCount: 0, postedCount: 0, skippedCount: 0, errorCount: 0, batchCount: 0,
    });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /pull from sharepoint/i }));

    await waitFor(() => expect(mockPullSharePointEmails).toHaveBeenCalled());
    // The service receives the clean server-relative folder, and the input now SHOWS it, so the
    // stored config is self-explanatory next time the panel opens.
    expect(mockPullSharePointEmails.mock.calls[0][0]).toBe('/sites/Transformers-Playground/Shared Documents/gh_emails');
    expect(screen.getByDisplayValue('/sites/Transformers-Playground/Shared Documents/gh_emails')).toBeInTheDocument();
  });

  it('routes Run Now to the SharePoint pull when no local drop folder is configured (SP-only setup)', async () => {
    stubFetch({}, { ...DEFAULT_CONFIG, dropFolder: '', sharePointFolderUrl: '/sites/Team/GitHubEmails' });
    mockPullSharePointEmails.mockReset();
    mockPullSharePointEmails.mockResolvedValue({
      listedCount: 1, newCount: 1, postedCount: 1, skippedCount: 0, errorCount: 0, batchCount: 1,
    });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /run now/i }));

    // No dead-end "No drop folder configured" — the SharePoint source IS the configured source.
    await waitFor(() => expect(mockPullSharePointEmails).toHaveBeenCalled());
    expect(mockPullSharePointEmails.mock.calls[0][0]).toBe('/sites/Team/GitHubEmails');
  });

  it('shows the pull outcome AND a busy state at the action buttons in an SP-only setup', async () => {
    // GH #282 last comment: "run now doesn't seem to do anything" — the outcome only rendered in
    // the SharePoint section mid-page, and the bottom buttons never showed a busy state.
    stubFetch({}, { ...DEFAULT_CONFIG, dropFolder: '', sharePointFolderUrl: '/sites/Team/GitHubEmails' });
    mockPullSharePointEmails.mockReset();
    let resolvePull: (value: unknown) => void = () => {};
    mockPullSharePointEmails.mockReturnValue(new Promise((resolve) => { resolvePull = resolve; }));
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /run now/i }));

    // While the pull runs, the bottom action buttons show they are working.
    expect(await screen.findAllByRole('button', { name: /working…/i })).not.toHaveLength(0);

    await act(async () => {
      resolvePull({ listedCount: 3, newCount: 0, postedCount: 0, skippedCount: 0, errorCount: 0, batchCount: 1 });
    });

    // The outcome lands in the status line by the buttons AND the SharePoint section.
    expect((await screen.findAllByText(/all caught up/i)).length).toBe(2);
  });

  it('names the unsupported binaries and the Export-email fix when the pull skips files', async () => {
    stubFetch({}, { ...DEFAULT_CONFIG, dropFolder: '', sharePointFolderUrl: '/sites/Team/GitHubEmails' });
    mockPullSharePointEmails.mockReset();
    mockPullSharePointEmails.mockResolvedValue({
      listedCount: 0, newCount: 0, postedCount: 0, skippedCount: 0, errorCount: 0, batchCount: 1, unsupportedCount: 38,
    });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /run now/i }));

    // Never a bare "all caught up" while 38 files sit unread — say what was skipped and how to fix it.
    expect((await screen.findAllByText(/38 file\(s\) skipped/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/export email/i).length).toBeGreaterThan(0);
  });

  it('Preview in an SP-only setup ACTUALLY previews: dry-run parse of the new SharePoint files', async () => {
    stubFetch({}, { ...DEFAULT_CONFIG, dropFolder: '', sharePointFolderUrl: '/sites/Team/GitHubEmails' });
    mockPullSharePointEmails.mockReset();
    mockPreviewSharePointEmails.mockReset();
    mockPreviewSharePointEmails.mockResolvedValue({
      listedCount: 2,
      newCount: 1,
      result: {
        hasRun: true, mode: 'dryRun', trigger: 'sharepoint-preview', postedCount: 0, skippedCount: 0, errorCount: 0,
        events: [{ fileName: 'fresh.eml', outcome: 'dry-run', eventType: 'pr_merged', jiraKey: 'DENP-9' }],
      },
    });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(mockPreviewSharePointEmails).toHaveBeenCalled());
    expect(mockPreviewSharePointEmails.mock.calls[0][0]).toBe('/sites/Team/GitHubEmails');
    // Nothing was posted or ingested — and the parsed events render like a folder preview's.
    expect(await screen.findByText(/preview complete/i)).toBeInTheDocument();
    expect(screen.getByText(/fresh\.eml/)).toBeInTheDocument();
    expect(mockPullSharePointEmails).not.toHaveBeenCalled();
  });

  it('disables the SharePoint pull until a folder URL is set, and surfaces a pull failure honestly', async () => {
    stubFetch(); // DEFAULT_CONFIG has no sharePointFolderUrl
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    const pullButton = screen.getByRole('button', { name: /pull from sharepoint/i });
    expect(pullButton).toBeDisabled();

    // Set a folder URL, then a failing pull (e.g. relay not connected) shows the error message.
    fireEvent.change(screen.getByLabelText(/sharepoint folder/i), { target: { value: '/sites/Team/GitHubEmails' } });
    mockPullSharePointEmails.mockRejectedValue(new Error('Connect the SharePoint relay first — open the SharePoint site and click the relay bookmarklet.'));
    fireEvent.click(pullButton);

    expect((await screen.findAllByText(/connect the sharepoint relay/i)).length).toBeGreaterThan(0);
  });

  it('loads and renders the config form with the mode selector and drop folder', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);

    expect(await screen.findByText('📧 GitHub Email Intake')).toBeInTheDocument();
    expect(screen.getByDisplayValue('C:\\gh')).toBeInTheDocument();
    // The rollout mode selector defaults to dry run.
    const modeSelect = screen.getByRole('combobox', { name: /rollout mode/i }) as HTMLSelectElement;
    expect(modeSelect.value).toBe('dryRun');
  });

  it('shows the Rules section (visible while locked) with enable, comment, transition, and a plain-English summary', async () => {
    const ruleConfig = {
      ...DEFAULT_CONFIG,
      customRules: [{ id: 'pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request', requiresPrNumber: true }],
    };
    useAiAssistStore.setState({ isAiAssistUnlocked: false }); // rule management is operator config, not gated
    stubFetch({}, ruleConfig);
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    expect(screen.getByText('pr-approved')).toBeInTheDocument();
    const enableToggle = screen.getByRole('checkbox', { name: /Enable rule pr-approved/i });
    expect(enableToggle).toBeChecked();
    expect(screen.getByLabelText(/Comment for rule pr-approved/i)).toBeInTheDocument();
    const transition = screen.getByRole('combobox', { name: /Transition status for rule pr-approved/i }) as HTMLSelectElement;
    expect(transition.value).toBe(''); // defaults to comment-only
    // The summary spells out exactly what Toolbox will do.
    expect(screen.getByText(/comments .*GitHub: pr approved.* \(no status change\)/)).toBeInTheDocument();

    // Toggling the rule off updates it in place (no crash, reflects immediately).
    fireEvent.click(enableToggle);
    expect(enableToggle).not.toBeChecked();
  });

  it('offers parent-story actions per rule: parent status, the all-dev-done guard, and Sub-status options', async () => {
    const ruleConfig = {
      ...DEFAULT_CONFIG,
      subStatusFieldId: 'customfield_10201',
      customRules: [{ id: 'branch-merged', eventType: 'pr_merged', bodyPattern: 'merged .* into (main|develop)', transitionStatus: 'Done' }],
    };
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
    stubFetch({}, ruleConfig);
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');

    // All three parent controls are visible up front — the Sub-status dropdown must be
    // discoverable WITHOUT first picking a parent status (it is usable on its own).
    const parentSelect = screen.getByRole('combobox', { name: /Parent story status for rule branch-merged/i }) as HTMLSelectElement;
    expect(parentSelect.value).toBe('');
    const guardToggle = screen.getByRole('checkbox', { name: /Require all coding sub-tasks done for rule branch-merged/i });
    expect(guardToggle).toBeChecked();
    const subStatusSelect = screen.getByRole('combobox', { name: /Parent Sub-status for rule branch-merged/i }) as HTMLSelectElement;

    fireEvent.change(parentSelect, { target: { value: 'Ready for QA' } });
    // The Sub-status dropdown carries the options served by the new endpoint.
    fireEvent.change(subStatusSelect, { target: { value: 'Dev Complete' } });

    // The plain-English summary spells out the parent behaviour.
    expect(screen.getByText(/Parent story → .*Ready for QA.* once every coding sub-task is Done/)).toBeInTheDocument();
    expect(screen.getByText(/Parent Sub-status → .*Dev Complete/)).toBeInTheDocument();
  });

  it('lists the built-in default rules and customizing one makes it editable', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: false })
    stubFetch({}, { ...DEFAULT_CONFIG, customRules: [] })
    render(<GithubEmailIntakePanel />)
    await screen.findByText('📧 GitHub Email Intake')

    // The defaults are surfaced with a Customize action. (The section blurb also names pr-merged as
    // its example, so assert on the rule entries rather than a unique text match.)
    expect(screen.getByText('Built-in default rules')).toBeInTheDocument()
    expect(screen.getAllByText('pr-merged').length).toBeGreaterThan(0)

    const customizeButtons = screen.getAllByRole('button', { name: /^Customize$/i })
    fireEvent.click(customizeButtons[0])

    // The customized default becomes an editable rule (an Enable toggle appears for it).
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Enable rule/i })).toBeInTheDocument())
  })

  it('skips a content-duplicate rule (same matcher, different id) when adding from a reply', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true })
    const existing = { id: 'pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request', requiresPrNumber: true }
    stubFetch({}, { ...DEFAULT_CONFIG, customRules: [existing] })
    render(<GithubEmailIntakePanel />)
    await screen.findByText('📧 GitHub Email Intake')

    // Paste a reply with a NEW id but the SAME matcher as the existing rule.
    fireEvent.change(screen.getByPlaceholderText(/githubEmailRuleSet/), {
      target: { value: JSON.stringify({ kind: 'githubEmailRuleSet', rules: [{ id: 'approved-pr', eventType: 'pr_approved', bodyPattern: 'approved this pull request', requiresPrNumber: true }] }) },
    })
    fireEvent.click(screen.getByRole('button', { name: /Validate & add rule/i }))

    await waitFor(() => expect(screen.getByText(/duplicate of an existing rule/i)).toBeInTheDocument())
    expect(screen.queryByText('approved-pr')).not.toBeInTheDocument()
  })

  it('softly warns when a custom rule overlaps a built-in event type', async () => {
    const custom = { id: 'my-open', eventType: 'pr_opened', subjectPattern: 'please review', requiresPrNumber: true }
    stubFetch({}, { ...DEFAULT_CONFIG, customRules: [custom] })
    render(<GithubEmailIntakePanel />)
    await screen.findByText('📧 GitHub Email Intake')

    // Advisory, non-blocking: the rule is still shown; a heads-up note names the overlapping event type.
    expect(screen.getByText(/Heads up:.*rules target pr_opened/i)).toBeInTheDocument()
    expect(screen.getByText('my-open')).toBeInTheDocument()
  })

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
