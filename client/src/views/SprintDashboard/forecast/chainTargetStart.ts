// chainTargetStart.ts — The day a Feature's work has to BEGIN to make code freeze.
//
// The date policy already worked a Target Start back from a deadline, but it counted only the
// issue's own effort. A dev story with a week of SL testing queued behind it was therefore told it
// could start a week later than it really could -- and it read "on track" every single day until
// the Feature missed its commitment, because the dev story genuinely was on track. The work that
// made the Feature late was never the work being measured.
//
// So this works the WHOLE chain backwards from the deadline: SL testing, the queue it waits in, the
// review dev waits on, and dev itself. The two waits are real days somebody spends not working, and
// a plan that leaves them out is a plan that is two days wrong before anybody starts.

import { subtractWorkingDays } from '../../../utils/workingDays.ts';
import type { ChainItem, WorkingCalendar } from './forecastTypes.ts';

/**
 * A day between dev finishing and the work actually being test-ready.
 *
 * Code review is a wait, not work: nobody is charged for it and it still happens. Held separate from
 * the queue buffer below because they are two different delays, owned by two different people, and
 * a team that shortens one has not shortened the other.
 */
export const CODE_REVIEW_BUFFER_WORKING_DAYS = 1;

/** A day between work becoming test-ready and a tester actually picking it up. */
export const SL_QUEUE_BUFFER_WORKING_DAYS = 1;

/** When each part of the chain has to start, and which issues those dates belong to. */
export interface ChainTargetStarts {
  /** The day the Feature's dev work has to begin. */
  devStartIso: string | null;
  /** The day dev has to be finished, leaving both buffers intact. */
  devMustCompleteIso: string | null;
  /** The day SL testing has to begin. */
  slStartIso: string | null;
  /** Target Start per issue. Absent for anything already through, or when nothing could be dated. */
  targetStartByIssueKey: Record<string, string>;
  hasNoSlStory: boolean;
  /** True when some work carries no estimate, which is why no date was produced. */
  hasUnsizedWork: boolean;
}

/** The empty answer, so every refusal below returns the same shape rather than a special case. */
function undatedResult(hasNoSlStory: boolean, hasUnsizedWork: boolean): ChainTargetStarts {
  return {
    devStartIso: null,
    devMustCompleteIso: null,
    slStartIso: null,
    targetStartByIssueKey: {},
    hasNoSlStory,
    hasUnsizedWork,
  };
}

/** Work already awaiting test or finished costs nothing more, whatever its estimate once said. */
function isStillOutstanding(item: ChainItem): boolean {
  return !item.isInternalTestReady && !item.isComplete;
}

/**
 * Sums the working days a set of items still needs, or null when any of them is unsized.
 *
 * Null rather than a partial total on purpose: a chain date that quietly omits unmeasured work looks
 * exactly like a real one, and a reader has no way to tell which they are looking at.
 */
function sumOutstandingWorkingDays(items: readonly ChainItem[]): number | null {
  let total = 0;
  for (const item of items.filter(isStillOutstanding)) {
    if (item.remainingWorkingDays === null) {
      return null;
    }
    total += item.remainingWorkingDays;
  }
  return total;
}

/**
 * Works every stage of one Feature's chain back from the deadline it has to meet.
 *
 * `deadlineIso` is the day the chain has to be FINISHED by -- code freeze, or the PI's own deadline,
 * whichever binds first. The caller decides which; this only counts backwards from it.
 *
 * Dev effort is summed rather than maxed, which is the safe direction for a deadline: two dev
 * stories held by two different people is a parallelism the per-person capacity check surfaces, and
 * assuming it here would quietly promise a date nobody committed to.
 *
 * A start that lands in the past is returned as it falls. Clamping it to today would report a chain
 * that cannot be delivered as one starting this morning, which is the exact false comfort the
 * forecast exists to remove.
 */
export function buildChainTargetStarts(
  items: readonly ChainItem[],
  deadlineIso: string | null,
  calendar: WorkingCalendar,
): ChainTargetStarts {
  const slItems = items.filter((item) => item.role === 'sl');
  const hasNoSlStory = slItems.length === 0;

  if (deadlineIso === null) {
    return undatedResult(hasNoSlStory, false);
  }

  // Anything not explicitly SL is treated as dev -- including unclassified work, because dev is the
  // side that has to finish FIRST. Guessing the other way would hide a late start rather than show
  // one, and a forecast that errs must err toward the alarm.
  const devItems = items.filter((item) => item.role !== 'sl');
  const devWorkingDays = sumOutstandingWorkingDays(devItems);
  const slWorkingDays = sumOutstandingWorkingDays(slItems);

  if (devWorkingDays === null || slWorkingDays === null) {
    return undatedResult(hasNoSlStory, true);
  }

  // SL finishes ON the deadline, so its start is inclusive of its own last day: two days of testing
  // due Friday run Thursday and Friday, not Wednesday and Thursday.
  const slStartIso = slWorkingDays === 0
    ? deadlineIso
    : subtractWorkingDays(deadlineIso, slWorkingDays - 1, calendar);

  // Both waits are reserved even when there is no SL story to schedule. Dev is still reviewed, and
  // the work still sits waiting for whoever picks it up; an absent test story is a gap to be seen,
  // never a saving to be spent.
  const devMustCompleteIso = subtractWorkingDays(
    slStartIso,
    CODE_REVIEW_BUFFER_WORKING_DAYS + SL_QUEUE_BUFFER_WORKING_DAYS,
    calendar,
  );

  const devStartIso = devWorkingDays === 0
    ? devMustCompleteIso
    : subtractWorkingDays(devMustCompleteIso, devWorkingDays - 1, calendar);

  // Only outstanding work is dated. Giving a finished issue a start date would put a plan on top of
  // a fact, and the fact is the more useful of the two.
  const targetStartByIssueKey: Record<string, string> = {};
  devItems.filter(isStillOutstanding).forEach((item) => {
    targetStartByIssueKey[item.issueKey] = devStartIso;
  });
  slItems.filter(isStillOutstanding).forEach((item) => {
    targetStartByIssueKey[item.issueKey] = slStartIso;
  });

  return {
    devStartIso,
    devMustCompleteIso,
    slStartIso,
    targetStartByIssueKey,
    hasNoSlStory,
    hasUnsizedWork: false,
  };
}
