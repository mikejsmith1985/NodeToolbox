// useTodayDashboard.test.ts — Unit tests for the Today dashboard orchestration hook.
//
// Every data source is mocked so we can prove each card resolves independently, a single
// failing source does not blank its siblings, team cards report "not-configured" without a
// project, and the team hygiene counts come from the SHARED hygiene scan — the same pipeline
// the team Hygiene tab renders — never from a second evaluation over the sprint issue list.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HygieneFinding } from '../../../Hygiene/checks/hygieneChecks.ts';

const {
  mockJiraGet,
  mockUseMentionsState,
  mockUseSprintData,
  mockUseConnectionStore,
  mockUseSettingsStore,
  mockLoadDashboardConfig,
  mockRunHygieneScan,
  mockLoadHygieneEvaluationSetup,
} = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockUseMentionsState: vi.fn(),
  mockUseSprintData: vi.fn(),
  mockUseConnectionStore: vi.fn(),
  mockUseSettingsStore: vi.fn(),
  mockLoadDashboardConfig: vi.fn(),
  mockRunHygieneScan: vi.fn(),
  mockLoadHygieneEvaluationSetup: vi.fn(),
}));

vi.mock('../../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../../hooks/useMentionsState.ts', () => ({ useMentionsState: mockUseMentionsState }));
vi.mock('../../../SprintDashboard/hooks/useSprintData.ts', () => ({ useSprintData: mockUseSprintData }));
vi.mock('../../../SprintDashboard/hooks/useDashboardConfig.ts', () => ({
  loadDashboardConfigFromStorage: mockLoadDashboardConfig,
}));
vi.mock('../../../Hygiene/hooks/hygieneScan.ts', () => ({
  runHygieneScan: mockRunHygieneScan,
  loadHygieneEvaluationSetup: mockLoadHygieneEvaluationSetup,
}));
vi.mock('../../../../store/connectionStore.ts', () => ({ useConnectionStore: mockUseConnectionStore }));
vi.mock('../../../../store/settingsStore.ts', () => ({ useSettingsStore: mockUseSettingsStore }));

import { useTodayDashboard } from './useTodayDashboard.ts';

const LONG_PAST_ISO = '2020-01-01T00:00:00.000Z';

function recentIso(): string {
  return new Date().toISOString();
}

function buildIssue(key: string, fields: Record<string, unknown>) {
  return { id: key, key, fields: { summary: `Summary ${key}`, ...fields } };
}

/** Builds a shared-scan finding: an issue plus the check flags the scan raised for it. */
function buildFinding(key: string, checkIds: string[]): HygieneFinding {
  return {
    issue: buildIssue(key, { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })),
    programIncrement: null,
  } as unknown as HygieneFinding;
}

function buildScanOutcome(findings: HygieneFinding[]) {
  return {
    findings,
    scannedIssueCount: findings.length,
    fieldConfig: {},
    enabledCheckDefinitions: [],
  };
}

function buildSprintData(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      boardId: 1,
      projectKey: 'PROJ',
      scopeMode: 'sprint',
      selectedSprintId: null,
      selectedFixVersionName: '',
      selectedPiValue: '',
      sprintIssues: [] as unknown[],
      isLoadingSprint: false,
      loadError: null as string | null,
      sprintInfo: { id: 7, name: 'Sprint 7', state: 'active', startDate: '', endDate: '' },
      ...overrides,
    },
    actions: { loadSprint: vi.fn().mockResolvedValue(undefined) },
  };
}

function buildMentions(overrides: Record<string, unknown> = {}) {
  return {
    visibleMentions: [{ mentionKey: 'TBX-1#1' }],
    isLoading: false,
    loadError: null as string | null,
    reload: vi.fn(),
    ...overrides,
  };
}

/** Builds a saved Dashboard Team profile with the fields the multi-team scan reads. */
function buildTeamProfile(id: string, name: string, projectKey: string) {
  return {
    id,
    name,
    projectKey,
    boardId: '1',
    boardName: `${name} board`,
    boardType: 'scrum',
    scopeMode: 'pi',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: 'PI 26.4 (07/30/26 - 10/07/26)',
  };
}

/** Points the mocked settings store at the given saved team profiles. */
function installSettingsStore(teamProfiles: ReturnType<typeof buildTeamProfile>[]) {
  mockUseSettingsStore.mockImplementation(
    (selector: (state: {
      sprintDashboardActiveTeamProfileId: string;
      dsuProjectKey: string;
      sprintDashboardTeamProfiles: ReturnType<typeof buildTeamProfile>[];
    }) => unknown) =>
      selector({
        sprintDashboardActiveTeamProfileId: teamProfiles[0]?.id ?? '',
        dsuProjectKey: 'PROJ',
        sprintDashboardTeamProfiles: teamProfiles,
      }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockLoadDashboardConfig.mockReturnValue({ staleDaysThreshold: 5, customStoryPointsFieldId: '' });
  mockRunHygieneScan.mockResolvedValue(buildScanOutcome([]));
  // The personal half now asks for the SAME setup the team scan uses — instance-resolved field ids,
  // the admin's enabled checks, the team's thresholds — instead of hard-coding its own.
  mockLoadHygieneEvaluationSetup.mockResolvedValue({
    evaluationContext: {
      fieldConfig: { targetEndFieldIds: ['customfield_88888'], targetStartFieldIds: ['customfield_77777'] },
      enabledBuiltInCheckIds: new Set(['due-date-overdue', 'target-end-overdue', 'stale', 'no-assignee']),
      staleDaysThreshold: 5,
    },
    requestedFields: ['summary', 'status', 'issuetype', 'duedate', 'customfield_88888'],
    enabledCheckDefinitions: [],
  });
  mockUseConnectionStore.mockImplementation((selector: (state: { isJiraReady: boolean }) => unknown) =>
    selector({ isJiraReady: true }),
  );
  installSettingsStore([]);
  mockUseMentionsState.mockReturnValue(buildMentions());
  mockUseSprintData.mockReturnValue(buildSprintData());
  mockJiraGet.mockImplementation((path: string) => {
    if (path.includes('currentUser')) {
      return Promise.resolve({ issues: [] });
    }
    return Promise.resolve({ issues: [] });
  });
});

describe('useTodayDashboard', () => {
  it('resolves every card independently to ready', async () => {
    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['my-stale'].status).toBe('ready'));
    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('ready'));

    expect(result.current.categories.mentions.status).toBe('ready');
    expect(result.current.categories.blockers.status).toBe('ready');
    expect(result.current.categories.untriaged.status).toBe('ready');
  });

  it('sets only the my-issues cards to error when that fetch throws, leaving others ready', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('currentUser')) {
        return Promise.reject(new Error('my-issues boom'));
      }
      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['my-stale'].status).toBe('error'));
    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('ready'));

    expect(result.current.categories['my-stale'].errorMessage).toBe('my-issues boom');
    expect(result.current.categories.mentions.status).toBe('ready');
    expect(result.current.categories.untriaged.status).toBe('ready');
  });

  it('sets only the team hygiene cards to error when the shared scan fails, leaving sprint cards ready', async () => {
    mockRunHygieneScan.mockRejectedValue(new Error('scan boom'));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('error'));

    expect(result.current.categories['team-stale'].errorMessage).toBe('scan boom');
    expect(result.current.categories.unassigned.status).toBe('error');
    expect(result.current.categories['commitment-gaps'].status).toBe('error');
    // Blockers reads the sprint issue list (its drill-through is the Blockers tab), not the scan.
    await waitFor(() => expect(result.current.categories.blockers.status).toBe('ready'));
  });

  // ── Multi-team scans (GH #282 follow-up: an SM sees ALL their saved teams) ──

  it('runs one scan per saved team profile and counts the deduped union across teams', async () => {
    installSettingsStore([
      buildTeamProfile('alpha-id', 'Alpha', 'ALPHA'),
      buildTeamProfile('beta-id', 'Beta', 'BETA'),
    ]);
    mockRunHygieneScan.mockImplementation(({ projectKey }: { projectKey: string }) => {
      if (projectKey === 'ALPHA') {
        return Promise.resolve(buildScanOutcome([buildFinding('SHARED-1', ['stale']), buildFinding('A-2', ['stale'])]));
      }
      return Promise.resolve(buildScanOutcome([buildFinding('SHARED-1', ['stale']), buildFinding('B-3', ['stale'])]));
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('ready'));

    // One scan per profile, each under ITS OWN profile id so per-team config applies.
    expect(mockRunHygieneScan).toHaveBeenCalledWith(expect.objectContaining({ projectKey: 'ALPHA', activeTeamProfileId: 'alpha-id' }));
    expect(mockRunHygieneScan).toHaveBeenCalledWith(expect.objectContaining({ projectKey: 'BETA', activeTeamProfileId: 'beta-id' }));

    // SHARED-1 appears in both teams but counts once: {SHARED-1, A-2, B-3} = 3.
    expect(result.current.categories['team-stale'].count).toBe(3);
    expect(result.current.categories['team-stale'].teamBreakdown).toEqual([
      { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false },
      { teamProfileId: 'beta-id', teamName: 'Beta', count: 2, hasError: false, isProjectWideScope: false },
    ]);
  });

  it('stays ready with the surviving teams when one team scan fails, marking that team in the breakdown', async () => {
    installSettingsStore([
      buildTeamProfile('alpha-id', 'Alpha', 'ALPHA'),
      buildTeamProfile('beta-id', 'Beta', 'BETA'),
    ]);
    mockRunHygieneScan.mockImplementation(({ projectKey }: { projectKey: string }) => {
      if (projectKey === 'ALPHA') {
        return Promise.reject(new Error('alpha scan boom'));
      }
      return Promise.resolve(buildScanOutcome([buildFinding('B-1', ['stale'])]));
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('ready'));

    expect(result.current.categories['team-stale'].count).toBe(1);
    expect(result.current.categories['team-stale'].teamBreakdown).toEqual([
      { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 0, hasError: true, isProjectWideScope: false },
      { teamProfileId: 'beta-id', teamName: 'Beta', count: 1, hasError: false, isProjectWideScope: false },
    ]);
  });

  it('reports error only when EVERY team scan fails', async () => {
    installSettingsStore([
      buildTeamProfile('alpha-id', 'Alpha', 'ALPHA'),
      buildTeamProfile('beta-id', 'Beta', 'BETA'),
    ]);
    mockRunHygieneScan.mockRejectedValue(new Error('all scans boom'));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['team-stale'].status).toBe('error'));
    expect(result.current.categories['team-stale'].errorMessage).toBe('all scans boom');
  });

  it('marks team-scope cards not-configured when no project key is available for the scan', async () => {
    mockUseSprintData.mockReturnValue(buildSprintData({ boardId: null, projectKey: '' }));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['my-stale'].status).toBe('ready'));

    expect(result.current.categories['team-stale'].status).toBe('not-configured');
    expect(result.current.categories.unassigned.status).toBe('not-configured');
    expect(result.current.categories['commitment-gaps'].status).toBe('not-configured');
    expect(mockRunHygieneScan).not.toHaveBeenCalled();
  });

  it('computes personal counts from the shared selectors and team counts from the scan findings', async () => {
    mockUseMentionsState.mockReturnValue(
      buildMentions({ visibleMentions: [{ mentionKey: 'TBX-1#1' }, { mentionKey: 'TBX-2#1' }] }),
    );
    mockRunHygieneScan.mockResolvedValue(
      buildScanOutcome([
        buildFinding('TEAM-1', ['no-assignee']),
        buildFinding('TEAM-2', ['stale']),
      ]),
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('currentUser')) {
        return Promise.resolve({
          issues: [
            buildIssue('MINE-1', {
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              updated: recentIso(),
            }),
            buildIssue('MINE-2', {
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              updated: LONG_PAST_ISO,
            }),
          ],
        });
      }
      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['my-stale'].status).toBe('ready'));
    await waitFor(() => expect(result.current.categories.unassigned.status).toBe('ready'));

    expect(result.current.categories.mentions.count).toBe(2);
    expect(result.current.categories.blockers.count).toBe(1);
    expect(result.current.categories['my-stale'].count).toBe(1);
    expect(result.current.categories.unassigned.count).toBe(1);
    expect(result.current.categories['team-stale'].count).toBe(1);
  });

  it('runs the SAME scan the team Hygiene tab runs — same project, same scope JQL, no assignee filter (GH #177)', async () => {
    // The team dashboard is on the PI scope. The Hygiene tab scans
    // `project=ENCUC AND statusCategory != Done AND cf[10301] = "PI 26.3"`; the Today cards must
    // count that exact scan — counting the sprint issue list (which includes Done issues and can
    // miss configured fields) produced 58 phantom commitment gaps beside a tab showing 1.
    mockUseSprintData.mockReturnValue(
      buildSprintData({ projectKey: 'ENCUC', scopeMode: 'pi', selectedPiValue: 'PI 26.3' }),
    );
    mockRunHygieneScan.mockResolvedValue(
      buildScanOutcome([
        buildFinding('ENCUC-1', ['missing-sp']),
        buildFinding('ENCUC-2', ['no-ac', 'stale']),
        buildFinding('ENCUC-3', ['stale']),
      ]),
    );

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['commitment-gaps'].status).toBe('ready'));

    expect(mockRunHygieneScan).toHaveBeenCalledWith({
      projectKey: 'ENCUC',
      extraJql: 'AND cf[10301] = "PI 26.3"',
      assigneeClause: null,
      activeTeamProfileId: '',
    });
    // Counts are per issue, straight off the shared findings: one missing-sp + one no-ac issue.
    expect(result.current.categories['commitment-gaps'].count).toBe(2);
    expect(result.current.categories['team-stale'].count).toBe(2);
  });

  it('points every card at a destination that answers the same question the card counted (GH #167)', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.categories['my-stale'].status).toBe('ready'));
    const categories = result.current.categories;

    // My-stale counts cross-project personal issues → Hygiene opens in that exact scope, stale-filtered.
    expect(categories['my-stale'].destination).toEqual({
      kind: 'myIssuesTab',
      tab: 'hygiene',
      search: { hygieneScope: 'mine', hygieneFilter: 'stale' },
    });
    // Unassigned and commitment-gap counts come from TEAM sprint issues → the team Hygiene tab.
    // The personal tab filters to assignee = currentUser(), where an unassigned issue can never
    // appear — the old link was a guaranteed zero. Each team card also carries ITS check filter,
    // so three different cards no longer land on one identical unfiltered view (GH #177).
    expect(categories['team-stale'].destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      search: { hygieneFilter: 'stale' },
    });
    expect(categories.unassigned.destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      search: { hygieneFilter: 'no-assignee' },
    });
    expect(categories['commitment-gaps'].destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      search: { hygieneFilter: 'missing-sp,no-ac' },
    });
    // Due/overdue is a my+team union; the cross-project personal scope shows the "my" half, and it
    // carries its check filter like every other hygiene-bound card — without one, Hygiene falls back
    // to the filter it last persisted and hides the very issues this card counted.
    expect(categories['due-overdue'].destination).toEqual({
      kind: 'myIssuesTab',
      tab: 'hygiene',
      search: { hygieneScope: 'mine', hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
  });
});

describe('useTodayDashboard — the two halves of Due / overdue share one configuration', () => {
  it('requests the personal issues with the fields the shared setup resolved, not a hard-coded list', async () => {
    // The bug this pins: the personal fetch named customfield_10101/10102 in its own string, so on
    // an instance whose Target End lives elsewhere the "my" half was reading a field that is always
    // empty — reporting zero overdue while the team half, which resolves by name, reported some.
    renderHook(() => useTodayDashboard());

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalled());
    // Match on the JQL, not the field list — the untriaged query happens to REQUEST the assignee
    // field, and matching on the raw path would have picked that one up instead.
    const personalSearchPath = mockJiraGet.mock.calls
      .map(([requestPath]) => decodeURIComponent(String(requestPath)))
      .find((requestPath) => requestPath.includes('jql=assignee ='));

    expect(personalSearchPath).toBeDefined();
    expect(personalSearchPath).toContain('customfield_88888');
    expect(personalSearchPath).not.toContain('customfield_10102');
  });

  it('honours a rule the admin disabled on the personal half too', async () => {
    // Previously the personal half passed no enabled-check set at all, so `evaluateHygieneIssue`
    // defaulted to every rule: switching a rule off in Admin Hub silenced the team half and left
    // the personal half still counting it, and the card's total never went to zero.
    mockLoadHygieneEvaluationSetup.mockResolvedValue({
      evaluationContext: {
        fieldConfig: { targetEndFieldIds: ['customfield_88888'], targetStartFieldIds: ['customfield_77777'] },
        enabledBuiltInCheckIds: new Set(['stale']),
        staleDaysThreshold: 5,
      },
      requestedFields: ['summary', 'status', 'issuetype', 'duedate'],
      enabledCheckDefinitions: [],
    });
    mockJiraGet.mockImplementation((requestPath: string) =>
      Promise.resolve({
        issues: decodeURIComponent(String(requestPath)).includes('jql=assignee =')
          ? [{
            id: '1', key: 'MINE-1',
            fields: {
              summary: 'Overdue story', issuetype: { name: 'Story' },
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
              created: LONG_PAST_ISO, updated: recentIso(), duedate: '2020-01-01',
            },
          }]
          : [],
      }));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    expect(result.current.categories['due-overdue'].count).toBe(0);
  });
});

describe('useTodayDashboard — the Due / overdue card opens on what it counted', () => {
  it('carries its own check filter, so the view is not left on whatever filter was last used', async () => {
    // The reported bug: this was the ONE hygiene-bound card with no hygieneFilter. Hygiene falls
    // back to the filter persisted in localStorage when a deep link supplies none, so clicking Open
    // landed on a view still filtered to whatever check was looked at last — and the overdue issues
    // it had just counted were filtered straight back out.
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));

    expect(result.current.categories['due-overdue'].destination).toEqual({
      kind: 'myIssuesTab',
      tab: 'hygiene',
      search: { hygieneScope: 'mine', hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
  });

  it('names both scopes it counted, each opening its own correctly-scoped view', async () => {
    // The count is a my + team union, but one link can only ever show one of those scopes. Rather
    // than silently showing a fraction of the number on the card, the card says which half is which
    // and lets the user open either.
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));

    const scopeShares = result.current.categories['due-overdue'].scopeBreakdown;
    expect(scopeShares?.map((share) => share.id)).toEqual(['mine', 'team']);
    // One team, so the summary chip can name it; the destination carries the profile to activate.
    expect(scopeShares?.find((share) => share.id === 'team')?.destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      teamProfileId: 'alpha-id',
      search: { hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
  });
});

describe('useTodayDashboard — a capped count says it is capped', () => {
  it('pages the personal fetch instead of stopping at the first hundred', async () => {
    // The personal search asked for 100 and presented whatever came back as the answer, so a queue
    // of 140 reported the wrong number on every personal card with nothing to say so.
    mockJiraGet.mockImplementation((requestPath: string) => {
      const decodedPath = decodeURIComponent(String(requestPath));
      if (!decodedPath.includes('jql=assignee =')) return Promise.resolve({ issues: [] });
      const startAt = Number(/startAt=(\d+)/.exec(decodedPath)?.[1] ?? '0');
      const totalIssues = 140;
      return Promise.resolve({
        total: totalIssues,
        issues: Array.from({ length: Math.max(0, Math.min(100, totalIssues - startAt)) }, (_unused, i) => ({
          id: String(startAt + i), key: `MINE-${startAt + i}`,
          fields: {
            summary: 'Overdue', issuetype: { name: 'Story' },
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
            created: LONG_PAST_ISO, updated: recentIso(), duedate: '2020-01-01',
          },
        })),
      });
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    expect(result.current.categories['due-overdue'].count).toBe(140);
    expect(result.current.categories['due-overdue'].isPartial).toBeFalsy();
  });

  it('marks the card partial when the personal fetch could not reach the end', async () => {
    mockJiraGet.mockImplementation((requestPath: string) => {
      const decodedPath = decodeURIComponent(String(requestPath));
      if (!decodedPath.includes('jql=assignee =')) return Promise.resolve({ issues: [] });
      const startAt = Number(/startAt=(\d+)/.exec(decodedPath)?.[1] ?? '0');
      return Promise.resolve({
        total: 100_000,
        issues: Array.from({ length: 100 }, (_unused, i) => ({
          id: String(startAt + i), key: `MINE-${startAt + i}`,
          fields: {
            summary: 'Overdue', issuetype: { name: 'Story' },
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
            created: LONG_PAST_ISO, updated: recentIso(), duedate: '2020-01-01',
          },
        })),
      });
    });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    expect(result.current.categories['due-overdue'].isPartial).toBe(true);
    expect(result.current.categories['my-stale'].isPartial).toBe(true);
  });
});

describe('useTodayDashboard — the Due / overdue count is attributable to a team', () => {
  /** Two ENCUC teams: one scoped to a PI, one whose saved scope selects the whole project. */
  function installTwoTeamsOneUnscoped() {
    const scopedTeam = buildTeamProfile('alpha-id', 'Transformers', 'ENCUC');
    const unscopedTeam = { ...buildTeamProfile('beta-id', 'Cleanup Crew', 'ENCUC'), selectedPiValue: '' };
    installSettingsStore([scopedTeam, unscopedTeam]);
  }

  it('breaks the team half down per team, like every other team-fed card', async () => {
    // The reported symptom: the card said 26 while the team Hygiene tab — the very scan it counts —
    // showed 2, and nothing on the card explained where the other 24 lived. They were a SECOND team
    // profile whose saved scope selects the whole project, so its scan is a superset of the
    // PI-scoped tab. The count was right; it was unattributable and unreachable.
    installTwoTeamsOneUnscoped();
    mockJiraGet.mockResolvedValue({ issues: [] });
    mockRunHygieneScan.mockImplementation((options: { extraJql: string }) => Promise.resolve(buildScanOutcome(
      options.extraJql === ''
        ? [buildFinding('WIDE-1', ['due-date-overdue']), buildFinding('WIDE-2', ['due-date-overdue'])]
        : [buildFinding('WIDE-1', ['due-date-overdue'])],
    )));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    expect(result.current.categories['due-overdue'].teamBreakdown?.map((share) => [share.teamName, share.count]))
      .toEqual([['Transformers', 1], ['Cleanup Crew', 2]]);
  });

  it('does not offer a Team chip that would open the wrong team', async () => {
    // A chip labelled "Team 26" that lands on whichever team happens to be active shows 2 of 26 —
    // precisely the dead end this card already had. With several teams the per-team chips do the
    // navigating and the summary chip stays a plain label.
    installTwoTeamsOneUnscoped();
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    const teamShare = result.current.categories['due-overdue'].scopeBreakdown?.find((share) => share.id === 'team');
    expect(teamShare?.destination).toBeUndefined();
  });

  it('keeps the Team chip clickable when there is only one team to open', async () => {
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    const teamShare = result.current.categories['due-overdue'].scopeBreakdown?.find((share) => share.id === 'team');
    expect(teamShare?.destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      teamProfileId: 'alpha-id',
      search: { hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
    expect(teamShare?.teamProfileId).toBe('alpha-id');
  });
});

describe('useTodayDashboard — Open goes where the work actually is', () => {
  it('opens the largest share, not the personal half by default', async () => {
    // The whole "I cannot find them" complaint: the card counted 26 and its Open button went to the
    // personal Hygiene tab, which can only ever show the 1 that is mine. The 24 were reachable only
    // by noticing a chip. Open now leads to whichever share holds the most of the number on the card.
    const scopedTeam = buildTeamProfile('alpha-id', 'Transformers', 'ENCUC');
    installSettingsStore([scopedTeam]);
    mockJiraGet.mockResolvedValue({ issues: [] });
    mockRunHygieneScan.mockResolvedValue(buildScanOutcome([
      buildFinding('TEAM-1', ['due-date-overdue']),
      buildFinding('TEAM-2', ['due-date-overdue']),
    ]));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].status).toBe('ready'));
    expect(result.current.categories['due-overdue'].destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      teamProfileId: 'alpha-id',
      search: { hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
  });

  it('still opens the personal view when the personal half is the larger one', async () => {
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockRunHygieneScan.mockResolvedValue(buildScanOutcome([]));
    mockJiraGet.mockImplementation((requestPath: string) =>
      Promise.resolve({
        issues: decodeURIComponent(String(requestPath)).includes('jql=assignee =')
          ? [{
            id: '1', key: 'MINE-1',
            fields: {
              summary: 'Overdue', issuetype: { name: 'Story' },
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
              created: LONG_PAST_ISO, updated: recentIso(), duedate: '2020-01-01',
            },
          }]
          : [],
      }));

    const { result } = renderHook(() => useTodayDashboard());

    await waitFor(() => expect(result.current.categories['due-overdue'].count).toBe(1));
    expect(result.current.categories['due-overdue'].destination.kind).toBe('myIssuesTab');
  });
});


describe('the reporter configuration — two teams, the team half dominant', () => {
  it('names the team Open lands on, instead of trusting whichever team is active', async () => {
    // Proven wrong once already: the destination was a bare sprintTab link with no team identity,
    // and only handleOpenTeam activates a profile — so Open on a 26 could land on the team holding
    // 2 of it. A destination that cannot say which team it means is the same dead end as before.
    installSettingsStore([
      buildTeamProfile('alpha-id', 'Transformers', 'ENCUC'),
      buildTeamProfile('beta-id', 'Cleanup Crew', 'ENCUC'),
    ]);
    mockJiraGet.mockResolvedValue({ issues: [] });
    mockRunHygieneScan.mockImplementation((options: { activeTeamProfileId: string }) =>
      Promise.resolve(buildScanOutcome(
        options.activeTeamProfileId === 'alpha-id'
          ? Array.from({ length: 24 }, (_unused, index) => buildFinding(`T-${index}`, ['due-date-overdue']))
          : Array.from({ length: 2 }, (_unused, index) => buildFinding(`C-${index}`, ['due-date-overdue'])),
      )));

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.categories['due-overdue'].count).toBe(26));

    expect(result.current.categories['due-overdue'].destination).toEqual({
      kind: 'sprintTab',
      tab: 'hygiene',
      teamProfileId: 'alpha-id',
      search: { hygieneFilter: 'due-date-overdue,target-end-overdue' },
    });
  });
});

describe('the daily forecast', () => {
  // Everything here is computed over issues the scans ALREADY returned. If any of it started
  // costing a Jira request, the Today tab would go from one round of fetches to two.

  it('holds no forecast until the hygiene setup has landed', async () => {
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockLoadHygieneEvaluationSetup.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useTodayDashboard());

    expect(result.current.forecast).toBeNull();
  });

  it('forecasts the issues the scans returned, without asking Jira for anything more', async () => {
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockRunHygieneScan.mockResolvedValue(buildScanOutcome([
      buildFinding('ENC-1', []),
      buildFinding('ENC-2', []),
    ]));
    const jiraCallsBefore = mockJiraGet.mock.calls.length;

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.forecast).not.toBeNull());

    expect(result.current.forecast?.completeness.totalIssueCount).toBeGreaterThan(0);
    // The only Jira calls are the ones the cards already made — the forecast adds none.
    const forecastOnlyCalls = mockJiraGet.mock.calls.slice(jiraCallsBefore)
      .filter(([path]: [string]) => String(path).includes('/version'));
    expect(forecastOnlyCalls).toHaveLength(0);
  });

  it('counts one issue once even when it appears in both the personal and team scans', async () => {
    // A Scrum Master's own issues also show up in their team's scan. Counting one issue twice would
    // double its effort in every total it touches.
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockRunHygieneScan.mockResolvedValue(buildScanOutcome([buildFinding('ENC-1', []), buildFinding('ENC-1', [])]));

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.forecast).not.toBeNull());

    expect(result.current.forecast?.completeness.totalIssueCount).toBe(1);
  });

  it('says every item was charged at full size, because Today has no board columns', async () => {
    installSettingsStore([buildTeamProfile('alpha-id', 'Transformers', 'ENCUC')]);
    mockRunHygieneScan.mockResolvedValue(buildScanOutcome([buildFinding('ENC-1', [])]));

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(result.current.forecast).not.toBeNull());

    expect(result.current.forecast?.completeness.hasBoardVocabulary).toBe(false);
  });

  it('names every scanned team, so a forecast row can be attributed to one of them', async () => {
    installSettingsStore([
      buildTeamProfile('alpha-id', 'Transformers', 'ENCUC'),
      buildTeamProfile('beta-id', 'Cleanup Crew', 'ENCUC'),
    ]);

    const { result } = renderHook(() => useTodayDashboard());
    await waitFor(() => expect(Object.keys(result.current.teamNamesByProfileId)).toHaveLength(2));

    expect(result.current.teamNamesByProfileId).toEqual({
      'alpha-id': 'Transformers',
      'beta-id': 'Cleanup Crew',
    });
  });
});
