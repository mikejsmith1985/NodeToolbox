// epicDateSchedule.ts — Turns Epic points and team capacity into Target Start / Target End dates for a PI.
//
// The team burns a fixed number of points a working day (its 80% PI capacity spread over the PI's work days).
// Up to a set number of Epics are worked at once, sharing that capacity; when one finishes, the next in
// priority order starts. Target Start is the day an Epic's development starts — never before the PI's first
// day unless it is already being worked — and Target End is the day after development completes, when its
// code moves to INT. Pure and calendar-injected, so the same inputs always give the same dates; the AI only
// ever proposes the ORDER, never a date.

import { addWorkingDays, rollToWorkingDay, type WorkingCalendar } from '../../../utils/workingDays.ts';

/** One Epic to plan, in priority order. */
export interface EpicToSchedule {
  epicKey: string;
  summary: string;
  /** Points left to deliver (the PI Review estimate); null when it has none. */
  points: number | null;
  /** True once the Epic is Implementing or beyond — its start date is already history. */
  isStarted: boolean;
  existingTargetStart: string | null;
}

export interface EpicScheduleSettings {
  piStartDate: string;
  piEndDate: string;
  today: string;
  dailyCapacityPoints: number;
  maxParallelEpics: number;
  calendar: WorkingCalendar;
}

/** The planned dates for one Epic, or why it has none. */
export interface EpicDateProposal {
  epicKey: string;
  summary: string;
  points: number | null;
  targetStart: string | null;
  targetEnd: string | null;
  status: 'scheduled' | 'no-points' | 'no-capacity' | 'beyond-horizon';
  isPastPiEnd: boolean;
}

// A year of working days: a plan that has not finished by then is reported, not looped on forever.
const MAX_SIMULATED_WORKING_DAYS = 260;
// Points below this are rounding dust from splitting capacity, not work left to do.
const REMAINING_POINTS_EPSILON = 0.0001;

/** Points the team delivers per working day: its 80% PI capacity spread evenly over the PI's work days. */
export function readDailyCapacityPoints(recommendedCapacityPoints: number, workDayCount: number): number {
  return workDayCount > 0 ? recommendedCapacityPoints / workDayCount : 0;
}

/** An Epic being simulated: how much is left, and the dates found so far. */
interface EpicInFlight {
  epic: EpicToSchedule;
  remainingPoints: number;
  targetStart: string | null;
  targetEnd: string | null;
}

/** The later of two ISO days. */
function laterOf(firstDay: string, secondDay: string): string {
  return firstDay > secondDay ? firstDay : secondDay;
}

/**
 * Shares one day's capacity across the active Epics: equally, with whatever an Epic does not need passed on
 * to the others, so no capacity is wasted while work is waiting.
 */
function spendDailyCapacity(activeEpics: readonly EpicInFlight[], dailyCapacityPoints: number): void {
  let capacityLeft = dailyCapacityPoints;
  let unfinishedEpics = activeEpics.filter((epic) => epic.remainingPoints > REMAINING_POINTS_EPSILON);
  while (capacityLeft > REMAINING_POINTS_EPSILON && unfinishedEpics.length > 0) {
    const equalShare = capacityLeft / unfinishedEpics.length;
    for (const epicInFlight of unfinishedEpics) {
      const pointsSpent = Math.min(equalShare, epicInFlight.remainingPoints);
      epicInFlight.remainingPoints -= pointsSpent;
      capacityLeft -= pointsSpent;
    }
    unfinishedEpics = unfinishedEpics.filter((epic) => epic.remainingPoints > REMAINING_POINTS_EPSILON);
  }
}

/**
 * The day an Epic is shown starting: a started Epic keeps its Jira Target Start when that is on or before the day
 * its work is scheduled from; otherwise it starts that day. A started Epic with a FUTURE Target Start was kept as
 * is while its work ran from today — its end landed before its start and Jira refused the dates (GH #415).
 */
function readStartingDay(epic: EpicToSchedule, currentDay: string): string {
  const existingStart = epic.existingTargetStart;
  return epic.isStarted && existingStart !== null && existingStart <= currentDay ? existingStart : currentDay;
}

/** Works the queue day by day until every Epic is in INT or the horizon runs out. */
function simulateWorkingDays(queue: EpicInFlight[], settings: EpicScheduleSettings): void {
  const firstWorkDay = rollToWorkingDay(laterOf(settings.today, settings.piStartDate), settings.calendar);
  let activeEpics: EpicInFlight[] = [];
  let currentDay = firstWorkDay;
  for (let dayIndex = 0; dayIndex < MAX_SIMULATED_WORKING_DAYS; dayIndex += 1) {
    while (activeEpics.length < settings.maxParallelEpics && queue.length > 0) {
      const startingEpic = queue.shift() as EpicInFlight;
      startingEpic.targetStart = readStartingDay(startingEpic.epic, currentDay);
      activeEpics.push(startingEpic);
    }
    if (activeEpics.length === 0) {
      return;
    }
    spendDailyCapacity(activeEpics, settings.dailyCapacityPoints);
    activeEpics.filter((epic) => epic.remainingPoints <= REMAINING_POINTS_EPSILON)
      .forEach((finishedEpic) => { finishedEpic.targetEnd = addWorkingDays(currentDay, 1, settings.calendar); });
    activeEpics = activeEpics.filter((epic) => epic.targetEnd === null);
    currentDay = addWorkingDays(currentDay, 1, settings.calendar);
  }
}

/** One Epic's result, in the shape the proposal table shows. */
function toProposal(epicInFlight: EpicInFlight, settings: EpicScheduleSettings): EpicDateProposal {
  const isScheduled = epicInFlight.targetEnd !== null;
  return {
    epicKey: epicInFlight.epic.epicKey,
    summary: epicInFlight.epic.summary,
    points: epicInFlight.epic.points,
    targetStart: isScheduled ? epicInFlight.targetStart : null,
    targetEnd: epicInFlight.targetEnd,
    status: isScheduled ? 'scheduled' : 'beyond-horizon',
    isPastPiEnd: isScheduled && (epicInFlight.targetEnd as string) > settings.piEndDate,
  };
}

/** An Epic that cannot be planned at all, and why. */
function toUnplannedProposal(epic: EpicToSchedule, status: 'no-points' | 'no-capacity'): EpicDateProposal {
  return { epicKey: epic.epicKey, summary: epic.summary, points: epic.points, targetStart: null, targetEnd: null, status, isPastPiEnd: false };
}

/**
 * Plans every Epic's Target Start and Target End, returned in the order given. Epics already being worked
 * go first — they hold their slots — then the rest in priority order. An Epic with no points is reported and
 * takes no slot.
 */
export function scheduleEpicDates(epics: readonly EpicToSchedule[], settings: EpicScheduleSettings): EpicDateProposal[] {
  if (settings.dailyCapacityPoints <= 0) {
    return epics.map((epic) => toUnplannedProposal(epic, 'no-capacity'));
  }
  const plannableEpics = epics
    .filter((epic) => epic.points !== null && epic.points > 0)
    .map((epic): EpicInFlight => ({ epic, remainingPoints: epic.points as number, targetStart: null, targetEnd: null }));
  const queue = [
    ...plannableEpics.filter((epicInFlight) => epicInFlight.epic.isStarted),
    ...plannableEpics.filter((epicInFlight) => !epicInFlight.epic.isStarted),
  ];
  simulateWorkingDays([...queue], settings);
  const proposalsByKey = new Map(plannableEpics.map((epicInFlight) => [epicInFlight.epic.epicKey, toProposal(epicInFlight, settings)]));
  return epics.map((epic) => proposalsByKey.get(epic.epicKey) ?? toUnplannedProposal(epic, 'no-points'));
}
