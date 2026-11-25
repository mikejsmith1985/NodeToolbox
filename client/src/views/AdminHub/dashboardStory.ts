// dashboardStory.ts — The Enrollment dashboard's story: the questions a Scrum Master or RTE reads top to bottom (GH #511).
//
// Background (plain English): the old Enrollment dashboard was a pile of gadgets. The new one is laid out as a story
// for Kanban teams: will we make the PI, how much are we finishing, what is in flight, what is stuck, who is
// overloaded, is enough work queued in Ready to Work, and is quality slipping. Each step names the Rich Filters gadget
// to add, how to set it up, and which of the Kit's clauses it uses. Rich Filters has no public API, so the dashboard
// is built by hand from this sheet; this module only describes it and judges the Ready to Work supply.

// ── The story ──

/** One step of the dashboard, in reading order. */
export interface StorySection {
  step: number;
  question: string;
  /** Why an SM or RTE cares, in one line. */
  whyItMatters: string;
  gadget: string;
  /** How to set the gadget up in Rich Filters. */
  settings: string;
  /** The Kit clauses (views, static filters) this step uses, by name. */
  clauseNames: readonly string[];
}

/** The gadget at the very top: it filters every gadget below it at once. */
export const DASHBOARD_CONTROLLER = {
  gadget: 'Rich Filter Controller',
  settings: 'Dynamic filters: PI (Program Increment), Fix Version/s, Issue Type · Smart filter: Team. Place it first; every gadget below follows it.',
} as const;

const STORY_SECTIONS: readonly Omit<StorySection, 'step'>[] = [
  {
    question: 'Will we make the PI?',
    whyItMatters: 'The Epics the teams committed to, and how far along each one is.',
    gadget: 'Rich Filter Statistics',
    settings: 'View: Epics · Group by: Status · Show count and Story Points. Pick the PI in the controller.',
    clauseNames: ['Epics'],
  },
  {
    question: 'How much are we finishing?',
    whyItMatters: 'Throughput: work finished each week. A falling line is the earliest warning.',
    gadget: 'Rich Filter Created vs. Resolved Chart',
    settings: 'View: Team Work · Period: weekly · Last 90 days. The resolved line is the weekly throughput.',
    clauseNames: ['Team Work', 'Done 30 Days'],
  },
  {
    question: "What's in flight?",
    whyItMatters: 'Work in progress per team. Too much in flight slows everything down.',
    gadget: 'Rich Filter Statistics',
    settings: 'View: Team Work · Static filter: In Progress · Group by: Team (smart filter), then Status.',
    clauseNames: ['Team Work', 'In Progress'],
  },
  {
    question: "What's stuck or blocked?",
    whyItMatters: 'The items that need the SM today.',
    gadget: 'Rich Filter Results',
    settings: 'View: Team Work · Quick filters: Flagged, Stuck 10 Days, Unassigned In Progress · Columns: Key, Summary, Status, Assignee, Updated.',
    clauseNames: ['Flagged', 'Stuck 10 Days', 'Unassigned In Progress'],
  },
  {
    question: 'Is anyone overloaded?',
    whyItMatters: 'Open work per person: overload and idle hands both show here.',
    gadget: 'Rich Filter Statistics',
    settings: 'View: Team Work · Static filter: In Progress · Group by: Assignee · Show count and Story Points.',
    clauseNames: ['Team Work', 'In Progress'],
  },
  {
    question: 'Is there enough Ready to Work?',
    whyItMatters: 'On Kanban the team pulls from Ready to Work; an empty queue stalls the team.',
    gadget: 'Rich Filter Statistics',
    settings: 'View: Team Work · Static filter: Ready to Work · Group by: Team. Ready but Unestimated shows what still needs sizing.',
    clauseNames: ['Team Work', 'Ready to Work', 'Ready but Unestimated'],
  },
  {
    question: 'Is quality slipping?',
    whyItMatters: 'Defects arriving faster than they are fixed.',
    gadget: 'Rich Filter Created vs. Resolved Chart',
    settings: 'View: Defects · Period: weekly · Last 90 days. Open Defects gives the current count.',
    clauseNames: ['Defects', 'Open Defects'],
  },
];

/** The dashboard's steps in reading order, numbered from 1 (the controller sits above step 1). */
export function buildDashboardStory(): StorySection[] {
  return STORY_SECTIONS.map((section, index) => ({ ...section, step: index + 1 }));
}

/** The clauses a step needs that the Kit could not build on this instance (e.g. no Ready to Work status). */
export function listMissingClauses(section: StorySection, availableClauseNames: ReadonlySet<string>): string[] {
  return section.clauseNames.filter((clauseName) => !availableClauseNames.has(clauseName));
}

// ── Ready to Work supply ──

/** "Done 30 Days" spans 30 days; dividing by this many weeks gives a weekly rate. */
const DONE_WINDOW_WEEKS = 30 / 7;
/** Under one week queued, the team will run dry before the next refinement. */
const THIN_SUPPLY_WEEKS = 1;
/** Over three weeks queued, refinement is ahead of what the team can finish. */
const DEEP_SUPPLY_WEEKS = 3;
/** One decimal place, enough to read and not falsely precise. */
const ROUNDING_FACTOR = 10;

export type SupplyVerdict = 'thin' | 'healthy' | 'deep' | 'unknown';

/** How long the Ready to Work queue lasts at the teams' current pace. */
export interface ReadySupply {
  weeklyThroughput: number | null;
  weeksOfSupply: number | null;
  verdict: SupplyVerdict;
  message: string;
}

/** Rounds to one decimal place. */
function roundToTenth(value: number): number {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

/**
 * Judges the Ready to Work queue against throughput: queued items ÷ items finished per week. Counts must both be
 * team work (no Epics), or an Epic's arrival would make the queue look deeper than it is.
 */
export function computeReadySupply(readyCount: number | null, doneLast30DaysCount: number | null): ReadySupply {
  if (readyCount === null || !doneLast30DaysCount) {
    return { weeklyThroughput: null, weeksOfSupply: null, verdict: 'unknown', message: 'No work finished in the last 30 days, so the Ready to Work supply cannot be judged.' };
  }
  const weeklyThroughput = roundToTenth(doneLast30DaysCount / DONE_WINDOW_WEEKS);
  const weeksOfSupply = roundToTenth(readyCount / (doneLast30DaysCount / DONE_WINDOW_WEEKS));
  const pace = `${readyCount} ready ÷ ${weeklyThroughput} finished a week`;
  if (weeksOfSupply < THIN_SUPPLY_WEEKS) {
    return { weeklyThroughput, weeksOfSupply, verdict: 'thin', message: `Only ${weeksOfSupply} weeks of Ready to Work (${pace}) — the team will run dry; refine more.` };
  }
  if (weeksOfSupply > DEEP_SUPPLY_WEEKS) {
    return { weeklyThroughput, weeksOfSupply, verdict: 'deep', message: `${weeksOfSupply} weeks of Ready to Work (${pace}) — more than enough; favour finishing over refining.` };
  }
  return { weeklyThroughput, weeksOfSupply, verdict: 'healthy', message: `${weeksOfSupply} weeks of Ready to Work (${pace}) — healthy.` };
}
