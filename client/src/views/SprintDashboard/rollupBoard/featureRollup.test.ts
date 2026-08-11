// featureRollup.test.ts — Proves every issue on the board is turned into a placeable item that knows
// which Feature it delivers and how it got there.
//
// Features live in a different Jira project from the work, so the one thing that must NEVER happen is
// a project comparison quietly excluding a valid Feature.

import { describe, expect, it } from 'vitest';

import { resolveBoardItems } from './featureRollup.ts';
import { UNMAPPED_COLUMN_ID, type RollupBoardIssueSet, type RollupBoardScope } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const FEATURE_LINK_FIELD = 'customfield_10108';
const SUB_STATUS_FIELD = 'customfield_10201';

const SCOPE: RollupBoardScope = {
  boardId: 42,
  teamProfileId: 'team-a',
  featureLinkFieldId: FEATURE_LINK_FIELD,
  subStatusFieldId: SUB_STATUS_FIELD,
  storyPointsFieldIds: ['customfield_10016'],
};

interface BuildIssueInput {
  key: string;
  typeName: string;
  isSubtask?: boolean;
  parentKey?: string;
  featureKey?: string;
  epicKey?: string;
  statusName?: string;
  subStatusValue?: string;
  storyPoints?: unknown;
  assigneeAccountId?: string;
  fixVersionNames?: string[];
}

function buildIssue(input: BuildIssueInput): JiraIssue {
  return {
    id: input.key,
    key: input.key,
    fields: {
      summary: `Summary of ${input.key}`,
      status: { name: input.statusName ?? 'To Do' },
      issuetype: { name: input.typeName, subtask: input.isSubtask ?? false },
      parent: input.parentKey ? { key: input.parentKey } : null,
      assignee: input.assigneeAccountId
        ? { accountId: input.assigneeAccountId, displayName: 'Someone, Real (CTR)' }
        : null,
      fixVersions: (input.fixVersionNames ?? []).map((versionName) => ({ name: versionName })),
      issuelinks: [],
      [FEATURE_LINK_FIELD]: input.featureKey ?? null,
      customfield_10014: input.epicKey ?? null,
      [SUB_STATUS_FIELD]: input.subStatusValue ?? null,
      customfield_10016: input.storyPoints ?? null,
    },
  } as unknown as JiraIssue;
}

function buildIssueSet(
  boardIssues: JiraIssue[],
  subtaskIssues: JiraIssue[] = [],
  featureIssues: Map<string, JiraIssue> = new Map(),
): RollupBoardIssueSet {
  return {
    boardIssues,
    subtaskIssues,
    featureIssues,
    featureReadFailures: [],
    load: {
      isComplete: true,
      expectedBoardIssueCount: boardIssues.length,
      loadedBoardIssueCount: boardIssues.length,
      isOversized: false,
      failures: [],
    },
  };
}

/** Places everything in Unmapped, so these tests are about roll-up rather than columns. */
const UNMAPPED_RESOLVER = { resolveColumnId: () => UNMAPPED_COLUMN_ID };

describe('resolveBoardItems — Feature resolution', () => {
  it('resolves a Story through the configured Feature Link field', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'PORTFOLIO-9' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBe('PORTFOLIO-9');
    expect(item.route.steps[0]).toEqual({ kind: 'featureLink', fieldId: FEATURE_LINK_FIELD, toKey: 'PORTFOLIO-9' });
  });

  it('falls back to the classic Epic Link when the Feature Link field is empty', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', epicKey: 'PORTFOLIO-9' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBe('PORTFOLIO-9');
  });

  it('resolves a Feature in a completely different project, since no project is ever compared', () => {
    const story = buildIssue({ key: 'ENCUC-1', typeName: 'Story', featureKey: 'DIFFERENTPROJ-500' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBe('DIFFERENTPROJ-500');
  });

  it('leaves an issue unattributed when nothing links it to a Feature', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBeNull();
    expect(item.route.steps).toEqual([]);
  });
});

describe('resolveBoardItems — sub-tasks', () => {
  it('gives a sub-task the Feature of its parent, stating that it travelled through the parent', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'PORTFOLIO-9' });
    const subtask = buildIssue({ key: 'DEV-1-1', typeName: 'Sub-task', isSubtask: true, parentKey: 'DEV-1' });

    const items = resolveBoardItems(buildIssueSet([story], [subtask]), SCOPE, UNMAPPED_RESOLVER);
    const subtaskItem = items.find((item) => item.key === 'DEV-1-1');

    expect(subtaskItem?.featureKey).toBe('PORTFOLIO-9');
    expect(subtaskItem?.route.steps[0]).toEqual({ kind: 'parent', toKey: 'DEV-1' });
    expect(subtaskItem?.parentKey).toBe('DEV-1');
  });

  it('still places a sub-task whose parent is not on this board, and says the parent is out of scope', () => {
    const subtask = buildIssue({ key: 'OTHER-1-1', typeName: 'Sub-task', isSubtask: true, parentKey: 'OTHER-1' });

    const items = resolveBoardItems(buildIssueSet([], [subtask]), SCOPE, UNMAPPED_RESOLVER);

    expect(items[0].parentKey).toBe('OTHER-1');
    expect(items[0].route.notes).toContain('parent-out-of-scope');
  });
});

describe('resolveBoardItems — item shape', () => {
  it('classifies each issue into the visual family that will colour its card', () => {
    const issues = [
      buildIssue({ key: 'DEV-1', typeName: 'Story' }),
      buildIssue({ key: 'BUG-1', typeName: 'Defect' }),
      buildIssue({ key: 'SPIKE-1', typeName: 'Spike' }),
    ];
    const subtask = buildIssue({ key: 'DEV-1-1', typeName: 'Sub-task', isSubtask: true, parentKey: 'DEV-1' });

    const buckets = resolveBoardItems(buildIssueSet(issues, [subtask]), SCOPE, UNMAPPED_RESOLVER)
      .map((item) => item.typeBucket);

    expect(buckets).toEqual(expect.arrayContaining(['story', 'defect', 'other', 'subtask']));
  });

  it('reports a missing estimate as absent rather than as an estimate of zero', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.storyPoints).toBeNull();
  });

  it('reads story points from the dropdown option shape this Jira instance uses', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', storyPoints: { value: '8' } });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.storyPoints).toBe(8);
  });

  it('carries the sub-status through so a column can match on the full state', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', statusName: 'In Progress', subStatusValue: 'Dev Complete' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.statusName).toBe('In Progress');
    expect(item.subStatusValue).toBe('Dev Complete');
  });

  it('asks the column resolver for a placement using the item\'s OWN state', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story', statusName: 'In Progress', subStatusValue: 'Dev Complete' });
    const seenStates: Array<[string, string | null]> = [];

    resolveBoardItems(buildIssueSet([story]), SCOPE, {
      resolveColumnId: (statusName, subStatusValue) => {
        seenStates.push([statusName, subStatusValue]);
        return 'col-1';
      },
    });

    expect(seenStates).toEqual([['In Progress', 'Dev Complete']]);
  });

  it('never renders the same issue twice, even if a sweep returned it twice', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story' });

    const items = resolveBoardItems(buildIssueSet([story], [story]), SCOPE, UNMAPPED_RESOLVER);

    expect(items).toHaveLength(1);
  });

  it('leaves checklist completion absent when the issue carries no checklist data', () => {
    const story = buildIssue({ key: 'DEV-1', typeName: 'Story' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.checklistCompletion).toBeNull();
  });
});

describe('resolveBoardItems — defects linked straight to a Feature', () => {
  /** A defect whose only link is to a Feature, which is never itself on a team board. */
  function buildDefectLinkedToFeature(key: string, featureKey: string): JiraIssue {
    return {
      id: key,
      key,
      fields: {
        summary: `Summary of ${key}`,
        status: { name: 'To Do' },
        issuetype: { name: 'Defect', subtask: false },
        issuelinks: [{
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: featureKey },
        }],
        fixVersions: [],
      },
    } as unknown as JiraIssue;
  }

  function buildFeature(key: string): JiraIssue {
    return {
      id: key,
      key,
      fields: { summary: `Feature ${key}`, issuetype: { name: 'Feature', subtask: false }, issuelinks: [] },
    } as unknown as JiraIssue;
  }

  it('resolves a defect linked directly to a Feature, even though Features are never on the board', () => {
    // Regression: the resolver only searched the board's own issues, so this rank never fired at all.
    const defect = buildDefectLinkedToFeature('BUG-1', 'PORTFOLIO-9');
    const issueSet = buildIssueSet([defect], [], new Map([['PORTFOLIO-9', buildFeature('PORTFOLIO-9')]]));

    const [item] = resolveBoardItems(issueSet, SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBe('PORTFOLIO-9');
    expect(item.route.precedenceRank).toBe('direct-feature');
  });

  it('does not turn the Feature itself into a card on the board', () => {
    const defect = buildDefectLinkedToFeature('BUG-1', 'PORTFOLIO-9');
    const issueSet = buildIssueSet([defect], [], new Map([['PORTFOLIO-9', buildFeature('PORTFOLIO-9')]]));

    const items = resolveBoardItems(issueSet, SCOPE, UNMAPPED_RESOLVER);

    // The Feature is looked up, never rendered — it is the lane, not work inside it.
    expect(items.map((item) => item.key)).toEqual(['BUG-1']);
  });

  it('still leaves the defect unattributed when the Feature could not be read', () => {
    const defect = buildDefectLinkedToFeature('BUG-1', 'PORTFOLIO-9');

    const [item] = resolveBoardItems(buildIssueSet([defect]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.featureKey).toBeNull();
  });
});

describe('resolveBoardItems — who an issue is assigned to', () => {
  /** Jira Data Center identifies a user by name/key; accountId is Cloud-only. */
  function buildIssueAssignedOnDataCenter(key: string): JiraIssue {
    return {
      id: key,
      key,
      fields: {
        summary: key,
        status: { name: 'To Do' },
        issuetype: { name: 'Story', subtask: false },
        issuelinks: [],
        fixVersions: [],
        assignee: { name: 'jsmith', key: 'JIRAUSER123', displayName: 'Smith, Jane (CTR)' },
      },
    } as unknown as JiraIssue;
  }

  it('identifies an assignee on Jira Data Center, where there is no accountId', () => {
    // Reading accountId alone left every issue looking unassigned, so the assignee filter had
    // nobody to offer at all.
    const [item] = resolveBoardItems(buildIssueSet([buildIssueAssignedOnDataCenter('DEV-1')]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.assigneeAccountId).toBe('jsmith');
    expect(item.assigneeDisplayName).toBe('Smith, Jane (CTR)');
  });

  it('still prefers accountId when the instance is Jira Cloud', () => {
    const cloudIssue = {
      id: 'DEV-2',
      key: 'DEV-2',
      fields: {
        summary: 'DEV-2',
        status: { name: 'To Do' },
        issuetype: { name: 'Story', subtask: false },
        issuelinks: [],
        fixVersions: [],
        assignee: { accountId: 'abc-123', displayName: 'Smith, Jane (CTR)' },
      },
    } as unknown as JiraIssue;

    const [item] = resolveBoardItems(buildIssueSet([cloudIssue]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.assigneeAccountId).toBe('abc-123');
  });

  it('reports genuinely unassigned work as unassigned', () => {
    const story = buildIssue({ key: 'DEV-3', typeName: 'Story' });

    const [item] = resolveBoardItems(buildIssueSet([story]), SCOPE, UNMAPPED_RESOLVER);

    expect(item.assigneeAccountId).toBeNull();
  });
});

describe('containment links draw the same nesting as a real sub-task', () => {
  /** An issue carrying a "contained within" link pointing at another card. */
  function makeContainedIssue(key: string, containerKey: string, isInward = true) {
    return {
      id: key,
      key,
      fields: {
        summary: key,
        status: { name: 'To Do' },
        issuetype: { name: 'Story' },
        issuelinks: [{
          type: { name: 'Container', inward: 'is contained within', outward: 'contains' },
          ...(isInward ? { outwardIssue: { key: containerKey } } : { inwardIssue: { key: containerKey } }),
        }],
      },
    } as unknown as JiraIssue;
  }

  it('groups a contained issue under the card that contains it', () => {
    const issueSet = buildIssueSet([
      makeContainedIssue('DEV-2', 'DEV-1'),
    ]);

    const [item] = resolveBoardItems(issueSet, SCOPE, UNMAPPED_RESOLVER);
    expect(item.parentKey).toBe('DEV-1');
  });

  it('does not nest the CONTAINER under the thing it holds', () => {
    // Only the inward side of the pair counts; the container reads "contains", not "contained within".
    const issueSet = buildIssueSet([makeContainedIssue('DEV-1', 'DEV-2', false)]);

    const [item] = resolveBoardItems(issueSet, SCOPE, UNMAPPED_RESOLVER);
    expect(item.parentKey).toBeNull();
  });

  it('ignores an unrelated link type', () => {
    const blockedIssue = {
      id: 'DEV-3', key: 'DEV-3',
      fields: {
        summary: 'DEV-3', status: { name: 'To Do' }, issuetype: { name: 'Story' },
        issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'DEV-1' } }],
      },
    } as unknown as JiraIssue;

    const [item] = resolveBoardItems(buildIssueSet([blockedIssue]), SCOPE, UNMAPPED_RESOLVER);
    expect(item.parentKey).toBeNull();
  });
});
