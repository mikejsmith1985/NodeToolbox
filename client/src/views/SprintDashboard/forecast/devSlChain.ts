// devSlChain.ts — Testing cannot begin until development finishes, and the PI clock counts both.
//
// This is the failure that catches teams out: dev lands exactly when it should, and the Feature
// still misses its PI commitment because the SL test that has to follow it was never in the plan.
// Right up until the deadline the dev work looks fine, because it is.
//
// So the chain is: every [DEV] story reaches Internal Test Ready → the [SL] story runs → the Feature
// can move to Integration Test. Dev effort is SUMMED rather than maxed, which is the safe direction
// for a deadline; where two stories are genuinely held by different people, the per-person capacity
// check is what surfaces the parallelism, not this.

import { addWorkingDays } from '../../../utils/workingDays.ts';
import type { ChainItem, ChainRole, ChainRoleSignals, ChainSchedule, ForecastConfig } from './forecastTypes.ts';

/** The team's own convention, written by the PI planner and read here. Anchored and bracketed. */
const SL_PREFIX_PATTERN = /^\[sl\]/;
const DEV_PREFIX_PATTERN = /^\[dev\]/;

/**
 * Decides which side of the chain a piece of work sits on.
 *
 * The summary prefix is primary because it is a deliberate statement somebody made, and because the
 * PI planner already writes it. The assignee's capability is a weaker signal used only when there is
 * no prefix — a developer can pick up a test story.
 *
 * Anything with neither is reported as unclassified rather than guessed at. Silently assuming is how
 * a chain forecast goes quietly wrong, and quietly is the problem.
 */
export function classifyChainRole(signals: ChainRoleSignals): ChainRole {
  const normalizedSummary = signals.summary.trim().toLowerCase();
  if (SL_PREFIX_PATTERN.test(normalizedSummary)) {
    return 'sl';
  }
  if (DEV_PREFIX_PATTERN.test(normalizedSummary)) {
    return 'dev';
  }
  if (signals.assigneeCanInternalTest === true) {
    return 'sl';
  }
  if (signals.assigneeCanInternalTest === false) {
    return 'dev';
  }
  return 'unclassified';
}

/**
 * Sums the working days a set of items still needs.
 *
 * Returns null when ANY of them is unsized: a total that quietly omits unmeasured work produces a
 * Feature date indistinguishable from a real one, which is worse than no date.
 */
function sumRemainingWorkingDays(items: readonly ChainItem[]): number | null {
  let total = 0;
  for (const item of items) {
    // Work already awaiting test, or finished, costs nothing more whatever its estimate said.
    if (item.isInternalTestReady || item.isComplete) {
      continue;
    }
    if (item.remainingWorkingDays === null) {
      return null;
    }
    total += item.remainingWorkingDays;
  }
  return total;
}

/**
 * Works out when dev finishes, when test can start, and when the Feature can reach Integration Test.
 *
 * `startFromIso` is the first day work could begin — usually today. Every date is null when the
 * chain contains work nobody sized, because a guessed Feature date reads exactly like a real one.
 */
export function scheduleDevSlChain(
  items: readonly ChainItem[],
  startFromIso: string,
  config: ForecastConfig,
): ChainSchedule {
  const devItems = items.filter((item) => item.role !== 'sl');
  const slItems = items.filter((item) => item.role === 'sl');
  const unclassifiedIssueKeys = items
    .filter((item) => item.role === 'unclassified')
    .map((item) => item.issueKey);

  const devWorkingDays = sumRemainingWorkingDays(devItems);
  const slWorkingDays = slItems.length === 0 ? null : sumRemainingWorkingDays(slItems);

  if (devWorkingDays === null) {
    return {
      devCompleteIso: null,
      slStartIso: null,
      slWorkingDays,
      dodDateIso: null,
      hasNoSlStory: slItems.length === 0,
      unclassifiedIssueKeys,
    };
  }

  // Inclusive of the start day: one day of work beginning Monday finishes on Monday.
  const devCompleteIso = devWorkingDays === 0
    ? startFromIso
    : addWorkingDays(startFromIso, devWorkingDays - 1, config.calendar);

  if (slItems.length === 0) {
    // Reported through hasNoSlStory rather than dated as if testing were free. An absent test story
    // is a gap somebody should see, not a saving.
    return {
      devCompleteIso,
      slStartIso: null,
      slWorkingDays: null,
      dodDateIso: devCompleteIso,
      hasNoSlStory: true,
      unclassifiedIssueKeys,
    };
  }

  if (slWorkingDays === null) {
    return {
      devCompleteIso,
      slStartIso: null,
      slWorkingDays: null,
      dodDateIso: null,
      hasNoSlStory: false,
      unclassifiedIssueKeys,
    };
  }

  // SL cannot begin until the LAST dev story is awaiting test, so it starts the working day after.
  const slStartIso = addWorkingDays(devCompleteIso, 1, config.calendar);

  return {
    devCompleteIso,
    slStartIso,
    slWorkingDays,
    dodDateIso: slWorkingDays === 0
      ? devCompleteIso
      : addWorkingDays(slStartIso, slWorkingDays - 1, config.calendar),
    hasNoSlStory: false,
    unclassifiedIssueKeys,
  };
}
