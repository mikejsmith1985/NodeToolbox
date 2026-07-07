// reallocationModel.test.ts — Unit tests for the pure target-sprint work assembly (Part 2).

import { describe, expect, it } from 'vitest';

import type { CanvasChildStory, CanvasNode } from '../logic/canvasTypes.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { buildReallocationContext } from './reallocationModel.ts';

const TODAY_ISO = '2026-07-07';
const PI_WITH_RANGE = 'PI 26.3 (05/21/26 - 07/29/26)';

/** Builds a full CanvasNode from the few fields the assembly reads, defaulting the rest. */
function createCanvasNode(overrides: {
  issueKey: string;
  containerId: string | null;
  storyPlacements?: Record<string, string>;
  childStories: CanvasChildStory[];
}): CanvasNode {
  return {
    issueKey: overrides.issueKey,
    position: { x: 0, y: 0 },
    size: null,
    priority: null,
    containerId: overrides.containerId,
    isExpanded: false,
    isParked: false,
    parkReason: null,
    storyPlacements: overrides.storyPlacements ?? {},
    pendingComment: '',
    summary: overrides.issueKey,
    status: 'In Progress',
    statusCategoryKey: 'indeterminate',
    assignee: null,
    storyPoints: null,
    businessValue: null,
    description: null,
    acceptanceCriteria: null,
    health: 'green',
    completionPercent: 0,
    hygieneFlags: [],
    childStories: overrides.childStories,
    dependencies: [],
    attachments: [],
    effectivePoints: 0,
  };
}

/** Builds a CanvasChildStory with sensible defaults for the fields the assembly ignores. */
function createChildStory(overrides: Partial<CanvasChildStory> & { key: string }): CanvasChildStory {
  return {
    summary: `Summary ${overrides.key}`,
    status: 'In Progress',
    statusCategoryKey: 'indeterminate',
    storyPoints: null,
    assignee: null,
    statusChangedIso: null,
    ...overrides,
  };
}

/** Builds a roster member; role capabilities default to absent (treated as none). */
function createRosterMember(
  displayName: string,
  assigneeQueryValue: string,
  roleCapabilities?: RosterRoleCapabilities,
): StandupRosterMember {
  return {
    id: `roster-member:${assigneeQueryValue.toLowerCase()}`,
    displayName,
    assigneeQueryValue,
    roleCapabilities,
  };
}

describe('buildReallocationContext', () => {
  it('includes a story via its per-story placement override and via the feature box default', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        storyPlacements: { 'S-2': 'sprint-2' },
        childStories: [
          createChildStory({ key: 'S-1', assignee: 'Jane Doe', storyPoints: 3 }), // inherits sprint-1
          createChildStory({ key: 'S-2', assignee: 'Jane Doe', storyPoints: 5 }), // overridden to sprint-2
        ],
      }),
    ];
    const roster = [createRosterMember('Jane Doe', 'Jane Doe')];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', roster, PI_WITH_RANGE, TODAY_ISO);

    const janeLoad = context.loads.find((load) => load.displayName === 'Jane Doe');
    expect(janeLoad?.items.map((item) => item.key)).toEqual(['S-1']);
    expect(janeLoad?.totalPoints).toBe(3);
  });

  it('groups by assignee, matches roster case-insensitively, and carries raw status + points', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        childStories: [
          createChildStory({ key: 'S-1', assignee: 'jane doe', status: 'In Dev', statusCategoryKey: 'indeterminate', storyPoints: 2 }),
          createChildStory({ key: 'S-2', assignee: 'JANE DOE', status: 'In QA', storyPoints: 3 }),
        ],
      }),
    ];
    const roster = [createRosterMember('Jane Doe', 'Jane Doe', { canDevelop: true, canInternalTest: false, canExternalTest: false })];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', roster, PI_WITH_RANGE, TODAY_ISO);

    expect(context.loads).toHaveLength(1);
    const janeLoad = context.loads[0];
    expect(janeLoad.isOnRoster).toBe(true);
    expect(janeLoad.roles).toEqual({ canDevelop: true, canInternalTest: false, canExternalTest: false });
    expect(janeLoad.items.map((item) => item.status)).toEqual(['In Dev', 'In QA']);
    expect(janeLoad.totalPoints).toBe(5);
  });

  it('routes an unmatched assignee to an off-roster bucket and lists them in offRosterAssignees', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        childStories: [createChildStory({ key: 'S-1', assignee: 'Contractor Carl', storyPoints: 8 })],
      }),
    ];
    const roster = [createRosterMember('Jane Doe', 'Jane Doe')];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', roster, PI_WITH_RANGE, TODAY_ISO);

    const offRosterLoad = context.loads.find((load) => load.displayName === 'Contractor Carl');
    expect(offRosterLoad?.isOnRoster).toBe(false);
    expect(offRosterLoad?.roles).toBeNull();
    expect(context.offRosterAssignees).toEqual(['Contractor Carl']);
  });

  it('routes null assignees to the Unassigned bucket and counts them', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        childStories: [
          createChildStory({ key: 'S-1', assignee: null, storyPoints: 1 }),
          createChildStory({ key: 'S-2', assignee: null, storyPoints: 2 }),
        ],
      }),
    ];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', [], PI_WITH_RANGE, TODAY_ISO);

    const unassignedLoad = context.loads.find((load) => load.displayName === 'Unassigned');
    expect(unassignedLoad?.items).toHaveLength(2);
    expect(unassignedLoad?.roles).toBeNull();
    expect(context.unassignedCount).toBe(2);
  });

  it('lists active roster members with no target-sprint work as spare capacity, with their roles', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        childStories: [createChildStory({ key: 'S-1', assignee: 'Jane Doe', storyPoints: 3 })],
      }),
    ];
    const roster = [
      createRosterMember('Jane Doe', 'Jane Doe', { canDevelop: true, canInternalTest: false, canExternalTest: false }),
      createRosterMember('Idle Ivan', 'Idle Ivan', { canDevelop: false, canInternalTest: true, canExternalTest: false }),
    ];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', roster, PI_WITH_RANGE, TODAY_ISO);

    expect(context.rosterWithoutWork).toEqual([
      { displayName: 'Idle Ivan', roles: { canDevelop: false, canInternalTest: true, canExternalTest: false } },
    ]);
  });

  it('computes whole days-in-status from the injected today, null when the story has no change date', () => {
    const nodes: CanvasNode[] = [
      createCanvasNode({
        issueKey: 'FEAT-1',
        containerId: 'sprint-1',
        childStories: [
          createChildStory({ key: 'S-1', assignee: 'Jane Doe', statusChangedIso: '2026-07-01T00:00:00.000Z' }),
          createChildStory({ key: 'S-2', assignee: 'Jane Doe', statusChangedIso: null }),
        ],
      }),
    ];
    const roster = [createRosterMember('Jane Doe', 'Jane Doe')];

    const context = buildReallocationContext(nodes, 'sprint-1', 'Sprint 1', roster, PI_WITH_RANGE, TODAY_ISO);

    const items = context.loads[0].items;
    expect(items.find((item) => item.key === 'S-1')?.daysInStatus).toBe(6);
    expect(items.find((item) => item.key === 'S-2')?.daysInStatus).toBeNull();
  });

  it('fills the PI window from a parseable name and reports unknown when it has no range', () => {
    const withRange = buildReallocationContext([], 'sprint-1', 'Sprint 1', [], PI_WITH_RANGE, TODAY_ISO);
    expect(withRange.piStartIso).toBe('2026-05-21');
    expect(withRange.piEndIso).toBe('2026-07-29');
    expect(withRange.daysRemainingInPi).toBe(22);

    const withoutRange = buildReallocationContext([], 'sprint-1', 'Sprint 1', [], 'PI 26.3', TODAY_ISO);
    expect(withoutRange.piStartIso).toBeNull();
    expect(withoutRange.piEndIso).toBeNull();
    expect(withoutRange.daysRemainingInPi).toBeNull();
  });
});
