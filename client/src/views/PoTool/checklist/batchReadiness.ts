// batchReadiness.ts — Reviewing a whole JQL query's worth of Epics against Definition of Ready and Done.
//
// One Epic at a time is the wrong unit for the question a PO actually asks before a planning session: "which of
// these twenty Epics are ready, and what is missing from the ones that are not?". So this builds ONE prompt
// covering every Epic returned — split into parts only when the batch outgrows the prompt cap — and turns the
// reply into one document with a summary table at the top.
//
// Pure. The fetching lives elsewhere; everything here is text in, text out, which is what makes a twenty-Epic
// review testable without touching Jira.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { DEFINITION_LABELS, type ReadinessCriterion } from './dorCriteria.ts';
import {
  buildReadinessReport,
  describeDefinitionVerdict,
  formatReviewDate,
  STATUS_LABELS,
  type CriterionVerdict,
  type ReadinessReport,
} from './readinessReport.ts';
import type { EpicChecklistSource } from './checklistField.ts';
import { buildReportMarkup, escapeTableCell, type ReportFlavour, type ReportMarkup } from './reportMarkup.ts';

/** The discriminator a batch reply must echo. Distinct from the single-Epic one, so a reply cannot be crossed over. */
const BATCH_INGEST_KIND = 'epicReadinessBatch';

/**
 * How large one prompt may get before the batch is split.
 *
 * A secondary guard only. The binding constraint turned out to be the REPLY, not the prompt: a part holding six
 * Epics fits comfortably in any prompt and then asks for sixty-six verdicts of JSON, which an assistant cuts off
 * part way through. So parts are packed by how much answer they ask for, and this cap only catches the rare Epic
 * whose own text is enormous.
 */
export const MAX_CHARS_PER_PROMPT = 9000;

/**
 * How many verdicts one reply may be asked for.
 *
 * One verdict is one Epic judged against one criterion, and each carries two sentences of prose. Twenty-two — two
 * Epics against the team's eleven criteria — is a reply an assistant finishes rather than truncates.
 */
export const DEFAULT_MAX_VERDICTS_PER_PART = 22;

/** How much of one Epic's description a batch prompt carries. A batch trades depth per Epic for breadth. */
const MAX_DESCRIPTION_CHARS_PER_EPIC = 1500;

/** One Epic in the batch, with the children found for it. */
export interface BatchEpic {
  source: EpicChecklistSource;
  /** "KEY — status — summary" lines for the Epic's children, as evidence for scope and delivery criteria. */
  childSummaryLines: string[];
}

/** Trims one Epic's text so a single enormous Epic cannot crowd the rest of the batch out of its prompt. */
function readTrimmedText(text: string, maxChars: number): string {
  const trimmedText = text.trim();
  return trimmedText.length <= maxChars ? trimmedText : `${trimmedText.slice(0, maxChars)}… (truncated)`;
}

/** Writes one Epic as the prompt presents it. */
function buildEpicBlock(epic: BatchEpic): string {
  const { source } = epic;
  return [
    `### ${source.issueKey} (status: ${source.status || 'unknown'})`,
    `Summary: ${source.summary}`,
    `Description: ${readTrimmedText(source.description, MAX_DESCRIPTION_CHARS_PER_EPIC) || '(empty)'}`,
    `Acceptance criteria: ${readTrimmedText(source.acceptanceCriteria, MAX_DESCRIPTION_CHARS_PER_EPIC) || '(none recorded)'}`,
    epic.childSummaryLines.length > 0
      ? `Work underneath:\n${epic.childSummaryLines.join('\n')}`
      : 'Work underneath: (none found)',
  ].join('\n');
}

/** The instructions repeated in every part, so a part is a complete brief on its own. */
function buildPromptShell(criteria: readonly ReadinessCriterion[], partLabel: string, epicBlocks: string): string {
  const criteriaLines = (['dor', 'dod'] as const).flatMap((definition) => {
    const definitionCriteria = criteria.filter((criterion) => criterion.definition === definition);
    if (definitionCriteria.length === 0) {
      return [];
    }
    return [
      `${DEFINITION_LABELS[definition]}:`,
      ...definitionCriteria.map((criterion) => `  ${criterion.id} — [${criterion.section}] ${criterion.text}`),
      '',
    ];
  });

  return [
    'You are reviewing several Jira Epics against a team\'s Definition of Ready and Definition of Done.',
    'You are the sceptical reviewer in a planning session: find what is not yet written down, do not reassure.',
    partLabel === '' ? '' : partLabel,
    '',
    'Judge EVERY Epic below against EVERY criterion:',
    '',
    ...criteriaLines,
    'For each Epic and each criterion answer with one status:',
    '  "satisfied" — the Epic clearly meets it, and you can quote the words that show it.',
    '  "partial"   — something is written about it, but it is incomplete, vague, or unverifiable as written.',
    '  "missing"   — the Epic says nothing that meets it.',
    '',
    'Rules:',
    '  • "evidence" must quote or closely paraphrase words from THAT Epic. A criterion cannot be "satisfied"',
    '    without evidence, and evidence from one Epic never counts for another.',
    '  • "whatIsMissing" is the useful half of this review, so make it an instruction the Product Owner can act',
    '    on without asking you a follow-up question. Start it with a verb and name the specific thing to write:',
    '    "Name the two upstream systems this depends on", not "dependencies should be identified". Leave it',
    '    empty ONLY for a satisfied criterion.',
    '  • Judge only what is written here. An Epic\'s status, its age and the existence of children are not',
    '    evidence on their own.',
    '  • Answer every Epic in this part against every criterion. Use only the keys and ids given.',
    '  • Keep "evidence" and "whatIsMissing" under 25 words each. A long answer that gets cut off part way',
    '    through is worth less than a short one that finishes.',
    '',
    'Epics:',
    '',
    epicBlocks,
    '',
    'Reply with ONLY this JSON (every Epic in this part, keyed by its Jira key):',
    // The example quotes a criterion id that is actually in this prompt, so it cannot suggest one that is not.
    `{"kind":"${BATCH_INGEST_KIND}","items":[{"key":"DENP-1436","criterionId":"${criteria[0]?.id ?? 'criterion-id'}",`
      + '"status":"partial","evidence":"...","whatIsMissing":"..."}]}',
  ].filter((line) => line !== '').join('\n');
}

/**
 * Builds the prompts covering the whole batch — one when it fits, several when it does not.
 *
 * Every part repeats the criteria and the rules, because a part is handed to the assistant on its own and a part
 * that inherited its instructions from part one would be reviewed against nothing.
 */
export function buildBatchReadinessPrompts(
  epics: readonly BatchEpic[],
  criteria: readonly ReadinessCriterion[],
  /** How many verdicts one part may ask for. Lower it for an assistant that cuts long replies short. */
  maxVerdictsPerPart: number = DEFAULT_MAX_VERDICTS_PER_PART,
): string[] {
  if (epics.length === 0) {
    return [];
  }

  // How many Epics one reply can carry: the verdict budget divided by the criteria each Epic is judged against.
  // At least one, always — a team with more criteria than the budget still gets one Epic per part rather than none.
  const maxEpicsPerPart = Math.max(1, Math.floor(maxVerdictsPerPart / Math.max(1, criteria.length)));

  const epicBlocks = epics.map(buildEpicBlock);
  const shellLength = buildPromptShell(criteria, 'Part 99 of 99.', '').length;
  const groupedBlocks: string[][] = [];
  let currentGroup: string[] = [];
  let currentLength = shellLength;

  epicBlocks.forEach((epicBlock) => {
    const isOverEpicBudget = currentGroup.length >= maxEpicsPerPart;
    const isOverCharBudget = currentLength + epicBlock.length > MAX_CHARS_PER_PROMPT;
    if (currentGroup.length > 0 && (isOverEpicBudget || isOverCharBudget)) {
      groupedBlocks.push(currentGroup);
      currentGroup = [];
      currentLength = shellLength;
    }
    currentGroup.push(epicBlock);
    currentLength += epicBlock.length;
  });
  if (currentGroup.length > 0) {
    groupedBlocks.push(currentGroup);
  }

  return groupedBlocks.map((group, groupIndex) => buildPromptShell(
    criteria,
    groupedBlocks.length === 1 ? '' : `Part ${groupIndex + 1} of ${groupedBlocks.length}.`,
    group.join('\n\n'),
  ));
}

/** Verdicts read out of a batch reply, grouped by the Epic they belong to. */
export interface BatchIngestResult {
  verdictsByIssueKey: Record<string, CriterionVerdict[]>;
  errors: string[];
}

/** Coerces anything to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads the status, or null when it is not one of the three. */
function readStatus(value: unknown): CriterionVerdict['status'] | null {
  const statusText = readTrimmedString(value).toLowerCase();
  return (['satisfied', 'partial', 'missing'] as const).find((allowed) => allowed === statusText) ?? null;
}

/**
 * Reads one part's reply.
 *
 * The protections are the single-Epic ones plus the one a batch needs: a verdict for a key that was not in the
 * query is dropped. Evidence from the wrong Epic is the failure mode that matters here — twenty Epics reviewed at
 * once is exactly the situation where a plausible-sounding quote can be attached to the wrong one.
 */
export function parseBatchReadinessIngest(
  responseText: string,
  allowedIssueKeys: readonly string[],
  allowedCriterionIds: readonly string[],
): BatchIngestResult {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(responseText));
    if (typeof parsed !== 'object' || parsed === null) {
      return { verdictsByIssueKey: {}, errors: ['The assistant response was not valid JSON.'] };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { verdictsByIssueKey: {}, errors: ['No JSON object found in the assistant response.'] };
  }

  if (payload.kind !== BATCH_INGEST_KIND) {
    return { verdictsByIssueKey: {}, errors: [`Response kind "${String(payload.kind)}" is not ${BATCH_INGEST_KIND}.`] };
  }
  if (!Array.isArray(payload.items)) {
    return { verdictsByIssueKey: {}, errors: ['The "items" field is missing or is not a list.'] };
  }

  const allowedKeys = new Set(allowedIssueKeys.map((issueKey) => issueKey.toUpperCase()));
  const allowedCriteria = new Set(allowedCriterionIds);
  const verdictsByIssueKey: Record<string, CriterionVerdict[]> = {};
  const seenPairs = new Set<string>();
  const errors: string[] = [];

  payload.items.forEach((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      errors.push('An entry in "items" was not an object, so it was ignored.');
      return;
    }
    const candidateItem = candidate as Record<string, unknown>;
    const issueKey = readTrimmedString(candidateItem.key).toUpperCase();
    const criterionId = readTrimmedString(candidateItem.criterionId);

    if (!allowedKeys.has(issueKey)) {
      errors.push(`"${issueKey || '(no key)'}" is not one of the Epics in this review, so it was ignored.`);
      return;
    }
    if (!allowedCriteria.has(criterionId)) {
      errors.push(`"${criterionId || '(no id)'}" is not one of the criteria, so it was ignored.`);
      return;
    }
    const pairKey = `${issueKey}::${criterionId}`;
    if (seenPairs.has(pairKey)) {
      errors.push(`${issueKey} answered "${criterionId}" twice; only the first answer was kept.`);
      return;
    }
    seenPairs.add(pairKey);

    const evidence = readTrimmedString(candidateItem.evidence);
    const claimedStatus = readStatus(candidateItem.status);
    const isUnevidencedPass = claimedStatus === 'satisfied' && evidence === '';

    (verdictsByIssueKey[issueKey] ??= []).push({
      criterionId,
      status: isUnevidencedPass ? 'partial' : claimedStatus ?? 'missing',
      evidence,
      whatIsMissing: isUnevidencedPass
        ? 'Reported as satisfied but nothing in the Epic was quoted — confirm this yourself before relying on it.'
        : readTrimmedString(candidateItem.whatIsMissing),
    });
  });

  return { verdictsByIssueKey, errors };
}

/** The whole batch: one report per Epic, in the order the query returned them. */
export interface BatchReadinessReport {
  jql: string;
  reports: ReadinessReport[];
}

/** Builds a report per Epic from one set of batch verdicts. */
export function buildBatchReadinessReport(input: {
  jql: string;
  epics: readonly BatchEpic[];
  criteriaByIssueKey: Record<string, { criteria: ReadinessCriterion[]; source: 'issueChecklist' | 'standardTemplate' }>;
  verdictsByIssueKey: Record<string, CriterionVerdict[]>;
}): BatchReadinessReport {
  return {
    jql: input.jql,
    reports: input.epics.map((epic) => {
      const epicCriteria = input.criteriaByIssueKey[epic.source.issueKey];
      return buildReadinessReport({
        issueKey: epic.source.issueKey,
        issueSummary: epic.source.summary,
        criteria: epicCriteria?.criteria ?? [],
        verdicts: input.verdictsByIssueKey[epic.source.issueKey] ?? [],
        criteriaSource: epicCriteria?.source ?? 'standardTemplate',
      });
    }),
  };
}

/** One line of the summary table: how each Epic stands, at a glance. */
export interface BatchSummaryRow {
  issueKey: string;
  issueSummary: string;
  dorVerdict: string;
  dodVerdict: string;
  outstandingCount: number;
  isReviewed: boolean;
}

/**
 * A definition's state, said in words rather than packed into a fraction.
 *
 * "1/6 (1 unanswered)" made a reader work out for themselves how many criteria were actually a problem, and left
 * it ambiguous whether the unanswered one counted. Naming met, gaps and unanswered separately removes the sum.
 */
function summariseDefinition(report: ReadinessReport, definition: 'dor' | 'dod'): string {
  const totals = report.totals[definition];
  if (totals.total === 0) {
    return '—';
  }
  if (totals.unanswered === totals.total) {
    return 'not reviewed';
  }
  if (totals.satisfied === totals.total) {
    return `MET — all ${totals.total}`;
  }

  const gapCount = totals.partial + totals.missing;
  return [
    `${totals.satisfied} of ${totals.total} met`,
    gapCount > 0 ? `${gapCount} gap${gapCount === 1 ? '' : 's'}` : '',
    totals.unanswered > 0 ? `${totals.unanswered} unanswered` : '',
  ].filter((part) => part !== '').join(' · ');
}

/** The summary a PO reads before opening anything: which Epics are ready, and how far off the rest are. */
export function buildBatchSummary(batch: BatchReadinessReport): BatchSummaryRow[] {
  return batch.reports.map((report) => {
    const answeredRows = report.rows.filter((row) => row.verdict !== null);
    return {
      issueKey: report.issueKey,
      issueSummary: report.issueSummary,
      dorVerdict: summariseDefinition(report, 'dor'),
      dodVerdict: summariseDefinition(report, 'dod'),
      // An unanswered criterion counts as outstanding. It is certainly not met, and a count that quietly left it
      // out read as "nine outstanding" beside "one unanswered" and invited exactly the right question.
      outstandingCount: report.rows.filter((row) => !row.verdict || row.verdict.status !== 'satisfied').length,
      isReviewed: answeredRows.length > 0,
    };
  });
}

/** Writes one Epic's detail into the batch document, in the markup of wherever it is going. */
function formatEpicSection(report: ReadinessReport, markup: ReportMarkup): string[] {
  const lines = [markup.heading(2, `${report.issueKey} — ${report.issueSummary}`), ''];

  (['dor', 'dod'] as const).forEach((definition) => {
    const definitionRows = report.rows.filter((row) => row.criterion.definition === definition);
    if (definitionRows.length === 0) {
      return;
    }
    lines.push(markup.bold(describeDefinitionVerdict(report.totals[definition], definition)), '');
    definitionRows.forEach((row) => {
      if (!row.verdict) {
        lines.push(markup.bullet(1, `${row.criterion.text} — not answered.`));
        return;
      }
      lines.push(markup.bullet(1, `${STATUS_LABELS[row.verdict.status]}: ${row.criterion.text}`));
      if (row.verdict.whatIsMissing !== '') {
        lines.push(markup.bullet(2, `Still needed: ${row.verdict.whatIsMissing}`));
      }
      if (row.verdict.evidence !== '') {
        lines.push(markup.bullet(2, `What the Epic says: ${row.verdict.evidence}`));
      }
    });
    lines.push('');
  });

  return lines;
}

/**
 * Writes the whole batch as one document: the query, a summary table, then every Epic in detail.
 *
 * The table leads because that is how the document gets used — a PO scans it, picks the Epics that are not
 * ready, and reads only those sections.
 */
export function formatBatchReport(
  batch: BatchReadinessReport,
  flavour: ReportFlavour = 'markdown',
  /** When the review was run. Injected so the report is the same text every time a test asks for it. */
  reviewedAt: Date = new Date(),
): string {
  const markup = buildReportMarkup(flavour);
  const summaryRows = buildBatchSummary(batch);
  const headerCells = ['Epic', 'Summary', 'Definition of Ready', 'Definition of Done', 'Outstanding'];

  return markup.finalize([
    markup.heading(1, 'Readiness review'),
    '',
    `Reviewed ${formatReviewDate(reviewedAt)}.`,
    `Query: ${markup.code(batch.jql)}`,
    `Epics reviewed: ${summaryRows.filter((row) => row.isReviewed).length} of ${summaryRows.length}`,
    '',
    markup.tableHeader(headerCells),
    ...markup.tableSeparator(headerCells.length),
    ...summaryRows.map((row) => markup.tableRow([
      row.issueKey,
      escapeTableCell(row.issueSummary),
      row.dorVerdict,
      row.dodVerdict,
      String(row.outstandingCount),
    ])),
    '',
    ...batch.reports.flatMap((report) => formatEpicSection(report, markup)),
  ]);
}
