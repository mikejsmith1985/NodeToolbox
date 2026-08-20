// skippedEmailReport.ts — Making a skipped email answerable instead of merely counted.
//
// The intake skips an email it cannot classify, or one carrying no Jira key, and records the file
// name and a one-word reason. That is enough to know something was skipped and nothing at all to
// know whether it SHOULD have been. The consequence is that every question about what actually
// arrives — does a review-request email name the branch? does any email carry a Jira key? — has had
// to be answered by asking a person to open one and read it (GH #375).
//
// This captures the signals that decide the question, then GROUPS them. Two hundred rows is a list;
// five shapes with counts, and one real example each, is an answer. The grouping is what makes the
// report worth reading: emails of one kind arrive in bulk, and a report that reprints every one of
// them hides its own conclusion.

import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

/** How much body to keep. Enough to recognise the kind of email, not enough to store the content. */
const BODY_EXCERPT_LENGTH = 400;

/** How much of the body decides that two emails are "the same shape". */
const SHAPE_SIGNATURE_LENGTH = 60;

/** Line break, built rather than written so no escape sequence has to survive a copy into a file. */
const NEWLINE = String.fromCharCode(10);

/** Everything about one skipped email that bears on whether skipping it was right. */
export interface SkippedEmailRecord {
  fileName: string;
  /** Why the intake passed it over: unclassified, no-jira-key, project-filtered. */
  reason: string;
  subject: string;
  /** The X-GitHub-Reason header, which names why GitHub sent it. */
  reasonHeader: string | null;
  repo: string | null;
  prNumber: number | null;
  jiraKey: string | null;
  branch: string | null;
  mergedIntoBranch: string | null;
  eventType: string;
  matchedRuleId: string | null;
  bodyExcerpt: string;
}

/** One kind of skipped email, however many of them arrived. */
export interface SkippedEmailShape {
  reason: string;
  eventType: string;
  matchedRuleId: string | null;
  reasonHeader: string | null;
  emailCount: number;
  /** True when at least one email of this shape carried it — so the answer is not wrongly "never". */
  hasEverCarriedJiraKey: boolean;
  hasEverCarriedBranch: boolean;
  hasEverCarriedPrNumber: boolean;
  /** A real, unedited member of the group, so the shape can be inspected rather than imagined. */
  exampleRecord: SkippedEmailRecord;
}

/** The parsed-event fields a record borrows. Loose, so the server engine can pass its own shape. */
export interface SkippedEmailEventFacts {
  repo: string | null;
  prNumber: number | null;
  jiraKey: string | null;
  branch: string | null;
  mergedIntoBranch: string | null;
  eventType: string;
  matchedRuleId: string | null;
}

/**
 * Builds one record from a skipped email.
 *
 * The body is normalised to plain text first: a corporate mail gateway wraps the whole message in
 * HTML, and an excerpt of raw markup describes the gateway rather than the email.
 */
export function buildSkippedEmailRecord(input: {
  fileName: string;
  reason: string;
  subject: string;
  reasonHeader: string | null;
  bodyText: string;
  event: SkippedEmailEventFacts;
}): SkippedEmailRecord {
  return {
    fileName: input.fileName,
    reason: input.reason,
    subject: input.subject,
    reasonHeader: input.reasonHeader,
    repo: input.event.repo,
    prNumber: input.event.prNumber,
    jiraKey: input.event.jiraKey,
    branch: input.event.branch,
    mergedIntoBranch: input.event.mergedIntoBranch,
    eventType: input.event.eventType,
    matchedRuleId: input.event.matchedRuleId,
    bodyExcerpt: normalizeRichTextToPlainText(input.bodyText).slice(0, BODY_EXCERPT_LENGTH),
  };
}

/**
 * What makes two skipped emails "the same".
 *
 * The opening of the body carries the sentence that identifies the kind ("approved this pull
 * request", "Merged #N into rel"), so a short prefix with the numbers removed groups a hundred
 * merges together while keeping an approval separate. Numbers are stripped precisely because they
 * are what differs between two emails of the same kind.
 */
function readShapeSignature(record: SkippedEmailRecord): string {
  const bodyOpening = record.bodyExcerpt.slice(0, SHAPE_SIGNATURE_LENGTH).replace(/[0-9]+/g, '#');
  return [
    record.reason,
    record.eventType,
    record.matchedRuleId ?? '-',
    record.reasonHeader ?? '-',
    bodyOpening,
  ].join('|');
}

/**
 * Groups the records into shapes, commonest first.
 *
 * The `hasEverCarried*` flags are ORs across the whole group rather than the example's own values:
 * the question being asked is whether this KIND of email can ever supply an issue key or a branch,
 * and one example that happens to lack it would answer "no" for a group where half of them have it.
 */
export function summariseSkippedEmails(records: readonly SkippedEmailRecord[]): SkippedEmailShape[] {
  const shapesBySignature = new Map<string, SkippedEmailShape>();

  for (const record of records) {
    const signature = readShapeSignature(record);
    const existingShape = shapesBySignature.get(signature);
    if (!existingShape) {
      shapesBySignature.set(signature, {
        reason: record.reason,
        eventType: record.eventType,
        matchedRuleId: record.matchedRuleId,
        reasonHeader: record.reasonHeader,
        emailCount: 1,
        hasEverCarriedJiraKey: record.jiraKey !== null,
        hasEverCarriedBranch: record.branch !== null,
        hasEverCarriedPrNumber: record.prNumber !== null,
        exampleRecord: record,
      });
      continue;
    }
    existingShape.emailCount += 1;
    existingShape.hasEverCarriedJiraKey = existingShape.hasEverCarriedJiraKey || record.jiraKey !== null;
    existingShape.hasEverCarriedBranch = existingShape.hasEverCarriedBranch || record.branch !== null;
    existingShape.hasEverCarriedPrNumber = existingShape.hasEverCarriedPrNumber || record.prNumber !== null;
  }

  return [...shapesBySignature.values()].sort((first, second) => second.emailCount - first.emailCount);
}

/** Renders one shape as the block a reviewer actually reads. */
function formatShapeBlock(shape: SkippedEmailShape, shapeIndex: number): string {
  const carriedSignals = [
    shape.hasEverCarriedJiraKey ? 'Jira key' : '',
    shape.hasEverCarriedBranch ? 'branch' : '',
    shape.hasEverCarriedPrNumber ? 'PR number' : '',
  ].filter((carriedSignal) => carriedSignal !== '');

  const ruleNote = shape.matchedRuleId ? '(rule ' + shape.matchedRuleId + ')' : '(no rule matched)';

  return [
    (shapeIndex + 1) + '. ' + shape.emailCount + ' email(s) — skipped as "' + shape.reason + '"',
    '     classified as: ' + shape.eventType + ' ' + ruleNote,
    '     GitHub reason header: ' + (shape.reasonHeader ?? '(none)'),
    // The load-bearing line: whether this kind of email can identify the work at all.
    '     ever carries: ' + (carriedSignals.length > 0 ? carriedSignals.join(', ') : 'NOTHING that identifies an issue'),
    '     example subject: ' + shape.exampleRecord.subject,
    '     example body:    ' + shape.exampleRecord.bodyExcerpt,
  ].join(NEWLINE);
}

/**
 * The whole report, as text a person can read and paste.
 *
 * Every shape is listed, never a top-N: a rare shape is often the interesting one, and a report that
 * silently drops the tail reads exactly like one that had no tail.
 */
export function formatSkippedEmailReport(records: readonly SkippedEmailRecord[]): string {
  if (records.length === 0) {
    return 'No skipped emails recorded — every email in the runs held was classified and acted on.';
  }

  const shapes = summariseSkippedEmails(records);
  return [
    records.length + ' skipped email(s), in ' + shapes.length + ' distinct shape(s):',
    '',
    ...shapes.map(formatShapeBlock),
  ].join(NEWLINE);
}
