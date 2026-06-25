// releaseRovoNotes.ts — Builds and parses the hidden Rovo release-notes workflow payload.

import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

export interface ReleaseRovoPromptIssue {
  issueKey: string;
  summary: string;
  statusName: string;
  assigneeName: string | null;
  priorityName: string | null;
  issueTypeName: string | null;
  description: unknown;
  acceptanceCriteria: unknown;
}

export interface ReleaseRovoPromptInput {
  projectKey: string;
  releaseName: string;
  releaseDate: string | null;
  daysLeft: number | null;
  completionPercentage: number;
  doneCount: number;
  progressCount: number;
  todoCount: number;
  issues: ReleaseRovoPromptIssue[];
}

export interface ReleaseRovoTableRow {
  issueKey: string;
  title: string;
  releaseNote: string;
  customerImpact: string;
  technicalDetails: string;
  risks: string;
  validation: string;
}

export interface ReleaseRovoTableDocument {
  releaseName: string;
  releaseSummary: string;
  items: ReleaseRovoTableRow[];
}

// Matches a Markdown code fence with an optional language tag (```json or a bare ```),
// capturing whatever the assistant placed between the opening and closing fences.
const CODE_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

// The fixed suffix every release-notes report heading ends with.
const RELEASE_NOTES_HEADING_SUFFIX = 'Release Notes';

/**
 * Builds the heading shown at the top of a release-notes report (e.g. the copied image).
 * The heading identifies the report by team and release only — for example
 * "Transformers 06/23/2026 Release Notes", or "06/23/2026 Release Notes" when no team is set.
 * It deliberately carries no mention of how the notes were drafted.
 */
export function buildReleaseNotesHeading(teamName: string, fixVersionName: string): string {
  const identitySegments = [teamName.trim(), fixVersionName.trim()].filter((segment) => segment.length > 0);
  return [...identitySegments, RELEASE_NOTES_HEADING_SUFFIX].join(' ');
}

// Inline styles only — email clients (Outlook/Gmail) strip <style> blocks and class rules, and they
// ignore modern CSS colour functions, so every colour here is a plain hex value applied per element.
const HTML_WRAPPER_STYLE = 'font-family:Arial,Helvetica,sans-serif;color:#1f2328;';
const HTML_HEADING_STYLE = 'font-size:18px;font-weight:700;margin:0 0 8px;';
const HTML_SUMMARY_STYLE = 'font-size:13px;color:#57606a;margin:0 0 12px;';
const HTML_TABLE_STYLE = 'border-collapse:collapse;width:100%;font-size:13px;';
const HTML_HEADER_CELL_STYLE = 'text-align:left;background:#f0f3f6;border:1px solid #d0d7de;padding:6px 8px;font-weight:600;';
const HTML_BODY_CELL_STYLE = 'border:1px solid #d0d7de;padding:6px 8px;vertical-align:top;';

// The report columns, in display order, mirroring the on-screen release-notes table.
const RELEASE_NOTES_HTML_COLUMN_LABELS = [
  'Release Item', 'Release Note', 'Customer Impact', 'Technical Details', 'Risks', 'Validation',
];

/** Escapes the characters that would otherwise break out of HTML text content or attributes. */
function escapeHtml(rawText: string): string {
  return rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds a self-contained, inline-styled HTML table for the release notes. This is placed on the
 * clipboard alongside the image so email clients paste a readable, reflowable native table instead
 * of a fixed-width screenshot. The heading carries the team/release identity only — no tooling wording.
 */
export function buildReleaseNotesHtml(heading: string, releaseDocument: ReleaseRovoTableDocument): string {
  const headerCells = RELEASE_NOTES_HTML_COLUMN_LABELS
    .map((columnLabel) => `<th style="${HTML_HEADER_CELL_STYLE}">${escapeHtml(columnLabel)}</th>`)
    .join('');

  const bodyRows = releaseDocument.items.map((releaseRow) => {
    // The first column pairs the Jira key (bold) with the plain-language title.
    const releaseItemCell = `<strong>${escapeHtml(releaseRow.issueKey)}</strong><br/>${escapeHtml(releaseRow.title)}`;
    const cellContents = [
      releaseItemCell,
      escapeHtml(releaseRow.releaseNote),
      escapeHtml(releaseRow.customerImpact),
      escapeHtml(releaseRow.technicalDetails),
      escapeHtml(releaseRow.risks),
      escapeHtml(releaseRow.validation),
    ];
    return `<tr>${cellContents.map((cellHtml) => `<td style="${HTML_BODY_CELL_STYLE}">${cellHtml}</td>`).join('')}</tr>`;
  }).join('');

  return [
    `<div style="${HTML_WRAPPER_STYLE}">`,
    `<h2 style="${HTML_HEADING_STYLE}">${escapeHtml(heading)}</h2>`,
    `<p style="${HTML_SUMMARY_STYLE}">${escapeHtml(releaseDocument.releaseSummary)}</p>`,
    `<table style="${HTML_TABLE_STYLE}"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`,
    '</div>',
  ].join('');
}

function formatReleaseDateLabel(releaseDate: string | null): string {
  return releaseDate ? releaseDate : '(not scheduled)';
}

function formatReleaseCountdownLabel(daysLeft: number | null): string {
  if (daysLeft === null) {
    return 'No release date is set.';
  }
  if (daysLeft < 0) {
    return `This release is ${Math.abs(daysLeft)} day(s) overdue.`;
  }
  if (daysLeft === 0) {
    return 'This release is due today.';
  }
  return `${daysLeft} day(s) remain until release.`;
}

function buildPromptIssueSection(releaseIssue: ReleaseRovoPromptIssue): string {
  const descriptionText = normalizeRichTextToPlainText(releaseIssue.description) || '(not provided)';
  const acceptanceCriteriaText = normalizeRichTextToPlainText(releaseIssue.acceptanceCriteria) || '(not provided)';
  const assigneeLabel = releaseIssue.assigneeName ?? 'Unassigned';
  const priorityLabel = releaseIssue.priorityName ?? 'Not set';
  const issueTypeLabel = releaseIssue.issueTypeName ?? 'Not set';

  return [
    `Issue Key: ${releaseIssue.issueKey}`,
    `Title: ${releaseIssue.summary}`,
    `Status: ${releaseIssue.statusName}`,
    `Assignee: ${assigneeLabel}`,
    `Priority: ${priorityLabel}`,
    `Issue Type: ${issueTypeLabel}`,
    `Description: ${descriptionText}`,
    `Acceptance Criteria: ${acceptanceCriteriaText}`,
  ].join('\n');
}

/**
 * Builds the copy-paste Rovo prompt for one Team Dashboard release.
 * The prompt requires a strict JSON response so Toolbox can render a release-notes table reliably.
 */
export function buildReleaseRovoPrompt(input: ReleaseRovoPromptInput): string {
  const issuesSection = input.issues.length > 0
    ? input.issues.map((releaseIssue) => buildPromptIssueSection(releaseIssue)).join('\n\n')
    : '(no Jira issues linked to this release)';

  return [
    'You are helping write software release notes for a Team Dashboard release in NodeToolbox.',
    'Use the release context and Jira issue details below to draft concise, customer-readable release notes.',
    'Respond ONLY with valid JSON. Do not wrap the response in markdown commentary.',
    'Output the JSON object only. Do not add any text before or after the JSON.',
    'Do not place the JSON inside a markdown code fence and do not include a greeting or sign-off.',
    '',
    `Project Key: ${input.projectKey}`,
    `Release Name: ${input.releaseName}`,
    `Release Date: ${formatReleaseDateLabel(input.releaseDate)}`,
    `Release Readiness: ${input.completionPercentage}% complete (${input.doneCount} done, ${input.progressCount} in progress, ${input.todoCount} to do)`,
    `Countdown: ${formatReleaseCountdownLabel(input.daysLeft)}`,
    '',
    'Jira release items:',
    issuesSection,
    '',
    'Return EXACTLY this JSON shape:',
    '{',
    '  "releaseName": "string",',
    '  "releaseSummary": "2-4 sentence overview of what this release delivers",',
    '  "items": [',
    '    {',
    '      "issueKey": "Jira key from the supplied list",',
    '      "title": "Plain-language title for this release item",',
    '      "releaseNote": "What changed in one concise sentence",',
    '      "customerImpact": "Why users or stakeholders care",',
    '      "technicalDetails": "Key implementation or rollout detail",',
    '      "risks": "Known risk, dependency, or follow-up, or \\"None.\\"",',
    '      "validation": "How this item was validated or will be validated"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Include one item for every supplied Jira issue key.',
    '- Keep issueKey values exactly as provided.',
    '- Use complete sentences.',
    '- If a risk is negligible, say "None." rather than leaving it blank.',
    '- If validation is unknown, say "Validation details pending."',
  ].join('\n');
}

/**
 * Pulls the JSON object out of a raw assistant reply.
 *
 * Rovo returned clean JSON, but Copilot and other assistants routinely wrap the
 * payload in chatter — a greeting before it, a "let me know if you need changes"
 * after it, or a Markdown code fence around it. This helper recovers the JSON in
 * all of those shapes so a stray sentence no longer breaks the release-notes import:
 *   1. If a code fence is present, work with its inner contents.
 *   2. Narrow to the outermost { ... } so any prose outside the object is discarded.
 */
function extractJsonPayload(responseText: string): string {
  const codeFenceMatch = responseText.match(CODE_FENCE_PATTERN);
  const candidatePayload = (codeFenceMatch?.[1] ?? responseText).trim();

  // Drop any conversational text surrounding the object by keeping only the span
  // from the first opening brace to the last closing brace.
  const firstBraceIndex = candidatePayload.indexOf('{');
  const lastBraceIndex = candidatePayload.lastIndexOf('}');
  if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    return candidatePayload.slice(firstBraceIndex, lastBraceIndex + 1).trim();
  }

  return candidatePayload;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Rovo response is missing ${fieldName}.`);
  }
  return value.trim();
}

function readReleaseRow(value: unknown, rowIndex: number): ReleaseRovoTableRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Rovo response item ${rowIndex + 1} is not a valid object.`);
  }

  const rowRecord = value as Record<string, unknown>;
  return {
    issueKey: readRequiredString(rowRecord.issueKey, `items[${rowIndex}].issueKey`),
    title: readRequiredString(rowRecord.title, `items[${rowIndex}].title`),
    releaseNote: readRequiredString(rowRecord.releaseNote, `items[${rowIndex}].releaseNote`),
    customerImpact: readRequiredString(rowRecord.customerImpact, `items[${rowIndex}].customerImpact`),
    technicalDetails: readRequiredString(rowRecord.technicalDetails, `items[${rowIndex}].technicalDetails`),
    risks: readRequiredString(rowRecord.risks, `items[${rowIndex}].risks`),
    validation: readRequiredString(rowRecord.validation, `items[${rowIndex}].validation`),
  };
}

/**
 * Parses the pasted Rovo response into the structured release-notes document shown in Toolbox.
 * Accepts either raw JSON or a fenced ```json block copied from chat.
 */
export function parseReleaseRovoResponse(responseText: string): ReleaseRovoTableDocument {
  const payloadText = extractJsonPayload(responseText);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    throw new Error('Rovo response is not valid JSON.');
  }

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    throw new Error('Rovo response must be a JSON object.');
  }

  const payloadRecord = parsedPayload as Record<string, unknown>;
  if (!Array.isArray(payloadRecord.items)) {
    throw new Error('Rovo response must include an items array.');
  }

  return {
    releaseName: readRequiredString(payloadRecord.releaseName, 'releaseName'),
    releaseSummary: readRequiredString(payloadRecord.releaseSummary, 'releaseSummary'),
    items: payloadRecord.items.map((item, rowIndex) => readReleaseRow(item, rowIndex)),
  };
}
