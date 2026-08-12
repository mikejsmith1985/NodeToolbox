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

/** Issue types that ARE the business outcome, rather than work that rolls up to one. */
const FEATURE_ISSUE_TYPE_NAMES = new Set(['feature', 'epic']);

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
  /** The label marking this team's Features. When set it replaces the board's ownership guessing. */
  teamFeatureLabel?: string;
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

/** True when the issue IS a Feature, rather than work that rolls up to one. */
function isFeatureIssue(fields: Record<string, unknown> | null): boolean {
  const issueType = fields?.issuetype as { name?: string } | undefined;
  return FEATURE_ISSUE_TYPE_NAMES.has(String(issueType?.name ?? '').trim().toLowerCase());
}

/** True when the Feature carries the team's label, whatever case it was typed in. */
function carriesTeamLabel(fields: Record<string, unknown> | null, teamFeatureLabel: string): boolean {
  const wantedLabel = teamFeatureLabel.trim().toLowerCase();
  if (wantedLabel === '') return false;
  const labels = Array.isArray(fields?.labels) ? fields!.labels as unknown[] : [];
  return labels.some((label) => String(label).trim().toLowerCase() === wantedLabel);
}

/**
 * Whether the team's label lets this Feature through, when one is in use.
 *
 * The commonest reason a Feature goes missing right after a team adopts a label is simply that it has
 * not been applied yet — so the check has to name the label rather than leave a correct project check
 * looking like the whole story.
 */
function diagnoseTeamLabel(
  featureKey: string,
  featureFields: Record<string, unknown> | null,
  teamFeatureLabel: string,
): DiagnosisStep | null {
  if (teamFeatureLabel.trim() === '') return null;

  const question = `Does it carry the team's "${teamFeatureLabel.trim()}" label?`;
  return carriesTeamLabel(featureFields, teamFeatureLabel)
    ? { question, verdict: 'included', detail: `${featureKey} carries it.` }
    : {
      question,
      verdict: 'excluded',
      detail: `${featureKey} does not carry it. With a label configured the board stops guessing`
        + ' ownership entirely, so an unlabelled Feature is left out however it is assigned. Add the'
        + ' label in Jira, or clear it in Board setup to go back to inferring ownership.',
    };
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
 * Walks the decisions that apply to a FEATURE, which are not the ones that apply to work.
 *
 * Asking a Feature "is it in the dashboard's PI scope?" or "does it roll up to a Feature?" are both
 * category errors: the scope query asks the TEAM's project and a Feature does not live there, and a
 * Feature does not roll up to anything — it is the lane. A Feature reaches the board one of three
 * ways, so those are what get checked.
 */
function diagnoseFeaturePlacement(input: PlacementDiagnosisInput): DiagnosisStep[] {
  const featureProjectKey = readProjectKey(input.issueKey);
  const trackedKeys = input.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase());
  const isTracked = trackedKeys.length === 0 || trackedKeys.includes(featureProjectKey);
  const featurePiValue = readPiValue(input.issueFields, input.piFieldId);

  const trackedStep: DiagnosisStep = isTracked
    ? {
      question: 'Is it one of the Feature projects this team tracks?',
      verdict: 'included',
      detail: `${input.issueKey} is in ${featureProjectKey}, which this team tracks.`,
    }
    : {
      question: 'Is it one of the Feature projects this team tracks?',
      verdict: 'excluded',
      detail: `${input.issueKey} is in ${featureProjectKey}, which is not in (${trackedKeys.join(', ')}).`
        + ' Widen the projects in Board setup to reach it.',
    };

  const labelStep = diagnoseTeamLabel(input.issueKey, input.issueFields, input.teamFeatureLabel ?? '');

  const lanesFromWorkStep: DiagnosisStep = {
    question: 'Does any in-scope work roll up to it?',
    verdict: 'not-applicable',
    detail: 'A Feature earns a lane from the work beneath it, so if any issue in this PI links to'
      + ` ${input.issueKey} it already has one. Check a child with this same tool if not.`,
  };

  if (input.carryOverPiValue.trim() === '') {
    return [
      trackedStep,
      ...(labelStep ? [labelStep] : []),
      lanesFromWorkStep,
      {
        question: 'Would the carry-over sweep pull it in?',
        verdict: 'excluded',
        detail: `Its PI is "${featurePiValue || '(empty)'}" and no carry-over PI is set in Board setup,`
          + ' so nothing outside the current PI is pulled in. Set one to reach the previous PI.',
      },
    ];
  }

  if (featurePiValue !== input.carryOverPiValue) {
    return [trackedStep, ...(labelStep ? [labelStep] : []), lanesFromWorkStep, {
      question: 'Would the carry-over sweep pull it in?',
      verdict: 'excluded',
      detail: `Its PI is "${featurePiValue || '(empty)'}", but the sweep asks for`
        + ` "${input.carryOverPiValue}".`,
    }];
  }
  if (isDone(input.issueFields)) {
    return [trackedStep, ...(labelStep ? [labelStep] : []), lanesFromWorkStep, {
      question: 'Would the carry-over sweep pull it in?',
      verdict: 'excluded',
      detail: `${input.issueKey} is finished, and the sweep asks only for unfinished Features — one`
        + ' that finished was delivered, not carried.',
    }];
  }

  return [trackedStep, ...(labelStep ? [labelStep] : []), lanesFromWorkStep, {
    question: 'Would the carry-over sweep pull it in?',
    verdict: 'included',
    detail: `${input.issueKey} is unfinished and in PI "${input.carryOverPiValue}", so the sweep`
      + ' reaches it and its child work.',
  }];
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

  // A Feature is judged on entirely different questions from the work beneath it.
  if (isFeatureIssue(input.issueFields)) {
    return diagnoseFeaturePlacement(input);
  }

  const labelStep = input.featureKey === null
    ? null
    : diagnoseTeamLabel(input.featureKey, input.featureFields, input.teamFeatureLabel ?? '');

  return [
    diagnosePiScope(input),
    diagnoseCarryOver(input),
    diagnoseRollUp(input),
    diagnoseFeatureScope(input),
    ...(labelStep ? [labelStep] : []),
  ];
}

/** The one sentence that answers the question, drawn from the first step that excluded the issue. */
export function summarizeDiagnosis(issueKey: string, steps: readonly DiagnosisStep[]): string {
  const reachedBoard = steps.some(
    (step) => step.question.startsWith('Is it in the PI') && step.verdict === 'included',
  ) || steps.some((step) => step.question.startsWith('Would the carry-over') && step.verdict === 'included')
    || steps.some((step) => step.question.startsWith('Does any in-scope work'));

  const blockingStep = steps.find((step) => step.verdict === 'excluded');
  if (reachedBoard && !blockingStep) {
    return `${issueKey} should be on the board. If it is not, the board may need a refresh.`;
  }
  if (!reachedBoard) {
    return `${issueKey} never reaches the board: nothing in the current scope or the carry-over sweep selects it.`;
  }
  return `${issueKey} reaches the board but is then removed: ${blockingStep!.detail}`;
}
