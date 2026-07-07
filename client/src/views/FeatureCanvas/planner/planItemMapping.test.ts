// planItemMapping.test.ts — Verifies the pure role-classification + PlanItem mapping module (feature 013, Layer 2).

import { describe, expect, it } from 'vitest';

import type {
  StandupRosterMember,
  RosterRoleCapabilities,
} from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import {
  buildPlanItems,
  classifyIssueRole,
  mapRosterToCapacity,
  type PlannerSourceIssue,
} from './planItemMapping.ts';

// ── Test fixture builders (keep each test's intent obvious) ───────────────────

/** Builds a roster member with the given display name and role capabilities for a test. */
function makeMember(displayName: string, capabilities: RosterRoleCapabilities): StandupRosterMember {
  return {
    id: `roster-member:${displayName.toLowerCase()}`,
    displayName,
    assigneeQueryValue: displayName,
    roleCapabilities: capabilities,
  };
}

/** Builds a planner source issue, defaulting the noisy fields so a test states only what it cares about. */
function makeIssue(overrides: Partial<PlannerSourceIssue>): PlannerSourceIssue {
  return {
    key: 'ISSUE-1',
    summary: 'An issue',
    issueType: 'Story',
    isSubtask: false,
    projectKey: 'DENP',
    storyPoints: null,
    assignee: null,
    ...overrides,
  };
}

const DANA_DEV = makeMember('Dana Dev', { canDevelop: true, canInternalTest: false, canExternalTest: false });
const LEO_LEAD = makeMember('Leo Lead', {
  canDevelop: false,
  canInternalTest: false,
  canExternalTest: false,
  canDevLead: true,
});
const TINA_TEST = makeMember('Tina Test', { canDevelop: false, canInternalTest: true, canExternalTest: false });
const XAVIER_EXT = makeMember('Xavier Ext', { canDevelop: false, canInternalTest: false, canExternalTest: true });
const MORGAN_MULTI = makeMember('Morgan Multi', { canDevelop: true, canInternalTest: true, canExternalTest: true });
const SAM_SM = makeMember('Sam SM', { canDevelop: false, canInternalTest: false, canExternalTest: false, canScrumMaster: true });
const PAT_PO = makeMember('Pat PO', { canDevelop: false, canInternalTest: false, canExternalTest: false, canProductOwner: true });
const ADA_ARCH = makeMember('Ada Arch', { canDevelop: false, canInternalTest: false, canExternalTest: false, canSolutionArchitect: true });

const FULL_ROSTER: StandupRosterMember[] = [
  DANA_DEV, LEO_LEAD, TINA_TEST, XAVIER_EXT, MORGAN_MULTI, SAM_SM, PAT_PO, ADA_ARCH,
];

// ── mapRosterToCapacity ───────────────────────────────────────────────────────

describe('mapRosterToCapacity', () => {
  it('grants dev capacity from canDevLead alone (Dev Lead counts as development)', () => {
    const capacities = mapRosterToCapacity([LEO_LEAD]);
    expect(capacities).toHaveLength(1);
    expect(capacities[0].roles).toEqual(['dev']);
  });

  it('unions all three delivery roles for a multi-capable person', () => {
    const capacities = mapRosterToCapacity([MORGAN_MULTI]);
    expect(capacities[0].roles).toEqual(expect.arrayContaining(['dev', 'internalTest', 'externalTest']));
    expect(capacities[0].roles).toHaveLength(3);
  });

  it('excludes SM / PO / SA-only members (they add no delivery role)', () => {
    const capacities = mapRosterToCapacity([SAM_SM, PAT_PO, ADA_ARCH]);
    expect(capacities).toHaveLength(0);
  });

  it('keeps only members with at least one delivery role from a mixed roster', () => {
    const displayNames = mapRosterToCapacity(FULL_ROSTER).map((capacity) => capacity.displayName);
    expect(displayNames).toEqual(expect.arrayContaining(['Dana Dev', 'Leo Lead', 'Tina Test', 'Xavier Ext', 'Morgan Multi']));
    expect(displayNames).not.toContain('Sam SM');
    expect(displayNames).not.toContain('Pat PO');
    expect(displayNames).not.toContain('Ada Arch');
  });

  it('defaults pointsPerSprint to 8 and honors an override', () => {
    expect(mapRosterToCapacity([DANA_DEV])[0].pointsPerSprint).toBe(8);
    expect(mapRosterToCapacity([DANA_DEV], 5)[0].pointsPerSprint).toBe(5);
  });

  it('carries the display name through', () => {
    expect(mapRosterToCapacity([DANA_DEV])[0].displayName).toBe('Dana Dev');
  });
});

// ── classifyIssueRole ─────────────────────────────────────────────────────────

describe('classifyIssueRole', () => {
  it('labels a story assigned to an internal tester as internalTest', () => {
    const issue = makeIssue({ assignee: 'Tina Test', storyPoints: 5 });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('internalTest');
  });

  it('labels a story assigned to a developer as dev', () => {
    const issue = makeIssue({ assignee: 'Dana Dev', storyPoints: 8 });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('dev');
  });

  it('labels an unassigned sub-task as internalTest', () => {
    const issue = makeIssue({ assignee: null, isSubtask: true });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('internalTest');
  });

  it('labels an unassigned story as dev', () => {
    const issue = makeIssue({ assignee: null, isSubtask: false });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('dev');
  });

  it('labels a DIP issue linked to a parent as externalTest', () => {
    const issue = makeIssue({ projectKey: 'DIP', parentKey: 'DENP-1', assignee: null });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('externalTest');
  });

  it('labels a story assigned to an external tester as externalTest', () => {
    const issue = makeIssue({ assignee: 'Xavier Ext', storyPoints: 3 });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('externalTest');
  });

  it('labels an off-roster-assigned non-sub-task as dev', () => {
    const issue = makeIssue({ assignee: 'Stranger Danger', isSubtask: false });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('dev');
  });

  it('labels a sub-task assigned to a non-delivery person (SM) as internalTest', () => {
    const issue = makeIssue({ assignee: 'Sam SM', isSubtask: true });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('internalTest');
  });

  it('matches the assignee to the roster case-insensitively with collapsed whitespace', () => {
    const issue = makeIssue({ assignee: '  tina   test ', storyPoints: 2 });
    expect(classifyIssueRole(issue, FULL_ROSTER)).toBe('internalTest');
  });
});

// ── buildPlanItems ────────────────────────────────────────────────────────────

describe('buildPlanItems', () => {
  it('synthesizes internal-test cost at 50% for a dev story with no QA sub-task', () => {
    const issues = [makeIssue({ key: 'STORY-1', assignee: 'Dana Dev', storyPoints: 8, bucket: 'Must', rankInBucket: 0 })];
    const [planItem] = buildPlanItems(issues, FULL_ROSTER);
    expect(planItem.devPoints).toBe(8);
    expect(planItem.internalTestPoints).toBe(4);
    expect(planItem.isTestEstimated).toBe(true);
  });

  it('does NOT synthesize when a dev story has a real QA sub-task child', () => {
    const issues = [
      makeIssue({ key: 'STORY-2', assignee: 'Dana Dev', storyPoints: 6, bucket: 'Must', rankInBucket: 1 }),
      makeIssue({ key: 'SUB-2', assignee: 'Tina Test', storyPoints: 3, isSubtask: true, parentKey: 'STORY-2' }),
    ];
    const planItems = buildPlanItems(issues, FULL_ROSTER);
    const parent = planItems.find((item) => item.key === 'STORY-2');
    const child = planItems.find((item) => item.key === 'SUB-2');
    expect(parent?.internalTestPoints).toBeNull();
    expect(parent?.isTestEstimated).toBe(false);
    expect(child?.internalTestPoints).toBe(3);
    expect(child?.devPoints).toBeNull();
  });

  it('inherits bucket and rank from the parent for a DIP external item', () => {
    const issues = [
      makeIssue({ key: 'STORY-3', assignee: 'Dana Dev', storyPoints: 4, bucket: 'Should', rankInBucket: 7 }),
      makeIssue({ key: 'DIP-3', projectKey: 'DIP', parentKey: 'STORY-3', assignee: 'Xavier Ext', storyPoints: 2 }),
    ];
    const planItems = buildPlanItems(issues, FULL_ROSTER);
    const external = planItems.find((item) => item.key === 'DIP-3');
    expect(external?.externalTestPoints).toBe(2);
    expect(external?.bucket).toBe('Should');
    expect(external?.rankInBucket).toBe(7);
  });

  it('classifies a defect assigned to a tester as an internalTest plan item', () => {
    const issues = [
      makeIssue({ key: 'DEF-1', issueType: 'Defect', assignee: 'Tina Test', storyPoints: 5, bucket: 'Should', rankInBucket: 0 }),
    ];
    const [planItem] = buildPlanItems(issues, FULL_ROSTER);
    expect(planItem.internalTestPoints).toBe(5);
    expect(planItem.devPoints).toBeNull();
    expect(planItem.externalTestPoints).toBeNull();
  });

  it('defaults a secondary item with a missing parent to Could / last rank without dropping it', () => {
    const issues = [makeIssue({ key: 'SUB-ORPHAN', isSubtask: true, parentKey: 'MISSING-99', assignee: null, storyPoints: 1 })];
    const [planItem] = buildPlanItems(issues, FULL_ROSTER);
    expect(planItem.bucket).toBe('Could');
    expect(planItem.rankInBucket).toBe(Number.MAX_SAFE_INTEGER);
    expect(planItem.internalTestPoints).toBe(1);
  });

  it('treats null story points as 0 and does not synthesize test for a zero-point dev item', () => {
    const issues = [makeIssue({ key: 'STORY-NP', assignee: 'Dana Dev', storyPoints: null, bucket: 'Could', rankInBucket: 0 })];
    const [planItem] = buildPlanItems(issues, FULL_ROSTER);
    expect(planItem.devPoints).toBe(0);
    expect(planItem.internalTestPoints).toBeNull();
    expect(planItem.isTestEstimated).toBe(false);
  });

  it('respects a custom synthetic test fraction', () => {
    const issues = [makeIssue({ key: 'STORY-Q', assignee: 'Dana Dev', storyPoints: 10, bucket: 'Must', rankInBucket: 0 })];
    const [planItem] = buildPlanItems(issues, FULL_ROSTER, 0.3);
    expect(planItem.internalTestPoints).toBe(3);
    expect(planItem.isTestEstimated).toBe(true);
  });

  it('is deterministic — identical inputs yield deeply-equal output', () => {
    const issues = [
      makeIssue({ key: 'STORY-2', assignee: 'Dana Dev', storyPoints: 6, bucket: 'Must', rankInBucket: 1 }),
      makeIssue({ key: 'SUB-2', assignee: 'Tina Test', storyPoints: 3, isSubtask: true, parentKey: 'STORY-2' }),
    ];
    expect(buildPlanItems(issues, FULL_ROSTER)).toEqual(buildPlanItems(issues, FULL_ROSTER));
  });
});
