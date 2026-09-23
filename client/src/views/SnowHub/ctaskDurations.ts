// ctaskDurations.ts — The estimated-duration block ServiceNow's change approvers ask for on every CTASK and CHG.
//
// The CAB's own words (work note on CHG, 2026-09-22): "Please document the estimated duration in the Ctasks:
// Implementation, Post-deployment validation/monitoring, Backout/recovery and restoration validation. Please confirm
// the planned window provides sufficient time for implementation and validation while preserving enough time for
// complete recovery and restoration validation if backout is required."
//
// So three estimates, and a confirmation that the window holds them. Everything here is pure text and arithmetic:
// the same block renders in the form, in the CTASK description and in the CHG implementation plan, which is what
// makes the screen and the submitted record agree by construction.

/** How long each phase of a change is expected to take. Held as typed text so a half-filled form is a normal state. */
export interface DurationEstimates {
  /** Doing the change itself. */
  implementationMinutes: string;
  /** Watching it afterwards — the CAB's "post-deployment validation/monitoring". */
  validationMinutes: string;
  /** Backing it out and proving the restore worked, if it comes to that. */
  backoutMinutes: string;
}

/** A CTASK or CHG with nothing estimated yet. */
export const EMPTY_DURATION_ESTIMATES: DurationEstimates = {
  implementationMinutes: '',
  validationMinutes:     '',
  backoutMinutes:        '',
};

/** The three phases, in the order the CAB asked for them, with the exact labels they used. */
export const DURATION_PHASES: ReadonlyArray<{ key: keyof DurationEstimates; label: string }> = [
  { key: 'implementationMinutes', label: 'Implementation' },
  { key: 'validationMinutes',     label: 'Post-deployment validation/monitoring' },
  { key: 'backoutMinutes',        label: 'Backout/recovery and restoration validation' },
];

/** Markers around the generated block, so re-generating replaces it instead of stacking copies. */
const BLOCK_START_MARKER = '--- Estimated duration ---';
const BLOCK_END_MARKER = '--- end estimated duration ---';

const MINUTES_PER_HOUR = 60;

/** Reads a typed estimate as whole minutes. Blank, zero, negative or non-numeric all mean "not estimated". */
export function readEstimateMinutes(typedValue: string): number | null {
  const trimmedValue = typedValue.trim();
  if (trimmedValue === '') {
    return null;
  }
  const parsedMinutes = Number(trimmedValue);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return null;
  }
  return Math.round(parsedMinutes);
}

/** Writes minutes the way a person says them: "45 minutes", "1 hour", "2 hours 30 minutes". */
export function formatMinutes(totalMinutes: number): string {
  const wholeHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const leftoverMinutes = totalMinutes % MINUTES_PER_HOUR;
  const hourText = wholeHours === 1 ? '1 hour' : `${wholeHours} hours`;
  const minuteText = leftoverMinutes === 1 ? '1 minute' : `${leftoverMinutes} minutes`;

  if (wholeHours === 0) {
    return minuteText;
  }
  return leftoverMinutes === 0 ? hourText : `${hourText} ${minuteText}`;
}

/** The phase labels still missing an estimate — what the form shows as outstanding. */
export function listMissingEstimateLabels(estimates: DurationEstimates): string[] {
  return DURATION_PHASES
    .filter((phase) => readEstimateMinutes(estimates[phase.key]) === null)
    .map((phase) => phase.label);
}

/** How long the three phases add up to. Phases with no estimate simply contribute nothing. */
export function sumEstimateMinutes(estimates: DurationEstimates): number {
  return DURATION_PHASES.reduce(
    (runningTotal, phase) => runningTotal + (readEstimateMinutes(estimates[phase.key]) ?? 0),
    0,
  );
}

/** Minutes between a planned start and end, or null when either is unset or the pair is backwards. */
export function readPlannedWindowMinutes(plannedStartDate: string, plannedEndDate: string): number | null {
  if (plannedStartDate.trim() === '' || plannedEndDate.trim() === '') {
    return null;
  }
  const startInstant = new Date(plannedStartDate);
  const endInstant = new Date(plannedEndDate);
  if (Number.isNaN(startInstant.getTime()) || Number.isNaN(endInstant.getTime())) {
    return null;
  }
  const windowMinutes = Math.round((endInstant.getTime() - startInstant.getTime()) / 60_000);
  return windowMinutes > 0 ? windowMinutes : null;
}

/** Whether the planned window actually holds the work that was estimated. */
export interface WindowCoverage {
  /** Implementation + validation + backout. */
  totalEstimatedMinutes: number;
  /** Planned end minus planned start, or null when the window is not set. */
  windowMinutes: number | null;
  /** True only when the window is known AND at least as long as the total. */
  isSufficient: boolean;
  /** How much longer the window needs to be. Zero when it already fits or is unknown. */
  shortfallMinutes: number;
  /** True when all three phases carry an estimate — the CAB asked for all three. */
  isFullyEstimated: boolean;
}

/** Compares the estimates against the planned window, saying plainly which of the three states applies. */
export function checkWindowCoversEstimates(
  estimates: DurationEstimates,
  plannedStartDate: string,
  plannedEndDate: string,
): WindowCoverage {
  const totalEstimatedMinutes = sumEstimateMinutes(estimates);
  const windowMinutes = readPlannedWindowMinutes(plannedStartDate, plannedEndDate);
  const isSufficient = windowMinutes !== null && windowMinutes >= totalEstimatedMinutes && totalEstimatedMinutes > 0;

  return {
    totalEstimatedMinutes,
    windowMinutes,
    isSufficient,
    shortfallMinutes: windowMinutes !== null && windowMinutes < totalEstimatedMinutes
      ? totalEstimatedMinutes - windowMinutes
      : 0,
    isFullyEstimated: listMissingEstimateLabels(estimates).length === 0,
  };
}

/** The one-line verdict on the window, in the terms the approver asked to see it confirmed. */
export function describeWindowCoverage(coverage: WindowCoverage): string {
  if (coverage.totalEstimatedMinutes === 0) {
    return 'Planned window: nothing estimated yet, so the window cannot be confirmed.';
  }
  if (coverage.windowMinutes === null) {
    return `Planned window: not set. ${formatMinutes(coverage.totalEstimatedMinutes)} is needed in total.`;
  }
  if (coverage.isSufficient) {
    return `Planned window: ${formatMinutes(coverage.windowMinutes)} — sufficient for implementation and validation `
      + 'while preserving enough time for complete recovery and restoration validation if backout is required.';
  }
  return `Planned window: ${formatMinutes(coverage.windowMinutes)} — ${formatMinutes(coverage.shortfallMinutes)} `
    + `SHORT of the ${formatMinutes(coverage.totalEstimatedMinutes)} estimated. Extend the window before submitting.`;
}

/** The block itself: the three estimates the CAB named, then the window confirmation. */
export function buildDurationBlock(
  estimates: DurationEstimates,
  plannedStartDate: string,
  plannedEndDate: string,
): string {
  const estimateLines = DURATION_PHASES.map((phase) => {
    const phaseMinutes = readEstimateMinutes(estimates[phase.key]);
    return `• ${phase.label}: ${phaseMinutes === null ? 'not estimated' : formatMinutes(phaseMinutes)}`;
  });
  const coverage = checkWindowCoversEstimates(estimates, plannedStartDate, plannedEndDate);

  return [
    BLOCK_START_MARKER,
    ...estimateLines,
    describeWindowCoverage(coverage),
    BLOCK_END_MARKER,
  ].join('\n');
}

/** Strips any block written earlier, so applying it twice leaves one block rather than two. */
function removeExistingBlock(text: string): string {
  const blockPattern = new RegExp(`\\n*${BLOCK_START_MARKER}[\\s\\S]*?${BLOCK_END_MARKER}`, 'g');
  return text.replace(blockPattern, '').trimEnd();
}

/**
 * Puts the estimated-duration block at the end of a description or plan, replacing an earlier copy.
 *
 * Idempotent on purpose: a CTASK gets rebuilt every time the CHG is regenerated, and an approver reading three
 * stacked copies of the same estimates learns nothing from any of them.
 */
export function applyDurationBlock(
  originalText: string,
  estimates: DurationEstimates,
  plannedStartDate: string,
  plannedEndDate: string,
): string {
  const textWithoutBlock = removeExistingBlock(originalText);
  const durationBlock = buildDurationBlock(estimates, plannedStartDate, plannedEndDate);
  return textWithoutBlock === '' ? durationBlock : `${textWithoutBlock}\n\n${durationBlock}`;
}

/**
 * Fills in anything a stored CTASK template predates.
 *
 * Templates saved before estimates existed carry none, and they are read back straight out of localStorage — so
 * every read goes through here rather than trusting the shape the browser handed back.
 */
export function normalizeEstimates(storedEstimates: Partial<DurationEstimates> | undefined | null): DurationEstimates {
  return {
    implementationMinutes: storedEstimates?.implementationMinutes ?? '',
    validationMinutes:     storedEstimates?.validationMinutes ?? '',
    backoutMinutes:        storedEstimates?.backoutMinutes ?? '',
  };
}

/**
 * Adds up a CHG's CTASKs into one set of estimates for the change as a whole.
 *
 * Summed rather than asked for again: the change takes as long as its tasks take, and a CHG-level number typed
 * separately is a second source of truth that drifts from the first.
 */
export function rollUpEstimates(
  taskEstimates: readonly (Partial<DurationEstimates> | undefined)[],
): DurationEstimates {
  const rolledUp = { ...EMPTY_DURATION_ESTIMATES };

  DURATION_PHASES.forEach((phase) => {
    const phaseTotal = taskEstimates.reduce(
      (runningTotal, estimates) => runningTotal + (readEstimateMinutes(normalizeEstimates(estimates)[phase.key]) ?? 0),
      0,
    );
    rolledUp[phase.key] = phaseTotal > 0 ? String(phaseTotal) : '';
  });

  return rolledUp;
}

/**
 * Reads the estimates back out of a description that already carries a block.
 *
 * Cloning a real CTASK out of ServiceNow returns its description text and nothing else, so without this the numbers
 * an engineer already recorded would be re-written as "not estimated" the next time the block was applied.
 */
export function readEstimatesFromText(text: string): DurationEstimates {
  const recovered = { ...EMPTY_DURATION_ESTIMATES };

  DURATION_PHASES.forEach((phase) => {
    const escapedLabel = phase.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hoursAndMinutes = new RegExp(`${escapedLabel}:\\s*(?:(\\d+)\\s*hours?)?\\s*(?:(\\d+)\\s*minutes?)?`, 'i');
    const lineMatch = hoursAndMinutes.exec(text);
    if (!lineMatch || (lineMatch[1] === undefined && lineMatch[2] === undefined)) {
      return;
    }
    const phaseMinutes = Number(lineMatch[1] ?? 0) * MINUTES_PER_HOUR + Number(lineMatch[2] ?? 0);
    if (phaseMinutes > 0) {
      recovered[phase.key] = String(phaseMinutes);
    }
  });

  return recovered;
}
