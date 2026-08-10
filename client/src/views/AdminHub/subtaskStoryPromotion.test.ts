// subtaskStoryPromotion.test.ts — Proves a bulk sub-task → Story promotion is safe to point at real Jira.
//
// The load-bearing test in this file is the link DIRECTION: the promoted Story must read "contained
// within" its old parent, not "contains" it. Getting that backwards in bulk is the expensive mistake
// this whole module exists to prevent.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTAINMENT_PHRASE,
  buildContainmentLinkInput,
  buildPromotionPlan,
  buildStoryCreatePayload,
  describeJiraFailure,
  findTransitionToStatus,
  resolveContainmentLinkDirection,
  type JiraIssueLinkType,
} from './subtaskStoryPromotion.ts';
import type { JiraIssue } from '../../types/jira.ts';

/** Builds a sub-task shaped the way Jira's REST v2 search returns one. */
function makeSubtask(key: string, overrides: Record<string, unknown> = {}): JiraIssue {
  return {
    key,
    fields: {
      summary: 'Wire up the retry handler',
      status: { name: 'In Progress' },
      parent: { key: 'ENCUC-100' },
      ...overrides,
    },
  } as unknown as JiraIssue;
}

/** The paired link type as Jira Data Center returns it. */
const CONTAINER_LINK_TYPE: JiraIssueLinkType = {
  id: '10300',
  name: 'Container',
  inward: 'is contained within',
  outward: 'contains',
};

describe('describeJiraFailure — a typo must not read like a system fault', () => {
  it('drops the encoded url so Jira\'s actual complaint leads', () => {
    const rawMessage = 'Jira GET /rest/api/2/search?jql=issuetype%20%3D%20Sub-task%20AND%20project'
      + '%20in%20(ENCUC%2C%20ENFCT)%20and%20Summary%20~%20%22%5BDEV%5D&fields=summary%2Cstatus'
      + '&maxResults=200 failed: 400 — Error in the JQL Query: The quoted string \'[DEV]\' has not'
      + ' been completed. (line 1, character 66)';

    expect(describeJiraFailure(rawMessage)).toBe(
      '400 — Error in the JQL Query: The quoted string \'[DEV]\' has not been completed.'
      + ' (line 1, character 66)',
    );
  });

  it('keeps the status code, which is the part worth knowing about the request', () => {
    expect(describeJiraFailure('Jira POST /rest/api/2/issue failed: 403 — You do not have permission'))
      .toBe('403 — You do not have permission');
  });

  it('leaves a message that carries no request description untouched', () => {
    expect(describeJiraFailure('Network request failed')).toBe('Network request failed');
  });

  it('falls back to the whole message rather than showing nothing', () => {
    expect(describeJiraFailure('Jira GET /x failed: ')).toBe('Jira GET /x failed:');
  });

  it('survives an empty or missing message', () => {
    expect(describeJiraFailure('')).toBe('');
    expect(describeJiraFailure(undefined as unknown as string)).toBe('');
  });
});

describe('resolveContainmentLinkDirection — which side does the Story go on', () => {
  it('puts the Story on the inward side when "contained within" is the inward phrase', () => {
    const direction = resolveContainmentLinkDirection([CONTAINER_LINK_TYPE]);

    expect(direction).not.toBeNull();
    expect(direction!.linkTypeName).toBe('Container');
    expect(direction!.isStoryTheInwardIssue).toBe(true);
  });

  it('puts the Story on the outward side when the instance words the pair the other way round', () => {
    const invertedLinkType: JiraIssueLinkType = {
      name: 'Containment', inward: 'contains', outward: 'is contained within',
    };
    const direction = resolveContainmentLinkDirection([invertedLinkType]);

    expect(direction!.isStoryTheInwardIssue).toBe(false);
  });

  it('matches regardless of the leading "is" and of casing', () => {
    expect(resolveContainmentLinkDirection([CONTAINER_LINK_TYPE], 'Contained Within')).not.toBeNull();
    expect(resolveContainmentLinkDirection([CONTAINER_LINK_TYPE], 'is contained within')).not.toBeNull();
  });

  it('ignores unrelated link types rather than settling for the nearest one', () => {
    const blocksLinkType: JiraIssueLinkType = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
    expect(resolveContainmentLinkDirection([blocksLinkType])).toBeNull();
  });

  it('returns null when the instance has no containment link type at all', () => {
    expect(resolveContainmentLinkDirection([])).toBeNull();
  });

  it('skips a malformed catalogue entry with no name instead of producing an unusable direction', () => {
    const namelessLinkType: JiraIssueLinkType = { inward: 'is contained within', outward: 'contains' };
    expect(resolveContainmentLinkDirection([namelessLinkType, CONTAINER_LINK_TYPE])!.linkTypeName)
      .toBe('Container');
  });
});

describe('buildContainmentLinkInput — the Story reads "contained within" its parent', () => {
  it('places the Story inward and the old parent outward for a normally worded pair', () => {
    const direction = resolveContainmentLinkDirection([CONTAINER_LINK_TYPE])!;
    const linkInput = buildContainmentLinkInput(direction, 'ENCUC-500', 'ENCUC-100');

    // Jira renders outwardIssue --(outward phrase)--> inwardIssue, so the parent "contains" the Story
    // and the Story "is contained within" the parent. That is the right way round.
    expect(linkInput).toEqual({
      type: { name: 'Container' },
      inwardIssue: { key: 'ENCUC-500' },
      outwardIssue: { key: 'ENCUC-100' },
    });
  });

  it('swaps the sides when the instance words the pair the other way round', () => {
    const invertedLinkType: JiraIssueLinkType = {
      name: 'Containment', inward: 'contains', outward: 'is contained within',
    };
    const direction = resolveContainmentLinkDirection([invertedLinkType])!;
    const linkInput = buildContainmentLinkInput(direction, 'ENCUC-500', 'ENCUC-100');

    expect(linkInput.inwardIssue.key).toBe('ENCUC-100');
    expect(linkInput.outwardIssue.key).toBe('ENCUC-500');
  });
});

describe('buildStoryCreatePayload — what crosses over onto the new Story', () => {
  const CREATE_OPTIONS = { storyIssueTypeId: '10001' };

  it('creates the Story in the sub-task\'s own project with the chosen issue type', () => {
    const payload = buildStoryCreatePayload(makeSubtask('ENCUC-201'), 'ENCUC-100', CREATE_OPTIONS);

    expect(payload.fields.project).toEqual({ key: 'ENCUC' });
    expect(payload.fields.issuetype).toEqual({ id: '10001' });
  });

  it('carries the summary across', () => {
    const payload = buildStoryCreatePayload(makeSubtask('ENCUC-201'), 'ENCUC-100', CREATE_OPTIONS);
    expect(payload.fields.summary).toBe('Wire up the retry handler');
  });

  it('records where the Story came from, including the status a new issue cannot be created into', () => {
    const payload = buildStoryCreatePayload(makeSubtask('ENCUC-201'), 'ENCUC-100', CREATE_OPTIONS);

    expect(payload.fields.description).toContain('Promoted from sub-task ENCUC-201 of ENCUC-100');
    expect(payload.fields.description).toContain('In Progress');
  });

  it('keeps any existing description above the provenance note', () => {
    const subtask = makeSubtask('ENCUC-201', { description: 'Original detail here.' });
    const payload = buildStoryCreatePayload(subtask, 'ENCUC-100', CREATE_OPTIONS);

    expect(String(payload.fields.description).startsWith('Original detail here.')).toBe(true);
  });

  it('assigns by username, never by the Cloud-only accountId', () => {
    const subtask = makeSubtask('ENCUC-201', {
      assignee: { name: 'jsmith', accountId: '557058:abc', displayName: 'Smith, Mike (CTR)' },
    });
    const payload = buildStoryCreatePayload(subtask, 'ENCUC-100', CREATE_OPTIONS);

    expect(payload.fields.assignee).toEqual({ name: 'jsmith' });
  });

  it('leaves the Story unassigned rather than sending an empty assignee', () => {
    const payload = buildStoryCreatePayload(makeSubtask('ENCUC-201'), 'ENCUC-100', CREATE_OPTIONS);
    expect(payload.fields.assignee).toBeUndefined();
  });

  it('carries priority and labels when the sub-task has them', () => {
    const subtask = makeSubtask('ENCUC-201', { priority: { id: '3' }, labels: ['tech-debt'] });
    const payload = buildStoryCreatePayload(subtask, 'ENCUC-100', CREATE_OPTIONS);

    expect(payload.fields.priority).toEqual({ id: '3' });
    expect(payload.fields.labels).toEqual(['tech-debt']);
  });

  it('omits labels entirely when there are none, rather than sending an empty array', () => {
    const payload = buildStoryCreatePayload(makeSubtask('ENCUC-201'), 'ENCUC-100', CREATE_OPTIONS);
    expect(payload.fields.labels).toBeUndefined();
  });

  it('honours an explicit target project when the Story should not live beside the sub-task', () => {
    const payload = buildStoryCreatePayload(
      makeSubtask('ENCUC-201'), 'ENCUC-100', { ...CREATE_OPTIONS, projectKey: 'DENP' },
    );
    expect(payload.fields.project).toEqual({ key: 'DENP' });
  });

  it('can leave the provenance note off when the team does not want it', () => {
    const payload = buildStoryCreatePayload(
      makeSubtask('ENCUC-201'), 'ENCUC-100', { ...CREATE_OPTIONS, shouldRecordProvenance: false },
    );
    expect(payload.fields.description).toBe('');
  });
});

describe('findTransitionToStatus — a promoted Story should not reset to the first step', () => {
  const TRANSITIONS = [
    { id: '11', name: 'Start', to: { name: 'In Progress' } },
    { id: '21', name: 'Finish', to: { name: 'Done' } },
  ];

  it('finds the transition landing on the sub-task\'s status', () => {
    expect(findTransitionToStatus(TRANSITIONS, 'In Progress')!.id).toBe('11');
  });

  it('matches without regard to casing or padding', () => {
    expect(findTransitionToStatus(TRANSITIONS, '  done ')!.id).toBe('21');
  });

  it('returns null when no single transition reaches that status, so the caller can report it', () => {
    expect(findTransitionToStatus(TRANSITIONS, 'Ready for QA')).toBeNull();
  });

  it('returns null for an empty target rather than picking an arbitrary transition', () => {
    expect(findTransitionToStatus(TRANSITIONS, '')).toBeNull();
  });
});

describe('buildPromotionPlan — the preview a person approves', () => {
  const DIRECTION = resolveContainmentLinkDirection([CONTAINER_LINK_TYPE]);

  it('marks a well-formed sub-task as promotable', () => {
    const plan = buildPromotionPlan([makeSubtask('ENCUC-201')], DIRECTION);

    expect(plan.promotableCount).toBe(1);
    expect(plan.blockedCount).toBe(0);
    expect(plan.rows[0].blockingReasons).toEqual([]);
  });

  it('blocks a sub-task with no parent, since there is nothing to link back to', () => {
    const orphan = makeSubtask('ENCUC-202', { parent: undefined });
    const plan = buildPromotionPlan([orphan], DIRECTION);

    expect(plan.blockedCount).toBe(1);
    expect(plan.rows[0].blockingReasons).toContain('No parent issue to link back to');
  });

  it('blocks every row when the instance has no containment link type', () => {
    const plan = buildPromotionPlan([makeSubtask('ENCUC-201')], null);

    expect(plan.promotableCount).toBe(0);
    expect(plan.rows[0].blockingReasons[0]).toContain(DEFAULT_CONTAINMENT_PHRASE);
  });

  it('blocks a sub-task with no summary, which Jira would reject on create anyway', () => {
    const plan = buildPromotionPlan([makeSubtask('ENCUC-203', { summary: '   ' })], DIRECTION);
    expect(plan.rows[0].blockingReasons).toContain('No summary');
  });

  it('reports one bad row without hiding the good ones beside it', () => {
    const plan = buildPromotionPlan(
      [makeSubtask('ENCUC-201'), makeSubtask('ENCUC-202', { parent: undefined })],
      DIRECTION,
    );

    expect(plan.promotableCount).toBe(1);
    expect(plan.blockedCount).toBe(1);
    expect(plan.rows).toHaveLength(2);
  });

  it('surfaces the status and assignee so the operator sees what is about to move', () => {
    const subtask = makeSubtask('ENCUC-201', { assignee: { displayName: 'Smith, Mike (CTR)' } });
    const plan = buildPromotionPlan([subtask], DIRECTION);

    expect(plan.rows[0].statusName).toBe('In Progress');
    expect(plan.rows[0].assigneeDisplayName).toBe('Smith, Mike (CTR)');
  });
});
