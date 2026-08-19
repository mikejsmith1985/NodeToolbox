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

// Mock the comment-audit sweep — the panel's wiring (button → sweep → rows) is what we test.
const { mockFetchGithubAutomationComments } = vi.hoisted(() => ({
  mockFetchGithubAutomationComments: vi.fn(),
}));
vi.mock('../../services/githubCommentAudit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/githubCommentAudit.ts')>()),
  fetchGithubAutomationComments: mockFetchGithubAutomationComments,
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

function stubFetch(
  overrides: Record<string, unknown> = {},
  configOverride: Record<string, unknown> | null = null,
  runLog: unknown[] = [],
  /** The last-run payload the /status endpoint returns; defaults to "nothing has run". */
  statusOverride: Record<string, unknown> = { hasRun: false },
) {
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
      return { ok: true, json: async () => statusOverride } as Response;
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
  // ── Project-keys input (user report: commas were eaten while typing, so the scope could never
  //     be set and the automation posted into every project matching an issue key) ──

  it('keeps a trailing comma while typing project keys and saves the parsed list', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');
    const projectKeysInput = screen.getByLabelText(/jira project keys/i) as HTMLInputElement;

    // Mid-typing state: the comma (and trailing space) must survive the re-render.
    fireEvent.change(projectKeysInput, { target: { value: 'DENP,' } });
    expect(projectKeysInput.value).toBe('DENP,');
    fireEvent.change(projectKeysInput, { target: { value: 'DENP, ENFCT' } });
    expect(projectKeysInput.value).toBe('DENP, ENFCT');

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const savePost = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/config') && init?.method === 'POST');
      expect(savePost).toBeDefined();
      const savedBody = JSON.parse(String(savePost?.[1]?.body)) as { jiraProjectKeys: string[] };
      expect(savedBody.jiraProjectKeys).toEqual(['DENP', 'ENFCT']);
    });
  });

  it('keeps a trailing comma while typing file extensions', async () => {
    stubFetch();
    render(<GithubEmailIntakePanel />);
    await screen.findByText('📧 GitHub Email Intake');
    const extensionsInput = screen.getByLabelText(/file extensions/i) as HTMLInputElement;

    fireEvent.change(extensionsInput, { target: { value: '.eml,' } });
    expect(extensionsInput.value).toBe('.eml,');
  });

  // ── Posted-comment audit (user report: automation commented on an issue it should not have) ──

  it('sweeps Jira for automation comments and lists them with issue links', async () => {
    mockFetchGithubAutomationComments.mockReset();
    mockFetchGithubAutomationComments.mockResolvedValue({
      scannedIssueCount: 3,
      moveRows: [],
      rows: [
        {
          issueKey: 'DENP-9',
          issueSummary: 'Wrongly touched story',
          commentBody: '🎉 GitHub: pull request has been merged. (PR #2681)',
          authorDisplayName: 'Svc Account',
          createdIso: '2026-08-04T15:00:00.000Z',
        },
      ],
    });
    stubFetch({}, { ...DEFAULT_CONFIG, jiraProjectKeys: ['DENP'] });
    render(<GithubEmailIntakePanel />);
    await screen.findByText('Posted-comment audit');

    fireEvent.click(screen.getByRole('button', { name: /scan jira for automation comments/i }));

    expect(await screen.findByText(/pull request has been merged\. \(PR #2681\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DENP-9' })).toBeInTheDocument();
    expect(screen.getByText(/1 automation comment/)).toBeInTheDocument();
    // The sweep honors the configured project scope and the default 30-day lookback.
    expect(mockFetchGithubAutomationComments).toHaveBeenCalledWith(['DENP'], 30);
  });

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

    // Rule Assist is gone entirely — the AI rule generator was removed once the rule set was
    // complete, so this now pins its ABSENCE rather than its gating. The "no Ctrl+Alt+Z leak"
    // assertion is kept: the panel must still never advertise an unlock to a locked user.
    expect(screen.queryByText(/Rule Assist \(AI\)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate rule prompt/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+Alt\+Z/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unlock AI Assist/i)).not.toBeInTheDocument();
  });

});

describe('GithubEmailIntakePanel — refused moves are visible', () => {
  const RUN_WITH_REFUSAL = {
    hasRun: true, mode: 'full', trigger: 'manual', postedCount: 1, skippedCount: 0, errorCount: 0,
    events: [{
      fileName: 'b.eml', outcome: 'posted', jiraKey: 'ENFCT-10', eventType: 'pr_merged',
      message: 'pr merged — did not move to "Done": ambiguous — "Done" category offers several end states (Cancelled, Closed)',
    }],
  }

  it('warns when Jira refused to move an issue, instead of leaving it silent', async () => {
    // The failure this closes: a refusal looked exactly like a rule that did nothing, so the guard
    // that stopped an issue being cancelled was invisible to the person it protected.
    stubFetch({}, null, [], RUN_WITH_REFUSAL)
    render(<GithubEmailIntakePanel />)

    expect(await screen.findByText(/1 issue\(s\) were NOT moved/)).toBeInTheDocument()
  })

  it('offers a copyable run export so a whole run can be handed over at once', async () => {
    stubFetch({}, null, [], RUN_WITH_REFUSAL)
    render(<GithubEmailIntakePanel />)

    expect(await screen.findByRole('button', { name: /Copy run details/i })).toBeInTheDocument()
  })
})

describe('GithubEmailIntakePanel — rule export', () => {
  it('offers both a machine and a readable copy of the rule set', async () => {
    // A rule set is the thing people compare and reproduce; before this the only way to share one
    // was a screenshot per rule, which is why "do I have duplicates?" was unanswerable.
    stubFetch()
    render(<GithubEmailIntakePanel />)

    expect(await screen.findByRole('button', { name: /Copy rules \(JSON\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy rules \(readable\)/i })).toBeInTheDocument()
  })

  it('refuses an import that is not a rule export instead of wiping the rules', async () => {
    stubFetch()
    render(<GithubEmailIntakePanel />)
    await screen.findByText('📧 GitHub Email Intake')

    fireEvent.change(screen.getByPlaceholderText(/githubEmailRuleExport/), {
      target: { value: '{"kind":"somethingElse","rules":[]}' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Import rules/i }))

    expect(await screen.findByText(/not a rule export/i)).toBeInTheDocument()
  })
})

describe('GithubEmailIntakePanel — what the automation moved', () => {
  it('lists the issues it moved and lets them be searched by status', async () => {
    // The half the comment sweep could never answer: it proves the automation was there and says
    // nothing about status, so an issue it commented on AND cancelled looked like one it only
    // commented on. Typing "cancelled" is meant to answer the question directly.
    mockFetchGithubAutomationComments.mockReset()
    mockFetchGithubAutomationComments.mockResolvedValue({
      scannedIssueCount: 2,
      rows: [],
      moveRows: [
        {
          issueKey: 'ENFCT-2020', issueSummary: 'Add letters', currentStatus: 'Cancelled',
          isCurrentStatusDone: true, commentCount: 2,
          automationMoves: [{ fromStatus: 'Code Review', toStatus: 'Cancelled', atIso: '2026-08-18T14:30:00.000Z' }],
        },
        {
          issueKey: 'ENFCT-1530', issueSummary: 'MEET Fallout', currentStatus: 'In Progress',
          isCurrentStatusDone: false, commentCount: 1, automationMoves: [],
        },
      ],
    })
    stubFetch({}, { ...DEFAULT_CONFIG, jiraProjectKeys: ['ENFCT'] })
    render(<GithubEmailIntakePanel />)
    await screen.findByText('Posted-comment audit')

    fireEvent.click(screen.getByRole('button', { name: /scan jira for automation comments/i }))
    expect(await screen.findByText(/What the automation moved/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ENFCT-2020' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ENFCT-1530' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search audited issues'), { target: { value: 'cancelled' } })

    expect(screen.getByRole('link', { name: 'ENFCT-2020' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'ENFCT-1530' })).not.toBeInTheDocument()
  })
})

describe('GithubEmailIntakePanel — deployments access check', () => {
  it('reports a failure with the URL and body, never as an empty deployment list', async () => {
    // The failure mode this exists to prevent: a 404 from a wrong Enterprise base URL rendering as
    // "no deployments", which is an error dressed as an absence.
    stubFetch()
    render(<GithubEmailIntakePanel />)
    await screen.findByText('GitHub Deployments — access check')

    fireEvent.change(screen.getByLabelText('Owner (org)'), { target: { value: 'zilvertonz' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'usmg-elements-integrations' } })

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: false, httpStatus: 404, requestUrl: 'https://gh.example/api/v3/repos/a/b/deployments?per_page=5',
        authType: 'github-app', errorBody: '{"message":"Not Found"}', deployments: [],
      }),
    } as Response)))
    fireEvent.click(screen.getByRole('button', { name: /Test deployments access/i }))

    // Whitespace is normalised by the query, so the column alignment is not part of the assertion.
    expect(await screen.findByText(/Result: FAILED/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument()
    expect(screen.getByText(/Not Found/)).toBeInTheDocument()
  })
})

describe('GithubEmailIntakePanel — deployments probe guardrails', () => {
  it('stays clickable with empty fields, because a locked button explains nothing', async () => {
    // It WAS disabled until both fields were filled, to save a wasted round trip. That cost two
    // rounds of "the button is locked and I cannot tell why" — a far worse trade. The server's own
    // reply names what is missing.
    stubFetch()
    render(<GithubEmailIntakePanel />)
    await screen.findByText('GitHub Deployments — access check')

    expect(screen.getByRole('button', { name: /Test deployments access/i })).toBeEnabled()
  })

  it('points a 404 at the repository NAME first, which is what it usually is', async () => {
    stubFetch()
    render(<GithubEmailIntakePanel />)
    await screen.findByText('GitHub Deployments — access check')
    fireEvent.change(screen.getByLabelText('Owner (org)'), { target: { value: 'zilvertonz' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'repo' } })

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: false, httpStatus: 404, requestUrl: 'https://api.github.com/repos/zilvertonz/repo/deployments?per_page=5',
        authType: 'github-app', errorBody: '{"message":"Not Found"}', deployments: [],
      }),
    } as Response)))
    fireEvent.click(screen.getByRole('button', { name: /Test deployments access/i }))

    // One transposed pair of letters in a repo name produced exactly this, and the name is only
    // visible in the URL — so the hint says to read it before suspecting access.
    expect(await screen.findByText(/misspelt/)).toBeInTheDocument()
  })
})
