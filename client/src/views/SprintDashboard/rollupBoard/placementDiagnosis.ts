// placementDiagnosis.ts — Answers "why is this issue not on my board?" without a round trip to me.
//
// The board decides an issue's fate in several independent steps, and every one of them can quietly
// exclude it: the dashboard's PI scope, the carry-over sweep, the roll-up route, the Feature-project
// filter, and finally the column vocabulary. When an issue is missing, ANY of those could be the
// reason, and from the outside they all look identical — the issue simply is not there.
//
// So this walks the same steps in the same order and reports what each one decided, with the actual
// values it compared. A person can then act on the answer directly rather than describing the symptom
// to somebody else and waiting.
//
// It deliberately re-derives nothing: every rule here mirrors a decision made elsewhere in the board,
// and where the two could drift the check names the module it is mirroring so they are corrected
// together.

// ── Named constants ──

/** Jira's status category for finished work. */
const DONE_STATUS_CATEGORY_KEY = 'done';

/** How one step of the board's decision came out. */
export type DiagnosisVerdict = 'included' | 'excluded' | 'not-applicable';

/** One step of the board's decision, with the values it actually compared. */
export interface DiagnosisStep {
  /** What was being decided, in the reader's terms. */
  question: string;
  verdict: DiagnosisVerdict;
  /** The evidence — what the issue holds, and what the board wanted. */
  detail: string;
}

export interface PlacementDiagnosisInput {
  issueKey: string;
  /** The issue's own fields, as Jira returned them. Null when it could not be read at all. */
  issueFields: Record<string, unknown> | null;
  piFieldId: string;
  featureLinkFieldId: string;
  /** What the dashboard is scoped to right now. */
  selectedPiValue: string;
  /** The carry-over PI the board was told to also pull in, or '' for none. */
  carryOverPiValue: string;
  /** Feature projects this team tracks. Empty means no project filtering at all. */
  featureProjectKeys: readonly string[];
  /** The Feature this issue points at, and that Feature's own fields, when they could be read. */
  featureKey: string | null;
  featureFields: Record<string, unknown> | null;
}

/** Reads a PI value whether the field holds a string or a select option. */
function readPiValue(fields: Record<string, unknown> | null, piFieldId: string): string {
  const rawValue = fields?.[piFieldId];
  if (typeof rawValue === 'string') return rawValue;
  if (rawValue && typeof rawValue === 'object') {
    const optionValue = rawValue as { value?: string; name?: string };
    return optionValue.value ?? optionValue.name ?? '';
  }
  return '';
}

/** The project key a Jira key belongs to. */
function readProjectKey(issueKey: string): string {
  return issueKey.split('-')[0].trim().toUpperCase();
}

/** True when Jira considers this issue finished, read from the category not the status name. */
function isDone(fields: Record<string, unknown> | null): boolean {
  const status = fields?.status as { statusCategory?: { key?: string } } | undefined;
  return String(status?.statusCategory?.key ?? '').toLowerCase() === DONE_STATUS_CATEGORY_KEY;
}

/** Did the dashboard's own PI query reach this issue? */
function diagnosePiScope(input: PlacementDiagnosisInput): DiagnosisStep {
  const issuePiValue = readPiValue(input.issueFields, input.piFieldId);

  if (issuePiValue === input.selectedPiValue && issuePiValue !== '') {
    return {
      question: 'Is it in the PI the dashboard is showing?',
      verdict: 'included',
      detail: `Its PI is "${issuePiValue}", which is the PI selected.`,
    };
  }

  return {
    question: 'Is it in the PI the dashboard is showing?',
    verdict: 'excluded',
    detail: issuePiValue === ''
      ? `Its PI field is EMPTY, so the scope query — which asks for PI = "${input.selectedPiValue}" — cannot see it.`
      : `Its PI is "${issuePiValue}", but the board is scoped to "${input.selectedPiValue}".`,
  };
}

/** Would the carry-over sweep have pulled it in instead? Mirrors carryOverScope.ts. */
function diagnoseCarryOver(input: PlacementDiagnosisInput): DiagnosisStep {
  const question = 'Would the carry-over sweep pull it in?';

  if (input.carryOverPiValue.trim() === '') {
    return {
      question,
      verdict: 'not-applicable',
      detail: 'No carry-over PI is set in Board setup, so nothing outside the current PI is pulled in.',
    };
  }
  if (input.featureKey === null) {
    return {
      question,
      verdict: 'excluded',
      detail: 'It has no Feature Link, and the sweep pulls work in through its Feature.',
    };
  }

  const featureProjectKey = readProjectKey(input.featureKey);
  const isFeatureProjectTracked = input.featureProjectKeys.length === 0
    || input.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase()).includes(featureProjectKey);

  if (!isFeatureProjectTracked) {
    return {
      question,
      verdict: 'excluded',
      detail: `Its Feature ${input.featureKey} is in project ${featureProjectKey}, which is not in this`
        + ` team's Feature projects (${input.featureProjectKeys.join(', ')}). The sweep only asks those`
        + ' projects, so add it there to reach this work.',
    };
  }

  const featurePiValue = readPiValue(input.featureFields, input.piFieldId);
  if (featurePiValue !== input.carryOverPiValue) {
    return {
      question,
      verdict: 'excluded',
      detail: `Its Feature ${input.featureKey} has PI "${featurePiValue || '(empty)'}", but the sweep asks`
        + ` for "${input.carryOverPiValue}".`,
    };
  }
  if (isDone(input.featureFields)) {
    return {
      question,
      verdict: 'excluded',
      detail: `Its Feature ${input.featureKey} is finished, and the sweep asks only for unfinished ones —`
        + ' a Feature that finished was delivered, not carried.',
    };
  }

  return {
    question,
    verdict: 'included',
    detail: `Its Feature ${input.featureKey} is unfinished and in PI "${input.carryOverPiValue}", so the`
      + ' sweep reaches this work.',
  };
}

/** Does it roll up to a Feature at all? Mirrors featureRollup.ts / defectRollup.ts. */
function diagnoseRollUp(input: PlacementDiagnosisInput): DiagnosisStep {
  const question = 'Does it roll up to a Feature?';

  if (input.featureKey === null) {
    return {
      question,
      verdict: 'excluded',
      detail: 'Nothing links it to a Feature, so it would appear in the "No Feature" lane rather than'
        + ' under one — a hygiene problem to fix in Jira.',
    };
  }
  return { question, verdict: 'included', detail: `It rolls up to ${input.featureKey}.` };
}

/** Does the Feature-project filter keep it? Mirrors featureScope.ts. */
function diagnoseFeatureScope(input: PlacementDiagnosisInput): DiagnosisStep {
  const question = 'Is its Feature one this team tracks?';

  if (input.featureProjectKeys.length === 0) {
    return { question, verdict: 'not-applicable', detail: 'No Feature projects are configured, so nothing is filtered out.' };
  }
  if (input.featureKey === null) {
    return { question, verdict: 'not-applicable', detail: 'It has no Feature, so this filter does not apply to it.' };
  }

  const featureProjectKey = readProjectKey(input.featureKey);
  const trackedKeys = input.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase());

  return trackedKeys.includes(featureProjectKey)
    ? { question, verdict: 'included', detail: `${input.featureKey} is in ${featureProjectKey}, which this team tracks.` }
    : {
      question,
      verdict: 'excluded',
      detail: `${input.featureKey} is in ${featureProjectKey}, which is not in (${trackedKeys.join(', ')}).`
        + ' The board hides its work unless Board setup widens the projects or the toggles allow it.',
    };
}

/**
 * Walks the board's decisions in order and reports what each one did.
 *
 * The steps are returned even when an earlier one already excluded the issue, because more than one can
 * be wrong at once and fixing only the first would send somebody round the loop again.
 */
export function diagnosePlacement(input: PlacementDiagnosisInput): DiagnosisStep[] {
  if (input.issueFields === null) {
    return [{
      question: 'Can the issue be read at all?',
      verdict: 'excluded',
      detail: `${input.issueKey} could not be read from Jira — check the key, and that this account can see it.`,
    }];
  }

  return [
    diagnosePiScope(input),
    diagnoseCarryOver(input),
    diagnoseRollUp(input),
    diagnoseFeatureScope(input),
  ];
}

/** The one sentence that answers the question, drawn from the first step that excluded the issue. */
export function summarizeDiagnosis(issueKey: string, steps: readonly DiagnosisStep[]): string {
  const reachedBoard = steps.some(
    (step) => step.question.startsWith('Is it in the PI') && step.verdict === 'included',
  ) || steps.some((step) => step.question.startsWith('Would the carry-over') && step.verdict === 'included');

  const blockingStep = steps.find((step) => step.verdict === 'excluded');
  if (reachedBoard && !blockingStep) {
    return `${issueKey} should be on the board. If it is not, the board may need a refresh.`;
  }
  if (!reachedBoard) {
    return `${issueKey} never reaches the board: nothing in the current scope or the carry-over sweep selects it.`;
  }
  return `${issueKey} reaches the board but is then removed: ${blockingStep!.detail}`;
}
