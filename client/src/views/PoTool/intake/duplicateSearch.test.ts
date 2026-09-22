// duplicateSearch.test.ts — Contract tests for "Check DENP" (spec 037, contracts/duplicate-search.md): the JQL it
// builds, how a named key is classified, how DENP's Epic type is resolved, and how each item's search settles or
// blocks its duplicate decision. Every Jira call is mocked.

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type EpicIntake,
  type EpicTypeResolution,
  type IntakeItem,
  type NamedKey,
} from './epicIntakeModel.ts';
import { isItemReadyToCreate } from './intakeChecklist.ts';
import {
  buildDuplicateSearchJql,
  classifyNamedKeyLookup,
  DESCRIPTION_EXCERPT_MAX_CHARS,
  DUPLICATE_SEARCH_MAX_RESULTS,
  resolveEpicType,
  runDuplicateSearch,
  type DuplicateSearchDeps,
} from './duplicateSearch.ts';

// ── Builders ──

const RESOLVED_EPIC_TYPE: EpicTypeResolution = { state: 'resolved', id: '10000', name: 'Epic' };

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'rule', reason: 'test', aiAttempts: 0 };
}

function buildIssue(key: string, overrides: Partial<{ type: string; statusName: string; category: string; description: unknown }> = {}): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary of ${key}`,
      status: { name: overrides.statusName ?? 'In Progress', statusCategory: { key: overrides.category ?? 'indeterminate' } },
      issuetype: { name: overrides.type ?? 'Epic', iconUrl: '' },
      description: (overrides.description ?? 'A description') as string,
    },
  } as unknown as JiraIssue;
}

function buildNamedKey(key: string): NamedKey {
  return { key, projectKey: key.split('-')[0], lineNumber: 1, lookup: { status: 'notRun' } };
}

function buildEnrollmentItem(itemNumber: number, title: string, namedKeys: NamedKey[] = []): IntakeItem {
  const item = createIntakeItem(itemNumber, title, [itemNumber]);
  return {
    ...item,
    namedKeys,
    decisions: { ...item.decisions, kind: settled('work' as const), owner: settled('enrollment' as const) },
  };
}

function buildIntake(items: IntakeItem[], epicType: EpicTypeResolution = RESOLVED_EPIC_TYPE): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: '2026-09-18T00:00:00.000Z',
    updatedAtIso: '2026-09-18T00:00:00.000Z',
    sourceTitles: ['Pasted notes'],
    lines: [],
    items,
    setAsideLines: [],
    epicType,
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

function buildDeps(overrides: Partial<DuplicateSearchDeps> = {}): DuplicateSearchDeps {
  return {
    getProjectIssueTypes: vi.fn(async () => ({ values: [{ id: '10000', name: 'Epic', subtask: false }] })),
    searchIssues: vi.fn(async () => []),
    fetchIssueByKey: vi.fn(async (issueKey: string) => buildIssue(issueKey)),
    extractHttpStatus: (thrownError: unknown) => {
      const statusMatch = /failed:\s*(\d{3})/.exec(thrownError instanceof Error ? thrownError.message : '');
      return statusMatch ? Number(statusMatch[1]) : null;
    },
    ...overrides,
  };
}

// ── buildDuplicateSearchJql ──

describe('buildDuplicateSearchJql', () => {
  it('ORs one summary-or-description clause per term and wraps the whole group so Done binds to every term', () => {
    expect(buildDuplicateSearchJql('DENP', 'Epic', ['member portal', 'id cards'])).toBe(
      'project = "DENP" AND issuetype = "Epic" AND statusCategory != Done AND '
        + '((summary ~ "member portal" OR description ~ "member portal") OR (summary ~ "id cards" OR description ~ "id cards")) '
        + 'ORDER BY updated DESC',
    );
  });

  it('sanitises a key-and-colon term so it cannot produce a 400, and adds no wildcard', () => {
    const searchJql = buildDuplicateSearchJql('DENP', 'Epic', ['ENCUC-1972: Critical']);
    expect(searchJql).toContain('(summary ~ "ENCUC 1972 Critical" OR description ~ "ENCUC 1972 Critical")');
    expect(searchJql).not.toContain('*');
    expect(searchJql).not.toContain(':');
  });

  it('escapes quotes in the project key and the type name', () => {
    expect(buildDuplicateSearchJql('DE"NP', 'Big "Epic"', ['portal'])).toContain('project = "DE\\"NP" AND issuetype = "Big \\"Epic\\""');
  });

  it('drops terms that do not survive sanitising, and returns null when none do', () => {
    expect(buildDuplicateSearchJql('DENP', 'Epic', ['"*"', 'portal'])).toContain('((summary ~ "portal" OR description ~ "portal"))');
    expect(buildDuplicateSearchJql('DENP', 'Epic', ['":*', ' '])).toBeNull();
    expect(buildDuplicateSearchJql('DENP', 'Epic', [])).toBeNull();
  });
});

// ── classifyNamedKeyLookup ──

describe('classifyNamedKeyLookup', () => {
  it('an open Epic in the target project is usable', () => {
    expect(classifyNamedKeyLookup(buildIssue('DENP-632'), 200, 'DENP', 'Epic')).toEqual({
      status: 'openEpicInTarget',
      summary: 'Summary of DENP-632',
    });
  });

  it('compares the issue type name case-insensitively', () => {
    expect(classifyNamedKeyLookup(buildIssue('DENP-632', { type: 'EPIC' }), 200, 'DENP', 'Epic').status).toBe('openEpicInTarget');
  });

  it.each([
    ['done by category', buildIssue('DENP-1', { category: 'done', statusName: 'Closed' }), 'done'],
    ['done by status name', buildIssue('DENP-1', { category: '', statusName: 'Done' }), 'done'],
    ['not an Epic', buildIssue('DENP-1', { type: 'Story' }), 'notEpic'],
    ['in another project', buildIssue('ENCUC-1972'), 'otherProject'],
  ])('a fetched issue that is %s is unusable', (_label, issue, expectedReason) => {
    const lookup = classifyNamedKeyLookup(issue, 200, 'DENP', 'Epic');
    expect(lookup).toMatchObject({ status: 'unusable', reason: expectedReason });
  });

  it.each([
    [404, 'notFound'],
    [401, 'noPermission'],
    [403, 'noPermission'],
    [500, 'error'],
    [null, 'error'],
  ])('a failed fetch answering %s is %s', (httpStatus, expectedReason) => {
    expect(classifyNamedKeyLookup(null, httpStatus, 'DENP', 'Epic')).toMatchObject({ status: 'unusable', reason: expectedReason });
  });
});

// ── resolveEpicType ──

describe('resolveEpicType', () => {
  it('picks the non-subtask Epic type, spelled the way the instance spells it', async () => {
    const getProjectIssueTypes = vi.fn(async () => ({
      values: [
        { id: '1', name: 'epic', subtask: true },
        { id: '2', name: 'EPIC', subtask: false },
      ],
    }));
    expect(await resolveEpicType('DENP', { getProjectIssueTypes })).toEqual({ state: 'resolved', id: '2', name: 'EPIC' });
    expect(getProjectIssueTypes).toHaveBeenCalledWith('DENP');
  });

  it('reports the offered types rather than falling back to Feature', async () => {
    const getProjectIssueTypes = vi.fn(async () => ({ values: [{ id: '3', name: 'Feature', subtask: false }] }));
    expect(await resolveEpicType('DENP', { getProjectIssueTypes })).toEqual({ state: 'missing', offeredTypeNames: ['Feature'] });
  });

  it('reports a request error with Jira\'s message', async () => {
    const getProjectIssueTypes = vi.fn(async () => {
      throw new Error('Jira GET failed: 503');
    });
    expect(await resolveEpicType('DENP', { getProjectIssueTypes })).toEqual({ state: 'error', reason: 'Jira GET failed: 503' });
  });
});

// ── runDuplicateSearch ──

describe('runDuplicateSearch — Epic type', () => {
  it('resolves the Epic type first and stores it on the intake', async () => {
    const deps = buildDeps();
    const searchedIntake = await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal')], { state: 'unresolved' }), deps);
    expect(searchedIntake.epicType).toEqual(RESOLVED_EPIC_TYPE);
  });

  it('a Feature-only project blocks every eligible item and never builds a query naming Feature', async () => {
    const deps = buildDeps({
      getProjectIssueTypes: vi.fn(async () => ({ values: [{ id: '3', name: 'Feature', subtask: false }] })),
    });
    const searchedIntake = await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal')], { state: 'unresolved' }), deps);
    expect(searchedIntake.epicType).toEqual({ state: 'missing', offeredTypeNames: ['Feature'] });
    expect(searchedIntake.items[0].searchStatus).toBe('failed');
    expect(searchedIntake.items[0].searchFailureReason).toContain('Feature');
    expect(deps.searchIssues).not.toHaveBeenCalled();
  });

  it('an issue-type request error blocks every eligible item with that reason', async () => {
    const deps = buildDeps({
      getProjectIssueTypes: vi.fn(async () => {
        throw new Error('Jira GET failed: 500');
      }),
    });
    const searchedIntake = await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal')], { state: 'unresolved' }), deps);
    expect(searchedIntake.items[0].searchStatus).toBe('failed');
    expect(searchedIntake.items[0].searchFailureReason).toContain('Jira GET failed: 500');
  });
});

describe('runDuplicateSearch — text search', () => {
  it('settles createNew by rule when a successful search finds nothing, taking terms from the title', async () => {
    const deps = buildDeps();
    const searchedIntake = await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal for ID cards')]), deps);
    const searchedItem = searchedIntake.items[0];
    expect(searchedItem.searchStatus).toBe('ok');
    expect(searchedItem.decisions.searchTerms).toMatchObject({ state: 'settled', value: ['Member', 'portal', 'cards'], reason: 'Terms taken from the item title' });
    expect(searchedItem.decisions.duplicate).toMatchObject({
      state: 'settled',
      value: { verdict: 'createNew' },
      reason: 'No open DENP Epic matched "Member, portal, cards"',
    });
    expect(deps.searchIssues).toHaveBeenCalledWith(expect.stringContaining('summary ~ "Member"'), ['summary', 'status', 'description', 'issuetype'], DUPLICATE_SEARCH_MAX_RESULTS);
  });

  it('uses settled terms when the slot was already answered', async () => {
    const item = buildEnrollmentItem(1, 'Member portal');
    const deps = buildDeps();
    await runDuplicateSearch(buildIntake([{ ...item, decisions: { ...item.decisions, searchTerms: settled(['id card reprint']) } }]), deps);
    expect(deps.searchIssues).toHaveBeenCalledWith(expect.stringContaining('summary ~ "id card reprint"'), expect.anything(), DUPLICATE_SEARCH_MAX_RESULTS);
  });

  it('keeps candidates in Jira order with plain-text, capped description excerpts, and leaves the slot open', async () => {
    const longDescription = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(900) }] }] };
    const deps = buildDeps({
      searchIssues: vi.fn(async () => [buildIssue('DENP-2', { description: longDescription }), buildIssue('DENP-1')]),
    });
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal')]), deps)).items[0];
    expect(searchedItem.candidates.map((candidate) => candidate.key)).toEqual(['DENP-2', 'DENP-1']);
    expect(searchedItem.candidates[0]).toMatchObject({ foundBy: 'search', statusName: 'In Progress', statusCategory: 'indeterminate' });
    expect(searchedItem.candidates[0].descriptionExcerpt.length).toBeLessThanOrEqual(DESCRIPTION_EXCERPT_MAX_CHARS);
    expect(searchedItem.candidates[0].descriptionExcerpt.startsWith('xxx')).toBe(true);
    expect(searchedItem.decisions.duplicate.state).toBe('open');
  });

  it('a failed search marks the item failed with Jira\'s message, so it cannot be created', async () => {
    const deps = buildDeps({
      searchIssues: vi.fn(async () => {
        throw new Error('Jira GET failed: 400');
      }),
    });
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Member portal')]), deps)).items[0];
    expect(searchedItem.searchStatus).toBe('failed');
    expect(searchedItem.searchFailureReason).toBe('Jira GET failed: 400');
    expect(searchedItem.decisions.duplicate.state).toBe('open');
    expect(isItemReadyToCreate(searchedItem)).toBe(false);
  });

  it('only searches Enrollment work with an open duplicate slot that has not already searched cleanly', async () => {
    const fulfillmentItem = { ...buildEnrollmentItem(1, 'Vendor work'), decisions: { ...buildEnrollmentItem(1, 'x').decisions, owner: settled('fulfillment' as const) } };
    const alreadySearched = { ...buildEnrollmentItem(2, 'Portal'), searchStatus: 'ok' as const };
    const previouslyFailed = { ...buildEnrollmentItem(3, 'Reprint cards'), searchStatus: 'failed' as const, searchFailureReason: 'old' };
    const deps = buildDeps();
    const searchedIntake = await runDuplicateSearch(buildIntake([fulfillmentItem, alreadySearched, previouslyFailed]), deps);
    expect(deps.searchIssues).toHaveBeenCalledTimes(1);
    expect(searchedIntake.items[2].searchStatus).toBe('ok');
    expect(searchedIntake.items[2].searchFailureReason).toBeNull();
    expect(searchedIntake.items[0]).toBe(fulfillmentItem);
  });

  it('searches sequentially and reports progress after each item', async () => {
    const progressSnapshots: string[][] = [];
    const deps = buildDeps();
    await runDuplicateSearch(
      buildIntake([buildEnrollmentItem(1, 'Member portal'), buildEnrollmentItem(2, 'Card reprints')]),
      deps,
      (progressIntake) => progressSnapshots.push(progressIntake.items.map((item) => item.searchStatus)),
    );
    expect(progressSnapshots).toEqual([['ok', 'notRun'], ['ok', 'ok']]);
  });
});

describe('runDuplicateSearch — named keys', () => {
  it('exactly one open named DENP Epic settles existing by rule and skips the text search', async () => {
    const deps = buildDeps();
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('DENP-632')])]), deps)).items[0];
    expect(searchedItem.decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'existing', key: 'DENP-632' }, reason: 'Notes name DENP-632' });
    expect(searchedItem.candidates).toEqual([expect.objectContaining({ key: 'DENP-632', foundBy: 'namedKey' })]);
    expect(searchedItem.namedKeys[0].lookup).toEqual({ status: 'openEpicInTarget', summary: 'Summary of DENP-632' });
    expect(searchedItem.searchStatus).toBe('ok');
    expect(searchedItem.decisions.label.state).toBe('notApplicable');
    expect(deps.searchIssues).not.toHaveBeenCalled();
  });

  it('two open named Epics settle nothing; both lead the candidates and search results are de-duplicated', async () => {
    const deps = buildDeps({ searchIssues: vi.fn(async () => [buildIssue('DENP-2'), buildIssue('DENP-3')]) });
    const searchedItem = (await runDuplicateSearch(
      buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('DENP-1'), buildNamedKey('DENP-2')])]),
      deps,
    )).items[0];
    expect(searchedItem.decisions.duplicate.state).toBe('open');
    expect(searchedItem.candidates.map((candidate) => `${candidate.key}:${candidate.foundBy}`)).toEqual([
      'DENP-1:namedKey',
      'DENP-2:namedKey',
      'DENP-3:search',
    ]);
  });

  it.each([
    ['Done', () => buildIssue('DENP-9', { category: 'done' }), 'done'],
    ['not an Epic', () => buildIssue('DENP-9', { type: 'Story' }), 'notEpic'],
  ])('a named key that is %s is noted on the row and becomes a new Epic when the search finds nothing', async (_label, buildFetched, expectedReason) => {
    const deps = buildDeps({ fetchIssueByKey: vi.fn(async () => buildFetched()) });
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('DENP-9')])]), deps)).items[0];
    expect(searchedItem.namedKeys[0].lookup).toMatchObject({ status: 'unusable', reason: expectedReason });
    // Copy-paste only (GH #387): an unusable named key is noted on the row, never put to the PO. With nothing found,
    // the item becomes a new Epic by rule.
    expect(searchedItem.decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'createNew' }, settledBy: 'rule' });
    expect(searchedItem.reviewFlag).toContain('DENP-9');
    expect(searchedItem.searchStatus).toBe('ok');
  });

  it.each([
    ['Jira GET failed: 404', 'notFound'],
    ['Jira GET failed: 403', 'noPermission'],
  ])('a named key whose fetch answers "%s" is %s and is noted, not put to the PO', async (errorMessage, expectedReason) => {
    const deps = buildDeps({
      fetchIssueByKey: vi.fn(async () => {
        throw new Error(errorMessage);
      }),
    });
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('DENP-9')])]), deps)).items[0];
    expect(searchedItem.namedKeys[0].lookup).toMatchObject({ status: 'unusable', reason: expectedReason });
    expect(searchedItem.decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'createNew' } });
  });

  it('a named key in another project is reported on the row, not put to the PO', async () => {
    const deps = buildDeps();
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('ENCUC-1972')])]), deps)).items[0];
    expect(searchedItem.namedKeys[0].lookup).toMatchObject({ status: 'unusable', reason: 'otherProject' });
    expect(searchedItem.decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'createNew' } });
  });

  it('a named key that cannot be looked up for another reason fails the item\'s search', async () => {
    const deps = buildDeps({
      fetchIssueByKey: vi.fn(async () => {
        throw new Error('Network down');
      }),
    });
    const searchedItem = (await runDuplicateSearch(buildIntake([buildEnrollmentItem(1, 'Portal', [buildNamedKey('DENP-9')])]), deps)).items[0];
    expect(searchedItem.namedKeys[0].lookup).toMatchObject({ status: 'unusable', reason: 'error', detail: 'Network down' });
    expect(searchedItem.searchStatus).toBe('failed');
    expect(searchedItem.searchFailureReason).toContain('DENP-9');
    expect(deps.searchIssues).not.toHaveBeenCalled();
  });
});
