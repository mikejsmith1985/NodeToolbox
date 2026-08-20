// intReadiness.ts — The PI's Definition of Done, which is NOT the ART's definition of delivered.
//
// The team is measured on two different lines and they are weeks apart:
//
//   DELIVERED  = "Ready for QA" or later. Owned by workflowDelivery.ts, drives sprint
//                predictability, the monthly delivery report and every flow metric.
//   INT-READY  = "Ready for Testing" with a sub-status of "Integration Test". The PI commitment.
//
// This module deliberately does NOT touch workflowDelivery.ts. It imports that module's status name
// so the two share one vocabulary, and exports its own verdict so they can never share a conclusion.
// If a workflowDelivery test ever has to change for this to pass, the delivered rule moved and the
// change is wrong.
//
// Everything here reads the status and sub-status DIRECTLY. Never a board column: a team that has
// not added the Internal Test Ready column to its saved vocabulary still gets a correct answer, and
// simply sees the card sitting in Unmapped.

import { INTERNAL_TESTING_STATUS_NAME } from '../../../utils/workflowDelivery.ts';
import type { FeatureIntReadiness, IntReadinessInput, IntReadyState } from './forecastTypes.ts';

/** The sub-status that marks an issue as sitting in Integration Test. */
export const INTEGRATION_TEST_SUB_STATUS = 'Integration Test';

/** The status that takes an issue out of both the capacity sum and the Definition of Done. */
const CANCELLED_STATUS_NAME = 'Cancelled';

/** Compares two Jira-supplied names forgivingly — spelling and padding vary across projects. */
function namesMatch(candidate: string | null, expected: string): boolean {
  return (candidate ?? '').trim().toLowerCase() === expected.trim().toLowerCase();
}

/** True when a sub-status value carries nothing — Jira gives blanks as well as nulls. */
function isSubStatusAbsent(subStatusValue: string | null): boolean {
  return subStatusValue === null || subStatusValue.trim() === '';
}

/**
 * Works out where one issue sits relative to the PI's Definition of Done.
 *
 * `unknown-sub-status` is returned when the instance has no sub-status field at all. That is not the
 * same claim as "not ready": one is a verdict, the other is the absence of one, and reporting the
 * second as the first would tell a team they had missed a commitment nobody could measure.
 */
export function readIntReadyState(input: IntReadinessInput): IntReadyState {
  if (namesMatch(input.statusName, CANCELLED_STATUS_NAME)) {
    return 'cancelled';
  }
  if (!input.hasSubStatusField) {
    return 'unknown-sub-status';
  }
  const isAtIntegrationTest = namesMatch(input.statusName, INTERNAL_TESTING_STATUS_NAME)
    && namesMatch(input.subStatusValue, INTEGRATION_TEST_SUB_STATUS);
  return isAtIntegrationTest ? 'int-ready' : 'not-int-ready';
}

/**
 * True when dev is finished and the work is waiting to be tested — the state that releases the SL
 * story to start.
 *
 * "Ready for Testing" with NO sub-status. Deliberately independent of `hasSubStatusField`: the
 * absence of a value is the signal here, so an instance without the field reads every such issue as
 * internal-test ready, which is the correct answer for a workflow that cannot express the later
 * sub-statuses at all.
 */
export function isInternalTestReady(input: IntReadinessInput): boolean {
  return namesMatch(input.statusName, INTERNAL_TESTING_STATUS_NAME) && isSubStatusAbsent(input.subStatusValue);
}

/**
 * Rolls one Feature's children up into a single verdict, naming whatever is holding it back.
 *
 * A Feature with NO children is `not-int-ready`, never ready. An all-satisfied check over an empty
 * set returns true, and reporting an untouched Feature as having met the PI commitment is the worst
 * thing this module could do — and the least likely to be noticed.
 */
export function rollUpFeatureIntReadiness(
  featureKey: string,
  children: readonly (IntReadinessInput & { issueKey: string })[],
): FeatureIntReadiness {
  const cancelledIssueKeys: string[] = [];
  const blockingIssueKeys: string[] = [];
  let contributingIssueCount = 0;
  let hasUncheckableChild = false;

  children.forEach((childIssue) => {
    const state = readIntReadyState(childIssue);
    if (state === 'cancelled') {
      cancelledIssueKeys.push(childIssue.issueKey);
      return;
    }
    contributingIssueCount += 1;
    if (state === 'unknown-sub-status') {
      hasUncheckableChild = true;
      return;
    }
    if (state !== 'int-ready') {
      blockingIssueKeys.push(childIssue.issueKey);
    }
  });

  return {
    featureKey,
    state: readFeatureState({
      hasChildren: children.length > 0,
      contributingIssueCount,
      hasUncheckableChild,
      blockingCount: blockingIssueKeys.length,
    }),
    blockingIssueKeys,
    cancelledIssueKeys,
    contributingIssueCount,
  };
}

/** Turns the tally of children into the Feature's own verdict. */
function readFeatureState(tally: {
  hasChildren: boolean;
  contributingIssueCount: number;
  hasUncheckableChild: boolean;
  blockingCount: number;
}): IntReadyState {
  // Nothing to measure is not the same as everything measured and passing.
  if (!tally.hasChildren) {
    return 'not-int-ready';
  }
  // Every child cancelled: the Feature was abandoned, not completed.
  if (tally.contributingIssueCount === 0) {
    return 'cancelled';
  }
  if (tally.hasUncheckableChild) {
    return 'unknown-sub-status';
  }
  return tally.blockingCount === 0 ? 'int-ready' : 'not-int-ready';
}
