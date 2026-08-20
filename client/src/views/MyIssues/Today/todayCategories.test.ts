// todayCategories.test.ts — Unit tests for the Scrum Master "Today" dashboard selectors.
//
// These prove that the Today tab buckets issues purely through the existing Hygiene
// rules. Fixtures carry only the fields each rule actually reads, so a passing test
// documents exactly which Jira data drives each category.

import { describe, expect, it } from 'vitest';

import type { HygieneFinding, JiraIssue } from '../../Hygiene/checks/hygieneChecks.ts';
import {
  buildTeamCountBreakdown,
  CATEGORY_CATALOG,
  COMMITMENT_GAP_CHECK_IDS,
  countFindingsMatchingChecks,
  countUniqueFindingKeysAcrossTeams,
  isBlockedIssue,
  isDoneForToday,
  selectBlockers,
  selectDueOverdue,
  selectFindingKeysAcrossTeams,
  selectFindingKeysMatchingChecks,
  selectMyStale,
  selectUntriaged,
  TEAM_STALE_CHECK_IDS,
  TEAM_UNASSIGNED_CHECK_IDS,
  type CategoryId,
  type TeamScanEntry,
  countAllTeamHygieneFlags,
  resolveTeamScanScope,
} from './todayCategories.ts';

// A date far enough in the past to clear any stale / overdue threshold.
const LONG_PAST_ISO = '2020-01-01T00:00:00.000Z';
// A date far enough in the past as a plain Jira date-only string (overdue dates).
const LONG_PAST_DATE = '2020-01-01';

/** Builds a minimal hygiene JiraIssue, letting each test override only the fields it cares about. */
function createIssue(key: string, fields: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      ...fields,
    },
  };
}

// ── isBlockedIssue ──

describe('isBlockedIssue', () => {
  it('is true when the status name is Blocked', () => {
    expect(isBlockedIssue(createIssue('A-1', { status: { name: 'Blocked' } }))).toBe(true);
  });

  it('is true when the status name is Impeded', () => {
    expect(isBlockedIssue(createIssue('A-2', { status: { name: 'Impeded' } }))).toBe(true);
  });

  it('is true when the status name is On Hold', () => {
    expect(isBlockedIssue(createIssue('A-3', { status: { name: 'On Hold' } }))).toBe(true);
  });

  it('is false for an ordinary in-progress status', () => {
    expect(isBlockedIssue(createIssue('A-4', { status: { name: 'In Progress' } }))).toBe(false);
  });
});

// ── selectBlockers ──

describe('selectBlockers', () => {
  it('unions my + team blocked issues and dedupes a key present in both', () => {
    const sharedBlocked = createIssue('SHARED-1', { status: { name: 'Blocked' } });
    const myBlocked = createIssue('MY-1', { status: { name: 'Impeded' } });
    const teamBlocked = createIssue('TEAM-1', { status: { name: 'On Hold' } });
    const teamActive = createIssue('TEAM-2', { status: { name: 'In Progress' } });

    const blockers = selectBlockers([sharedBlocked, myBlocked], [sharedBlocked, teamBlocked, teamActive]);

    expect(blockers.map((issue) => issue.key)).toEqual(['SHARED-1', 'MY-1', 'TEAM-1']);
  });
});

// ── selectMyStale ──

describe('selectMyStale', () => {
  it('flags an in-progress issue not updated within the threshold', () => {
    const staleIssue = createIssue('MINE-1', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: LONG_PAST_ISO,
    });
    expect(selectMyStale([staleIssue]).map((issue) => issue.key)).toEqual(['MINE-1']);
  });

  it('does not flag a freshly updated in-progress issue', () => {
    const freshIssue = createIssue('MINE-2', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: new Date().toISOString(),
    });
    expect(selectMyStale([freshIssue])).toEqual([]);
  });
});

// ── Team hygiene selectors over shared-scan findings ──

/** Builds a scan finding fixture: an issue plus the flags the shared scan raised for it. */
function createFinding(key: string, checkIds: string[]): HygieneFinding {
  return {
    issue: createIssue(key),
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })),
    programIncrement: null,
  } as unknown as HygieneFinding;
}

describe('countFindingsMatchingChecks', () => {
  it('counts ISSUES, not flags — an issue raising both commitment-gap checks counts once', () => {
    const findings = [
      createFinding('TEAM-G', ['missing-sp', 'no-ac']),
      createFinding('TEAM-S', ['stale']),
    ];
    expect(countFindingsMatchingChecks(findings, COMMITMENT_GAP_CHECK_IDS)).toBe(1);
    expect(countFindingsMatchingChecks(findings, TEAM_STALE_CHECK_IDS)).toBe(1);
    expect(countFindingsMatchingChecks(findings, TEAM_UNASSIGNED_CHECK_IDS)).toBe(0);
  });

  it('matches a finding when ANY of its flags is in the requested check set', () => {
    const findings = [createFinding('TEAM-A', ['no-ac']), createFinding('TEAM-B', ['missing-sp'])];
    expect(countFindingsMatchingChecks(findings, COMMITMENT_GAP_CHECK_IDS)).toBe(2);
  });
});

describe('selectFindingKeysMatchingChecks', () => {
  it('returns the issue keys behind a count, for deduped my+team unions', () => {
    const findings = [createFinding('TEAM-D', ['due-date-overdue']), createFinding('TEAM-E', ['stale'])];
    expect(selectFindingKeysMatchingChecks(findings, ['due-date-overdue', 'target-end-overdue'])).toEqual(['TEAM-D']);
  });
});

// ── selectDueOverdue ──

describe('selectDueOverdue', () => {
  it('includes a feature-type issue past its due date and dedupes the my + team union', () => {
    const overdueEpic = createIssue('DUE-1', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Epic' },
      duedate: LONG_PAST_DATE,
    });
    const healthyStory = createIssue('DUE-2', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
    });

    const overdue = selectDueOverdue([overdueEpic, healthyStory], [overdueEpic]);

    expect(overdue.map((issue) => issue.key)).toEqual(['DUE-1']);
  });
});

// ── selectUntriaged ──

describe('selectUntriaged', () => {
  it('returns the curated new set unchanged', () => {
    const untriaged = [createIssue('NEW-1'), createIssue('NEW-2')];
    expect(selectUntriaged(untriaged)).toHaveLength(2);
  });
});

// ── isDoneForToday ──

describe('isDoneForToday', () => {
  it('is true only when every catalog category is complete', () => {
    const allComplete = Object.fromEntries(
      CATEGORY_CATALOG.map((entry) => [entry.id, true]),
    ) as Record<CategoryId, boolean>;
    expect(isDoneForToday(allComplete)).toBe(true);

    const oneOutstanding = { ...allComplete, mentions: false };
    expect(isDoneForToday(oneOutstanding)).toBe(false);
  });
});

// ── Multi-team counting (GH #282 follow-up: an SM sees ALL their saved teams) ──

/** Builds a shared-scan finding for the multi-team helpers. */
function buildTeamFinding(issueKey: string, checkIds: string[]): HygieneFinding {
  return {
    issue: createIssue(issueKey),
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })),
    programIncrement: null,
  } as unknown as HygieneFinding;
}

function buildTeamScan(
  teamProfileId: string,
  teamName: string,
  findings: HygieneFinding[],
  errorMessage: string | null = null,
): TeamScanEntry {
  return { teamProfileId, teamName, findings, errorMessage };
}

describe('countUniqueFindingKeysAcrossTeams', () => {
  it('sums matching findings across teams', () => {
    const teamScans = [
      buildTeamScan('alpha-id', 'Alpha', [buildTeamFinding('A-1', ['stale']), buildTeamFinding('A-2', ['no-assignee'])]),
      buildTeamScan('beta-id', 'Beta', [buildTeamFinding('B-1', ['stale'])]),
    ];

    expect(countUniqueFindingKeysAcrossTeams(teamScans, ['stale'])).toBe(2);
  });

  it('never counts the same issue key twice when it appears in two teams', () => {
    const teamScans = [
      buildTeamScan('alpha-id', 'Alpha', [buildTeamFinding('SHARED-1', ['stale'])]),
      buildTeamScan('beta-id', 'Beta', [buildTeamFinding('SHARED-1', ['stale']), buildTeamFinding('B-2', ['stale'])]),
    ];

    expect(countUniqueFindingKeysAcrossTeams(teamScans, ['stale'])).toBe(2);
  });
});

describe('selectFindingKeysAcrossTeams', () => {
  it('returns the deduped union of matching keys across teams', () => {
    const teamScans = [
      buildTeamScan('alpha-id', 'Alpha', [buildTeamFinding('SHARED-1', ['due-date-overdue'])]),
      buildTeamScan('beta-id', 'Beta', [buildTeamFinding('SHARED-1', ['due-date-overdue']), buildTeamFinding('B-9', ['target-end-overdue'])]),
    ];

    expect(selectFindingKeysAcrossTeams(teamScans, ['due-date-overdue', 'target-end-overdue'])).toEqual(['SHARED-1', 'B-9']);
  });
});

describe('buildTeamCountBreakdown', () => {
  it('reports one entry per team with its own count', () => {
    const teamScans = [
      buildTeamScan('alpha-id', 'Alpha', [buildTeamFinding('A-1', ['stale']), buildTeamFinding('A-2', ['stale'])]),
      buildTeamScan('beta-id', 'Beta', [buildTeamFinding('B-1', ['stale']), buildTeamFinding('B-2', ['no-assignee'])]),
    ];

    expect(buildTeamCountBreakdown(teamScans, ['stale'])).toEqual([
      { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false },
      { teamProfileId: 'beta-id', teamName: 'Beta', count: 1, hasError: false, isProjectWideScope: false },
    ]);
  });

  it('marks a failed team scan instead of showing a false zero', () => {
    const teamScans = [
      buildTeamScan('alpha-id', 'Alpha', [], 'scan boom'),
      buildTeamScan('beta-id', 'Beta', [buildTeamFinding('B-1', ['stale'])]),
    ];

    expect(buildTeamCountBreakdown(teamScans, ['stale'])).toEqual([
      { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 0, hasError: true, isProjectWideScope: false },
      { teamProfileId: 'beta-id', teamName: 'Beta', count: 1, hasError: false, isProjectWideScope: false },
    ]);
  });
});

describe('buildTeamCountBreakdown — an unscoped team says it audited everything', () => {
  it('marks a team whose scan carried no PI, sprint or fix-version clause', () => {
    // This is what made a Today count impossible to reconcile with a team's own Hygiene tab: a
    // saved profile with nothing selected scans the WHOLE project across all time, so its findings
    // are a superset of the PI-scoped tab and the extra ones appear to come from nowhere.
    const breakdown = buildTeamCountBreakdown([
      { teamProfileId: 'a', teamName: 'Transformers', findings: [], errorMessage: null, scopeJql: 'AND cf[10301] = "PI 26.4"' },
      { teamProfileId: 'b', teamName: 'Cleanup Crew', findings: [], errorMessage: null, scopeJql: '' },
    ], ['stale']);

    expect(breakdown.map((share) => share.isProjectWideScope)).toEqual([false, true]);
  });

  it('treats a whitespace-only clause as no clause at all', () => {
    const breakdown = buildTeamCountBreakdown(
      [{ teamProfileId: 'a', teamName: 'Alpha', findings: [], errorMessage: null, scopeJql: '   ' }],
      ['stale'],
    );

    expect(breakdown[0].isProjectWideScope).toBe(true);
  });
});

describe('countAllTeamHygieneFlags — the flags no Today card was watching', () => {
  // Today showed five green ticks while the team's Hygiene page held 41 flags: 27 missing Target
  // Start, 6 missing Target End, 6 missing Fix Version. None of those has a card, so a board with
  // real outstanding work read as "all clear" (GH #375). A checklist that is silent about most of
  // the list is worse than no checklist — it is a checklist that says you are finished.
  function finding(issueKey: string, checkIds: string[]): HygieneFinding {
    return {
      issue: { key: issueKey, fields: { summary: issueKey } },
      flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })),
    } as unknown as HygieneFinding;
  }

  it('counts every flag, not every issue', () => {
    // The Hygiene page reports flags. Counting issues here would produce a smaller number for the
    // same state and put the two surfaces back into disagreement.
    const flagCount = countAllTeamHygieneFlags([
      finding('A-1', ['missing-target-start', 'missing-target-end']),
      finding('A-2', ['missing-fix-version']),
    ]);

    expect(flagCount).toBe(3);
  });

  it('is zero for a clean scan', () => {
    expect(countAllTeamHygieneFlags([])).toBe(0);
  });

  it('counts the families no other card watches', () => {
    const flagCount = countAllTeamHygieneFlags([finding('A-1', ['missing-target-start'])]);

    expect(flagCount).toBe(1);
  });
});

describe('resolveTeamScanScope — the team on screen must agree with the page on screen', () => {
  // Today scoped every team from its PERSISTED selection while the Hygiene tab used the LIVE one,
  // so the team you are actually looking at could be audited against a different PI than the page
  // beside it — reporting 1 overdue where Hygiene showed 2 (GH #375).
  const LIVE = { scopeMode: 'pi', selectedPiValue: 'PI 26.4', selectedFixVersionName: '', selectedSprintId: null };

  it('uses the live selection for the active team', () => {
    const scope = resolveTeamScanScope(
      { teamProfileId: 'team-a', scopeMode: 'pi', selectedPiValue: 'PI 26.3', selectedFixVersion: '', selectedSprintId: null },
      'team-a',
      LIVE,
    );

    expect(scope.selectedPiValue).toBe('PI 26.4');
  });

  it('leaves every other team on its own saved selection', () => {
    // The live selection describes ONE team. Applying it to the others would audit them against a
    // PI they are not in, which is a worse answer than a slightly stale one.
    const scope = resolveTeamScanScope(
      { teamProfileId: 'team-b', scopeMode: 'pi', selectedPiValue: 'PI 26.3', selectedFixVersion: '', selectedSprintId: null },
      'team-a',
      LIVE,
    );

    expect(scope.selectedPiValue).toBe('PI 26.3');
  });

  it('falls back to the saved selection when no team is active', () => {
    const scope = resolveTeamScanScope(
      { teamProfileId: 'team-a', scopeMode: 'pi', selectedPiValue: 'PI 26.3', selectedFixVersion: '', selectedSprintId: null },
      '',
      LIVE,
    );

    expect(scope.selectedPiValue).toBe('PI 26.3');
  });

  it('ignores a live selection that names nothing, rather than emptying the scope', () => {
    // A dashboard mid-load has no PI yet. Taking that literally would widen the active team's scan
    // to the whole project and report a number nothing on screen explains.
    const scope = resolveTeamScanScope(
      { teamProfileId: 'team-a', scopeMode: 'pi', selectedPiValue: 'PI 26.3', selectedFixVersion: '', selectedSprintId: null },
      'team-a',
      { scopeMode: 'pi', selectedPiValue: '', selectedFixVersionName: '', selectedSprintId: null },
    );

    expect(scope.selectedPiValue).toBe('PI 26.3');
  });
});
