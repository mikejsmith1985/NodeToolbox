// teamStandards.ts — The team's standing answers to Formula Card fields, settled without the AI (GH #415).
//
// Some card fields have the same answer on every change: the bridge is booked after approval, test evidence is
// always attached, escalation starts with the CI Director, and every duration is already estimated on the CTASKs.
// Left to the assistant, it asked about them on every run — and kept asking after it had been told. So the
// prompts state them as facts, and the review's findings for these fields are settled here by rule, whatever the
// reply said. A rule cannot be argued out of; a prompt instruction can.

import type { DurationEstimates } from '../ctaskDurations.ts';
import { isSameName, renderReviewText } from './gapFocus.ts';
import { parseRiskCheckReview, type RiskCheckFinding } from './riskCheckReview.ts';
import { readTeamStandards, type TeamStandard } from './teamStandardsStore.ts';

/**
 * The change owner is the change's Assigned to (the team's rule). When that is set, the Change Owner field is
 * settled; the assistant kept flagging it as a record field to set even with the person named on the record.
 */
function readChangeOwnerAnswer(changeOwnerName: string): ReadonlyArray<{ fieldName: string; detail: string }> {
  const ownerName = changeOwnerName.trim();
  return ownerName === '' ? [] : [{ fieldName: 'Change Owner', detail: `${ownerName} (the change's Assigned to)` }];
}

/** Each kept standard as the PASS detail the review is given for its field. */
function readStandingAnswers(standards: readonly TeamStandard[]): ReadonlyArray<{ fieldName: string; detail: string }> {
  return standards.map((standard) => ({ fieldName: standard.fieldName, detail: `${standard.answer} (team standard)` }));
}

// The statuses a standing answer replaces. PASS and N/A are already settled and are left as the review gave them.
const SETTLEABLE_STATUSES = new Set(['GAP', 'INFO', 'RECORD']);

/** Each duration field with the CTASK estimate that answers it. Recovery is the backout-and-restoration time. */
function readDurationAnswers(estimates: DurationEstimates): ReadonlyArray<{ fieldName: string; detail: string }> {
  const minuteAnswers = [
    { fieldName: 'Implementation Duration', minutes: estimates.implementationMinutes },
    { fieldName: 'Validation Duration', minutes: estimates.validationMinutes },
    { fieldName: 'Backout Duration', minutes: estimates.backoutMinutes },
    { fieldName: 'Recovery Time', minutes: estimates.backoutMinutes },
  ];
  return minuteAnswers
    .filter((answer) => answer.minutes.trim() !== '')
    .map((answer) => ({ fieldName: answer.fieldName, detail: `${answer.minutes} min (the CTASK estimates).` }));
}

/** The standing answer for one finding, or the finding as it was. */
function settleFinding(
  finding: RiskCheckFinding,
  standingAnswers: ReadonlyArray<{ fieldName: string; detail: string }>,
): RiskCheckFinding {
  if (!SETTLEABLE_STATUSES.has(finding.status)) {
    return finding;
  }
  const standingAnswer = standingAnswers.find((answer) => isSameName(finding.field, answer.fieldName));
  return standingAnswer ? { status: 'PASS', field: standingAnswer.fieldName, detail: standingAnswer.detail, fix: '' } : finding;
}

/**
 * The review with every field a team standard answers settled as PASS, and its verdict recounted. A review that
 * needs no settling is returned exactly as given.
 */
export function applyTeamStandards(
  reviewText: string,
  estimates: DurationEstimates,
  standards: readonly TeamStandard[] = readTeamStandards(),
  changeOwnerName = '',
): string {
  const standingAnswers = [
    ...readStandingAnswers(standards),
    ...readDurationAnswers(estimates),
    ...readChangeOwnerAnswer(changeOwnerName),
  ];
  const reviewFindings = parseRiskCheckReview(reviewText).findings;
  const settledFindings = reviewFindings.map((finding) => settleFinding(finding, standingAnswers));
  const wasAnySettled = settledFindings.some((finding, findingIndex) => finding !== reviewFindings[findingIndex]);
  return wasAnySettled ? renderReviewText(settledFindings) : reviewText;
}
