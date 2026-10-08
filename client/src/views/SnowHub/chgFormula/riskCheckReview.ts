// riskCheckReview.ts — Reads a pasted risk-check review into findings a person can scan (GH #395).
//
// The review comes back as one line per Formula Card field ("GAP | Blast Radius — … — Fix: …"). Shown as raw
// text, fifty long lines run off the screen and the few that matter are buried among the passes. Reading
// the lines into findings lets the Results step lead with the verdict and the gaps. Assistants decorate
// their replies (bullets, bold), so the reading is tolerant — and any line it cannot read is kept as a
// note, never dropped.

import { restoreMarkerLineBreaks, stripCodeFences } from './assistantReplyText.ts';
import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from './formulaCard.ts';

/**
 * PASS / GAP / N/A answer a card field; YES / NO answer a quality-gate question. INFO is a fact only the
 * owner has (a name, a time, a test result — and every [CONFIRM: …]); RECORD is a record field to set in the
 * change form. Neither is something an AI rewrite of the text can close, so neither is a gap.
 */
export type RiskCheckFindingStatus = 'PASS' | 'GAP' | 'N/A' | 'YES' | 'NO' | 'INFO' | 'RECORD';

/** One line of the review: which field or question, and what the reviewer found. */
export interface RiskCheckFinding {
  status: RiskCheckFindingStatus;
  field: string;
  detail: string;
  fix: string;
}

/** The whole review, read. */
export interface RiskCheckReview {
  /** The text after "VERDICT:", or null when the reply gave none. */
  verdict: string | null;
  isReady: boolean;
  findings: RiskCheckFinding[];
  /** Lines that are neither a finding nor the verdict, kept so nothing the reviewer wrote is lost. */
  unparsedLines: string[];
}

/** How many [CONFIRM: …] placeholders one drafted field still holds. */
export interface ConfirmPlaceholderCount {
  fieldKey: ChgTextFieldKey;
  fieldLabel: string;
  placeholderCount: number;
}

// What begins each review line. Copying can flatten the review into one paragraph, so these are put back
// at line starts before reading.
const REVIEW_LINE_MARKERS: readonly string[] = ['PASS', 'GAP', 'N/A', 'YES', 'NO', 'NEEDS INFO', 'INFO', 'RECORD', 'VERDICT'];

// A finding line: its status, then a "|" or ":" separator, then the rest.
const FINDING_LINE_PATTERN = /^(PASS|GAP|N\/A|NA|YES|NEEDS INFO|INFO|RECORD|NO)\s*[|:]\s*(.+)$/i;
const VERDICT_LINE_PATTERN = /^VERDICT\s*:\s*(.+)$/i;
// The "— Fix: …" tail of a gap line; any dash style the assistant used.
const FIX_SEPARATOR_PATTERN = /\s+[—–-]+\s*Fix\s*:\s*/i;
// The field / detail separator: a spaced dash of any kind.
const DETAIL_SEPARATOR_PATTERN = /\s+[—–-]+\s+/;
// Leading list and emphasis markup assistants put before a line.
const LEADING_MARKUP_PATTERN = /^[\s>*•#_`-]+/;
const CONFIRM_PLACEHOLDER_PATTERN = /\[CONFIRM:[^\]]*\]/gi;

/** A review line with its list bullets and bold / italic markers taken off. */
function stripLineMarkup(rawLine: string): string {
  return rawLine.replace(LEADING_MARKUP_PATTERN, '').replace(/\*\*|__/g, '').trim();
}

/** "NA" and "n/a" are the same answer as "N/A"; "NEEDS INFO" is the same answer as "INFO". */
function normaliseStatus(rawStatus: string): RiskCheckFindingStatus {
  const upperStatus = rawStatus.toUpperCase();
  if (upperStatus === 'NA') return 'N/A';
  if (upperStatus === 'NEEDS INFO') return 'INFO';
  return upperStatus as RiskCheckFindingStatus;
}

/** Splits "<field> — <detail> — Fix: <fix>" into its three parts; missing parts come back empty. */
function readFindingBody(findingBody: string): Pick<RiskCheckFinding, 'field' | 'detail' | 'fix'> {
  const [beforeFix, ...fixParts] = findingBody.split(FIX_SEPARATOR_PATTERN);
  const [field, ...detailParts] = beforeFix.split(DETAIL_SEPARATOR_PATTERN);
  return {
    field: field.trim(),
    detail: detailParts.join(' — ').trim(),
    fix: fixParts.join(' ').trim(),
  };
}

/** Reads a pasted review — the part before any corrections — into its verdict, findings and notes. */
export function parseRiskCheckReview(reviewText: string): RiskCheckReview {
  const review: RiskCheckReview = { verdict: null, isReady: false, findings: [], unparsedLines: [] };
  const restoredReview = restoreMarkerLineBreaks(stripCodeFences(reviewText), REVIEW_LINE_MARKERS);
  for (const rawLine of restoredReview.split(/\r?\n/)) {
    const line = stripLineMarkup(rawLine);
    if (line === '') {
      continue;
    }
    const verdictMatch = VERDICT_LINE_PATTERN.exec(line);
    if (verdictMatch) {
      review.verdict = verdictMatch[1].trim();
      continue;
    }
    const findingMatch = FINDING_LINE_PATTERN.exec(line);
    if (findingMatch) {
      review.findings.push({ status: normaliseStatus(findingMatch[1]), ...readFindingBody(findingMatch[2]) });
      continue;
    }
    review.unparsedLines.push(line);
  }
  review.isReady = review.verdict !== null && /READY FOR APPROVAL/i.test(review.verdict) && !/NOT READY/i.test(review.verdict);
  return review;
}

/**
 * The drafted fields that still hold [CONFIRM: …] placeholders, and how many each. These are the facts only
 * a person can supply, so the Results step names where they are.
 */
export function countConfirmPlaceholders(fieldValues: Readonly<Record<ChgTextFieldKey, string>>): ConfirmPlaceholderCount[] {
  return (Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[])
    .map((fieldKey) => ({
      fieldKey,
      fieldLabel: CHG_TEXT_FIELD_LABELS[fieldKey],
      placeholderCount: (fieldValues[fieldKey] ?? '').match(CONFIRM_PLACEHOLDER_PATTERN)?.length ?? 0,
    }))
    .filter((count) => count.placeholderCount > 0);
}
