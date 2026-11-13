// slQeContainerFix.ts — Pure planner for the one-time #508 clean-up of SL/QE test stories.
//
// Background (plain English): a batch of SL/QE test stories were linked to the DEV story they test
// with the "Container" link pointing the WRONG way — the test story showed as the container instead
// of the dev story. This module is the pure half of the fix: given a fixed work list and the LIVE
// status of each dev story, it decides, for every test story, whether to flip the link (and clone the
// dev story's Description + Acceptance Criteria), additionally move it to "Ready to Work", or simply
// cancel it. It never talks to Jira — the panel feeds it data and carries out what it returns.

import type { CreateIssueLinkInput } from '../../services/jiraApi.ts';
import type { JiraTransition } from './subtaskStoryPromotion.ts';

// ── Named constants ──

/** The label the owner adds to signal "I have reviewed this" before handing it on. */
export const REVIEW_LABEL = 'msreview';
/** Jira's description field id — a system field, identical on every instance. */
export const DESCRIPTION_FIELD_ID = 'description';
/** The reason recorded on a cancel transition when the workflow demands one. */
export const CANCEL_REASON_DEFAULT =
  'Superseded — the dev story is complete or cancelled, so this test story is no longer needed '
  + '(one-time clean-up per issue #508).';

/** Status names (lower-cased) that mean the dev work has not finished and is still worth testing. */
const ACTIVE_STATUSES: readonly string[] = [
  'to do', 'open', 'working', 'in progress', 'in-progress', 'ready to work',
  'backlog', 'reopened', 'new', 'selected for development',
];
/** Status names (lower-cased) that mean the dev work is awaiting testing. */
const TEST_STATUSES: readonly string[] = [
  'ready to test', 'ready for qa', 'ready for testing', 'in test', 'testing', 'in testing',
];
/** Status names (lower-cased) that mean the dev work is finished or abandoned. */
const DONE_STATUSES: readonly string[] = [
  'done', 'closed', 'cancelled', 'canceled', 'accepted', 'ready to accept',
  'resolved', 'complete', 'completed',
];

// ── The fixed work list ──

/** One test story and the dev story (or stories) it belongs under. */
export interface WorkListEntry {
  /** The SL/QE test story key. */
  story: string;
  /** The dev story keys it should be contained within; the first is the primary clone source. */
  devs: string[];
  /** True when the story is already Cancelled in Jira and must be left untouched. */
  skip?: boolean;
}

/**
 * The exact stories this one-time clean-up covers, confirmed against issue #508. The dev keys are the
 * only hand-entered input; every status is re-read live before a decision is made.
 */
export const WORK_LIST: readonly WorkListEntry[] = [
  // SL stories
  { story: 'ENFCT-2032', devs: ['ENFCT-1214'] },
  { story: 'ENFCT-2035', devs: ['ENFCT-1790'] },
  { story: 'ENFCT-2043', devs: ['ENFCT-2011'] },
  { story: 'ENFCT-2048', devs: ['ENFCT-1531'] },
  { story: 'ENFCT-2049', devs: ['ENFCT-1665'] },
  { story: 'ENFCT-2050', devs: ['ENFCT-1463'] },
  { story: 'ENFCT-2052', devs: ['ENFCT-1255'] },
  { story: 'ENFCT-2053', devs: ['ENFCT-1776'] },
  { story: 'ENFCT-2054', devs: ['ENFCT-1714'] },
  { story: 'ENFCT-2055', devs: ['ENFCT-1752'] },
  { story: 'ENFCT-2056', devs: ['ENFCT-1786'] },
  { story: 'ENFCT-2057', devs: ['ENFCT-1786'] },
  { story: 'ENFCT-2058', devs: ['ENFCT-1786'] },
  { story: 'ENFCT-2059', devs: ['ENFCT-1984'] },
  { story: 'ENFCT-2060', devs: ['ENFCT-1537'] },
  { story: 'ENFCT-2061', devs: ['ENFCT-1779'] },
  { story: 'ENFCT-2062', devs: ['ENFCT-1989', 'ENFCT-2096'] },
  { story: 'ENFCT-2063', devs: ['ENFCT-1983'] },
  { story: 'ENFCT-2094', devs: ['ENFCT-2095'] },
  { story: 'ENFCT-2109', devs: ['ENFCT-2110'] },
  { story: 'ENFCT-2169', devs: ['ENFCT-2175'] },
  { story: 'ENFCT-2173', devs: ['ENFCT-2172'] },
  // QE stories
  { story: 'ENFCT-2170', devs: ['ENFCT-2175'] },
  { story: 'ENFCT-2174', devs: ['ENFCT-2172'] },
  { story: 'ENFCT-2193', devs: ['ENFCT-2191'] },
  { story: 'ENFCT-2135', devs: ['ENFCT-2133'] },
  { story: 'ENFCT-2150', devs: ['ENFCT-2148'] },
  { story: 'ENFCT-2131', devs: ['ENFCT-2129'] },
  { story: 'ENFCT-2139', devs: [], skip: true }, // already Cancelled — ignore
];

// ── Decision logic ──

export type StatusBucket = 'active' | 'test' | 'done';
export type StoryAction = 'flip-clone' | 'ready-to-work' | 'cancel';

/**
 * Classifies one Jira status name. An unrecognised status is treated as 'active' so the clean-up never
 * silently cancels a story it did not understand — a surprise surfaces as a reversible link flip.
 */
export function bucketForStatus(statusName: string): StatusBucket {
  const normalized = String(statusName || '').trim().toLowerCase();
  if (DONE_STATUSES.includes(normalized)) return 'done';
  if (TEST_STATUSES.includes(normalized)) return 'test';
  if (ACTIVE_STATUSES.includes(normalized)) return 'active';
  return 'active';
}

/**
 * Decides what to do with a test story from the live statuses of its dev stories.
 *
 * Every dev done -> the test work is obsolete, cancel. Any dev awaiting testing -> ready to work.
 * Otherwise at least one dev is still active -> flip the link and clone the content.
 */
export function decideAction(devStatusNames: readonly string[]): StoryAction {
  const buckets = devStatusNames.map(bucketForStatus);
  if (buckets.length > 0 && buckets.every((bucket) => bucket === 'done')) return 'cancel';
  if (buckets.includes('test')) return 'ready-to-work';
  return 'flip-clone';
}

// ── Container link type orientation ──

/** The slice of GET /rest/api/2/issueLinkType this module reasons about. */
export interface IssueLinkTypeShape {
  name: string;
  inward: string;
  outward: string;
}

/** The resolved Container link type plus which side the container (dev) issue belongs on. */
export interface ContainerLinkType {
  name: string;
  inward: string;
  outward: string;
  /** True when the container issue is the link's outwardIssue; false when it is the inwardIssue. */
  containerIsOutward: boolean;
}

/**
 * Picks the "Container" link type and works out which side is the container.
 *
 * The container is the side whose label means "contains / is parent of", never the "contained by /
 * within" side. We read the outward label to decide, so the flip is correct whichever way the instance
 * worded it. Returns null when the instance defines no Container link type.
 */
export function resolveContainerLinkType(
  linkTypes: readonly IssueLinkTypeShape[],
): ContainerLinkType | null {
  const container = linkTypes.find((type) => /container/i.test(type.name));
  if (!container) return null;
  const outwardText = String(container.outward || '').toLowerCase();
  const containerIsOutward = /contain/.test(outwardText) && !/contained|within|by/.test(outwardText);
  return {
    name: container.name,
    inward: container.inward,
    outward: container.outward,
    containerIsOutward,
  };
}

// ── Link flip planning ──

/** The minimal shape of an issue link as Jira returns it on an issue's `issuelinks` field. */
export interface IssueLinkShape {
  id?: string;
  type?: { name?: string };
  inwardIssue?: { key?: string };
  outwardIssue?: { key?: string };
}

/** The concrete link changes for one (story, dev) pair: links to remove, then the one to create. */
export interface LinkFlipPlan {
  deleteLinkIds: string[];
  createPayload: CreateIssueLinkInput;
}

/**
 * Plans the link flip for one test story and one dev story: every existing Container-type link between
 * the two is marked for deletion, and the canonical "dev contains story" link is built. Idempotent —
 * if the correct link already exists it is deleted and recreated identically, which Jira tolerates.
 */
export function planLinkFlip(
  storyKey: string,
  devKey: string,
  issueLinks: readonly IssueLinkShape[],
  linkType: ContainerLinkType,
): LinkFlipPlan {
  const deleteLinkIds: string[] = [];
  for (const link of issueLinks) {
    const isContainer = link.type && new RegExp(linkType.name, 'i').test(String(link.type.name));
    const otherKey = link.inwardIssue?.key || link.outwardIssue?.key;
    if (isContainer && otherKey === devKey && link.id) deleteLinkIds.push(link.id);
  }
  const createPayload: CreateIssueLinkInput = linkType.containerIsOutward
    ? { type: { name: linkType.name }, outwardIssue: { key: devKey }, inwardIssue: { key: storyKey } }
    : { type: { name: linkType.name }, inwardIssue: { key: devKey }, outwardIssue: { key: storyKey } };
  return { deleteLinkIds, createPayload };
}

// ── Transition selection ──

/**
 * Finds a transition whose target status (or, failing that, whose own name) matches a pattern.
 * Used to locate the "Cancelled" and "Ready to Work" transitions without hard-coding workflow ids.
 */
export function findTransitionMatching(
  transitions: readonly JiraTransition[],
  pattern: RegExp,
): JiraTransition | null {
  const byTarget = transitions.find((transition) => pattern.test(String(transition.to?.name || '')));
  if (byTarget) return byTarget;
  return transitions.find((transition) => pattern.test(String(transition.name || ''))) ?? null;
}

// ── Plan description (for the preview table) ──

/** One row of the dry-run preview: what the clean-up intends to do with one story. */
export interface PlanRow {
  storyKey: string;
  action: StoryAction | 'skip';
  devSummary: string;
  note: string;
}

/** Human-readable one-liner for an action, shown in the preview and the apply log. */
export function describeAction(action: StoryAction | 'skip'): string {
  switch (action) {
    case 'flip-clone': return 'Flip link → dev is container · clone Description + AC · label · assign';
    case 'ready-to-work': return 'Flip + clone + label + assign · move to Ready to Work';
    case 'cancel': return 'Cancel the test story';
    case 'skip': return 'Skip (already cancelled / done)';
    default: return action;
  }
}
