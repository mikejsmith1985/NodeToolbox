// piPlanFactSheet.ts — Assembles the deterministic PI Planning Fact Sheet (spec 032, contract fact-sheet.md).
//
// This is the anti-hallucination spine: a single immutable bundle of queried facts that BOTH feeds the
// delivery engine AND is embedded verbatim in the AI prompt, so the AI never supplies a fact it could get
// wrong. Pure — the caller performs the queries (via existing fetchers) and passes the results in; this
// module validates, normalizes, applies the load factor once, and computes the delivery deadline.

import { isCarryoverFeature } from './piPlanCarryover.ts';
import type {
  ComponentClass,
  ExistingChild,
  FactSheetFeature,
  FactSheetPerson,
  FactSheetSprint,
  PiPlanningFactSheet,
  ReleaseSchedule,
} from './piPlanTypes.ts';

/** The default share of raw velocity planned as delivery capacity — the 20% remainder absorbs defects/support. */
const DEFAULT_LOAD_FACTOR = 0.8;
/** Calendar days from a sprint's start to the end of its first week (the delivery cutoff before innovation week). */
const WEEK_ONE_END_OFFSET_DAYS = 6;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** One raw Feature as queried from PI Review, before repo/domain classification. */
export interface FactSheetFeatureInput {
  key: string;
  summary: string;
  /** Plain-text Feature description (nine-section doc incl. AC in this org), truncated by the adapter.
   *  Gives the AI real content to decompose from instead of a bare title. Optional for older callers/tests. */
  description?: string;
  sizePoints: number | null;
  priorityRank: number;
  priorityName: string | null;
  isCommitted: boolean;
  componentNames: string[];
  dependencyKeys: string[];
  targetFixVersion: string | null;
  existingChildren: ExistingChild[];
}

/** One raw roster person, carrying raw velocity (the load factor is applied here, once). */
export interface FactSheetPersonInput {
  displayName: string;
  accountId: string | null;
  roles: string[];
  velocity: number;
}

/** Everything the assembler needs — all produced by the caller's queries (framework-first reuse). */
export interface FactSheetInputs {
  piName: string;
  piStartIso: string;
  sprints: { name: string; startIso: string; endIso: string }[];
  features: FactSheetFeatureInput[];
  people: FactSheetPersonInput[];
  releaseSchedule: ReleaseSchedule;
  fieldConfig: { inIntStatusNames: string[]; slDoneStatusNames: string[]; doneCategoryNames: string[] };
  /** Classifies a component name repo/domain/unclassified (031 classification store). */
  classifyComponent: (componentName: string) => ComponentClass;
  /** Fraction of raw velocity to plan; defaults to 0.80. */
  loadFactor?: number;
}

/** Returns the ISO date `days` calendar days after `iso`. */
function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MILLISECONDS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** Splits a Feature's components into repo and domain lists (unclassified excluded from both). */
function classifyComponents(
  componentNames: string[],
  classify: (name: string) => ComponentClass,
): { repoComponentNames: string[]; domainComponentNames: string[] } {
  const repoComponentNames: string[] = [];
  const domainComponentNames: string[] = [];
  for (const name of componentNames) {
    const kind = classify(name);
    if (kind === 'repo') {
      repoComponentNames.push(name);
    } else if (kind === 'domain') {
      domainComponentNames.push(name);
    }
  }
  return { repoComponentNames, domainComponentNames };
}

/** Computes the delivery deadline: the end of the final sprint's first week (Sprint-5 Week-1). */
function computeDeliveryDeadline(sprints: { startIso: string }[], piStartIso: string): string {
  if (sprints.length === 0) {
    return piStartIso;
  }
  const lastSprint = sprints[sprints.length - 1];
  return addCalendarDays(lastSprint.startIso, WEEK_ONE_END_OFFSET_DAYS);
}

/**
 * Assembles the immutable fact sheet. The load factor is applied exactly once (velocity → pointsPerSprint);
 * components are split repo/domain; the repo allowlist is the de-duped union of every repo name; honest
 * states (unsized Feature, no-repo Feature) are surfaced as notes rather than thrown.
 */
export function assembleFactSheet(inputs: FactSheetInputs): PiPlanningFactSheet {
  const loadFactor = inputs.loadFactor ?? DEFAULT_LOAD_FACTOR;
  const notes: string[] = [];
  const allowlist = new Set<string>();

  const features: FactSheetFeature[] = inputs.features.map((feature) => {
    const { repoComponentNames, domainComponentNames } = classifyComponents(feature.componentNames, inputs.classifyComponent);
    repoComponentNames.forEach((repoName) => allowlist.add(repoName));
    if (feature.sizePoints == null) {
      notes.push(`Feature ${feature.key} is not sized — it cannot be planned until it has a point size.`);
    }
    if (repoComponentNames.length === 0) {
      notes.push(`Feature ${feature.key} has no repo components — map repos first (no coding sub-tasks will be generated).`);
    }
    const carryover = isCarryoverFeature(feature.existingChildren);
    if (carryover) {
      notes.push(`Feature ${feature.key} is carryover (already has Stories in flight) — it will be reconciled, not regenerated.`);
    }
    return {
      key: feature.key,
      summary: feature.summary,
      description: feature.description,
      sizePoints: feature.sizePoints,
      priorityRank: feature.priorityRank,
      priorityName: feature.priorityName,
      isCommitted: feature.isCommitted,
      repoComponentNames,
      domainComponentNames,
      dependencyKeys: [...feature.dependencyKeys],
      targetFixVersion: feature.targetFixVersion,
      existingChildren: feature.existingChildren.map((child) => ({ ...child })),
      isCarryover: carryover,
    };
  });

  const people: FactSheetPerson[] = inputs.people.map((person) => ({
    displayName: person.displayName,
    accountId: person.accountId,
    roles: [...person.roles],
    pointsPerSprint: person.velocity * loadFactor,
  }));
  const velocityByPerson: Record<string, number> = {};
  inputs.people.forEach((person) => { velocityByPerson[person.displayName] = person.velocity; });

  if (people.length === 0) {
    notes.push('No roster member has a delivery capability — nothing can be assigned.');
  }
  if (!people.some((person) => person.roles.includes('internalTest'))) {
    notes.push('No roster member has the SL-test capability — SL testing cannot be assigned.');
  }
  if (inputs.releaseSchedule.entries.length === 0) {
    notes.push('No production releases fall in the PI window — a monthly cadence will be suggested.');
  }

  const sprints: FactSheetSprint[] = inputs.sprints.map((sprint) => ({ ...sprint }));

  return {
    piName: inputs.piName,
    piStartIso: inputs.piStartIso,
    deliveryDeadlineIso: computeDeliveryDeadline(inputs.sprints, inputs.piStartIso),
    features,
    people,
    sprints,
    releaseSchedule: { entries: inputs.releaseSchedule.entries.map((entry) => ({ ...entry })) },
    repoAllowlist: [...allowlist],
    fieldConfig: {
      inIntStatusNames: [...inputs.fieldConfig.inIntStatusNames],
      slDoneStatusNames: [...inputs.fieldConfig.slDoneStatusNames],
      doneCategoryNames: [...inputs.fieldConfig.doneCategoryNames],
    },
    velocityByPerson,
    notes,
  };
}
