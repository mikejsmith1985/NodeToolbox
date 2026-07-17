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
} = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockUseMentionsState: vi.fn(),
  mockUseSprintData: vi.fn(),
  mockUseConnectionStore: vi.fn(),
  mockUseSettingsStore: vi.fn(),
  mockLoadDashboardConfig: vi.fn(),
  mockRunHygieneScan: vi.fn(),
}));

vi.mock('../../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../../hooks/useMentionsState.ts', () => ({ useMentionsState: mockUseMentionsState }));
vi.mock('../../../SprintDashboard/hooks/useSprintData.ts', () => ({ useSprintData: mockUseSprintData }));
vi.mock('../../../SprintDashboard/hooks/useDashboardConfig.ts', () => ({
  loadDashboardConfigFromStorage: mockLoadDashboardConfig,
}));
vi.mock('../../../Hygiene/hooks/hygieneScan.ts', () => ({ runHygieneScan: mockRunHygieneScan }));
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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockLoadDashboardConfig.mockReturnValue({ staleDaysThreshold: 5, customStoryPointsFieldId: '' });
  mockRunHygieneScan.mockResolvedValue(buildScanOutcome([]));
  mockUseConnectionStore.mockImplementation((selector: (state: { isJiraReady: boolean }) => unknown) =>
    selector({ isJiraReady: true }),
  );
  mockUseSettingsStore.mockImplementation(
    (selector: (state: { sprintDashboardActiveTeamProfileId: string; dsuProjectKey: string }) => unknown) =>
      selector({ sprintDashboardActiveTeamProfileId: '', dsuProjectKey: 'PROJ' }),
  );
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
    // Due/overdue is a my+team union; the cross-project personal scope shows the "my" half honestly.
    expect(categories['due-overdue'].destination).toEqual({
      kind: 'myIssuesTab',
      tab: 'hygiene',
      search: { hygieneScope: 'mine' },
    });
  });
});
