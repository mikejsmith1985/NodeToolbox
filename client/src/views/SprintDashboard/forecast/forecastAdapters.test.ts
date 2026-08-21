// forecastAdapters.test.ts — Two surfaces, two shapes, one engine.
//
// The board carries routed items; Today carries raw Jira issues from a hygiene search. What matters
// here is that neither adapter INVENTS anything: an absent estimate stays absent, an absent column
// means zero credit rather than a guessed position, and an unreadable sub-status is null rather
// than a value that would let a Feature claim it had reached the Definition of Done.

import { describe, expect, it } from 'vitest';

import {
  adaptBoardItem,
  adaptHygieneIssue,
  adaptHygieneIssues,
  collectFixVersionNames,
  type JiraIssueLike,
  type TodayAdapterFieldIds,
} from './forecastAdapters.ts';
import type { RollupBoardItem } from '../rollupBoard/rollupBoardTypes.ts';

const FIELD_IDS: TodayAdapterFieldIds = {
  storyPointsFieldIds: ['customfield_points', 'customfield_legacy_points'],
  subStatusFieldIds: ['customfield_substatus'],
  targetStartFieldIds: ['customfield_targetstart'],
};

function boardItem(overrides: Partial<RollupBoardItem> = {}): RollupBoardItem {
  return {
    issue: { key: 'ENC-1', fields: { status: { name: 'Working', statusCategory: { name: 'In Progress' } } } } as never,
    key: 'ENC-1',
    summary: '[DEV] Build it',
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], notes: [] } as never,
    featureKey: 'DENP-1',
    columnId: 'col-2',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 5,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
    ...overrides,
  };
}

function hygieneIssue(fields: Record<string, unknown>): JiraIssueLike {
  return { key: 'ENC-9', fields: { summary: 'Do the thing', status: { name: 'Working' }, ...fields } };
}

describe('adaptBoardItem', () => {
  it('carries every field the board already holds', () => {
    const adapted = adaptBoardItem(boardItem());
    expect(adapted.key).toBe('ENC-1');
    expect(adapted.columnId).toBe('col-2');
    expect(adapted.storyPoints).toBe(5);
    expect(adapted.featureKey).toBe('DENP-1');
    expect(adapted.fixVersionNames).toEqual(['Release 10/02/2026']);
  });

  it('reads completion from Jira status CATEGORY, never from the status name', () => {
    // Status names decide nothing here: a team calling a column "Done" that Jira still categorises
    // as in-progress is exactly how work gets counted as finished when it is not.
    const finished = adaptBoardItem(boardItem({
      issue: { key: 'ENC-1', fields: { status: { name: 'Accepted', statusCategory: { name: 'Done' } } } } as never,
    }));
    expect(finished.isComplete).toBe(true);
    expect(adaptBoardItem(boardItem()).isComplete).toBe(false);
  });

  it('states the two things the board cannot know as absent rather than guessing them', () => {
    const adapted = adaptBoardItem(boardItem());
    expect(adapted.actualStartIso).toBeNull();
    expect(adapted.storedTargetStartIso).toBeNull();
  });

  it('keeps an unestimated item unestimated', () => {
    expect(adaptBoardItem(boardItem({ storyPoints: null })).storyPoints).toBeNull();
  });
});

describe('adaptHygieneIssue', () => {
  it('reads the estimate from the first field that holds one', () => {
    const adapted = adaptHygieneIssue(hygieneIssue({ customfield_legacy_points: 8 }), FIELD_IDS);
    expect(adapted.storyPoints).toBe(8);
  });

  it('prefers the first configured field when several hold a value', () => {
    const adapted = adaptHygieneIssue(
      hygieneIssue({ customfield_points: 3, customfield_legacy_points: 8 }),
      FIELD_IDS,
    );
    expect(adapted.storyPoints).toBe(3);
  });

  it('leaves the estimate absent when no configured field holds a number', () => {
    expect(adaptHygieneIssue(hygieneIssue({}), FIELD_IDS).storyPoints).toBeNull();
  });

  it('reads a numeric estimate stored as text', () => {
    expect(adaptHygieneIssue(hygieneIssue({ customfield_points: '5' }), FIELD_IDS).storyPoints).toBe(5);
  });

  it('reads an estimate from a SELECT field, which is how this instance stores them', () => {
    // The bug this test exists for: Jira returns a select as { id, value }, and a reader handling
    // only numbers and strings saw every estimated issue as unestimated — a whole board of
    // "no estimate — cannot forecast" over work that was fully pointed.
    const adapted = adaptHygieneIssue(hygieneIssue({ customfield_points: { id: '10102', value: '5' } }), FIELD_IDS);
    expect(adapted.storyPoints).toBe(5);
  });

  it('treats an explicitly cleared select as unestimated rather than as zero', () => {
    const adapted = adaptHygieneIssue(hygieneIssue({ customfield_points: { id: '1', value: 'None' } }), FIELD_IDS);
    expect(adapted.storyPoints).toBeNull();
  });

  it('falls through a select that holds nothing to the next configured field', () => {
    const adapted = adaptHygieneIssue(
      hygieneIssue({ customfield_points: { id: '1', value: 'None' }, customfield_legacy_points: 8 }),
      FIELD_IDS,
    );
    expect(adapted.storyPoints).toBe(8);
  });

  it('reads a cascading sub-status through its value', () => {
    const adapted = adaptHygieneIssue(
      hygieneIssue({ customfield_substatus: { value: 'Integration Test' } }),
      FIELD_IDS,
    );
    expect(adapted.subStatusValue).toBe('Integration Test');
  });

  it('reads a plain-select sub-status directly', () => {
    const adapted = adaptHygieneIssue(hygieneIssue({ customfield_substatus: 'Testing' }), FIELD_IDS);
    expect(adapted.subStatusValue).toBe('Testing');
  });

  it('leaves the sub-status absent when the instance has no such field', () => {
    // Absent must never become a value: a fabricated "Integration Test" would let a Feature claim
    // it had met the PI commitment.
    const adapted = adaptHygieneIssue(hygieneIssue({}), {
      ...FIELD_IDS,
      subStatusFieldIds: [],
    });
    expect(adapted.subStatusValue).toBeNull();
  });

  it('charges every item at full size, because Today has no board to earn credit from', () => {
    expect(adaptHygieneIssue(hygieneIssue({}), FIELD_IDS).columnId).toBe('');
  });

  it('buckets issue types the way the sizing and chain rules need', () => {
    const asType = (name: string, subtask = false) => adaptHygieneIssue(
      hygieneIssue({ issuetype: { name, subtask } }),
      FIELD_IDS,
    ).typeBucket;
    expect(asType('Story')).toBe('story');
    expect(asType('Defect')).toBe('defect');
    expect(asType('Bug')).toBe('defect');
    expect(asType('Task')).toBe('other');
    expect(asType('Sub-task', true)).toBe('subtask');
  });

  it('reads the assignee under both identities Jira may give', () => {
    const adapted = adaptHygieneIssue(
      hygieneIssue({ assignee: { accountId: 'acct-7', displayName: 'Doe, John (CTR)' } }),
      FIELD_IDS,
    );
    expect(adapted.assigneeAccountId).toBe('acct-7');
    expect(adapted.assigneeDisplayName).toBe('Doe, John (CTR)');
  });

  it('reports an unassigned issue as unassigned under both identities', () => {
    const adapted = adaptHygieneIssue(hygieneIssue({}), FIELD_IDS);
    expect(adapted.assigneeAccountId).toBeNull();
    expect(adapted.assigneeDisplayName).toBeNull();
  });

  it('collects named fix versions and drops nameless ones', () => {
    const adapted = adaptHygieneIssue(
      hygieneIssue({ fixVersions: [{ name: 'Release 10/02/2026' }, { name: '  ' }, {}] }),
      FIELD_IDS,
    );
    expect(adapted.fixVersionNames).toEqual(['Release 10/02/2026']);
  });

  it('reads the stored Target Start as the day on its face', () => {
    // A Jira date field returned as a UTC-midnight datetime names the day written on it; converting
    // it would move the day for everyone west of Greenwich.
    const adapted = adaptHygieneIssue(
      hygieneIssue({ customfield_targetstart: '2026-08-20T00:00:00.000+0000' }),
      FIELD_IDS,
    );
    expect(adapted.storedTargetStartIso).toBe('2026-08-20');
  });

  it('leaves the stored Target Start absent when Jira holds none', () => {
    expect(adaptHygieneIssue(hygieneIssue({}), FIELD_IDS).storedTargetStartIso).toBeNull();
  });

  it('claims no Feature, because a hygiene scan does not resolve Feature links', () => {
    expect(adaptHygieneIssue(hygieneIssue({}), FIELD_IDS).featureKey).toBeNull();
  });
});

describe('adaptHygieneIssues', () => {
  it('adapts a whole scan in order', () => {
    const adapted = adaptHygieneIssues(
      [{ key: 'A-1', fields: {} }, { key: 'A-2', fields: {} }],
      FIELD_IDS,
    );
    expect(adapted.map((issue) => issue.key)).toEqual(['A-1', 'A-2']);
  });
});

describe('collectFixVersionNames', () => {
  it('de-duplicates and keeps first-seen order', () => {
    const names = collectFixVersionNames([
      adaptHygieneIssue(hygieneIssue({ fixVersions: [{ name: 'R2' }, { name: 'R1' }] }), FIELD_IDS),
      adaptHygieneIssue(hygieneIssue({ fixVersions: [{ name: 'R1' }] }), FIELD_IDS),
    ]);
    expect(names).toEqual(['R2', 'R1']);
  });

  it('returns nothing when no issue names a version', () => {
    expect(collectFixVersionNames([adaptHygieneIssue(hygieneIssue({}), FIELD_IDS)])).toEqual([]);
  });
});
