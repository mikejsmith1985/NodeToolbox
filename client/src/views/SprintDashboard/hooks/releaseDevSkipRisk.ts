// releaseDevSkipRisk.ts — Builds the hidden AI Assist prompt that assesses the risk of skipping
// Dev-environment testing and promoting a release's tickets straight to Integration testing.
//
// This rides the same AI Assist exchange rails as the release-notes workflow, but asks a different
// question: for each ticket in the fix version, how safe is it to bypass Dev-env testing? The model
// weighs signals that live in the ticket — evidence of unit testing, whether the change is
// configuration-only, the issue type, and acceptance-criteria coverage — and returns a Markdown
// report the Release Tab renders read-only.

import type { JiraComment } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

// One prompt issue mirrors the fields we can mine for testing evidence. Comments are pre-normalized
// to plain "Author: text" lines because unit-test claims almost always live in the comment thread.
export interface ReleaseDevSkipRiskPromptIssue {
  issueKey: string;
  summary: string;
  statusName: string;
  issueTypeName: string | null;
  priorityName: string | null;
  description: unknown;
  acceptanceCriteria: unknown;
  comments: string[];
}

export interface ReleaseDevSkipRiskPromptInput {
  projectKey: string;
  releaseName: string;
  releaseDate: string | null;
  daysLeft: number | null;
  completionPercentage: number;
  doneCount: number;
  progressCount: number;
  todoCount: number;
  issues: ReleaseDevSkipRiskPromptIssue[];
}

// A ticket can accumulate dozens of comments; only the most recent handful carry the "did we test
// this?" signal, and each is capped so one long comment cannot dominate the prompt budget.
const MAX_COMMENTS_PER_ISSUE = 8;
const MAX_CHARS_PER_COMMENT = 500;

/**
 * Converts a Jira issue's raw comment array into concise, most-recent-first "Author: text" lines,
 * normalizing rich text and dropping empty comments. Used to feed testing evidence into the prompt.
 */
export function summarizeIssueCommentsForPrompt(comments: JiraComment[] | undefined): string[] {
  if (!comments || comments.length === 0) {
    return [];
  }

  const mostRecentComments = comments.slice(-MAX_COMMENTS_PER_ISSUE);
  const summarizedLines: string[] = [];
  for (const comment of mostRecentComments) {
    const authorName = comment.author?.displayName ?? 'Unknown';
    const commentText = normalizeRichTextToPlainText(comment.body);
    if (commentText.length === 0) {
      continue; // A comment with no readable text carries no testing signal.
    }
    const cappedText = commentText.length > MAX_CHARS_PER_COMMENT
      ? `${commentText.slice(0, MAX_CHARS_PER_COMMENT)}…`
      : commentText;
    summarizedLines.push(`${authorName}: ${cappedText}`);
  }
  return summarizedLines;
}

function formatReleaseDateLabel(releaseDate: string | null): string {
  return releaseDate ? releaseDate : '(not scheduled)';
}

/** Renders the block of context for a single ticket, including its comment thread. */
function buildPromptIssueSection(riskIssue: ReleaseDevSkipRiskPromptIssue): string {
  const descriptionText = normalizeRichTextToPlainText(riskIssue.description) || '(not provided)';
  const acceptanceCriteriaText = normalizeRichTextToPlainText(riskIssue.acceptanceCriteria) || '(not provided)';
  const commentsText = riskIssue.comments.length > 0
    ? riskIssue.comments.map((commentLine) => `  - ${commentLine}`).join('\n')
    : '  (no comments)';

  return [
    `Issue Key: ${riskIssue.issueKey}`,
    `Title: ${riskIssue.summary}`,
    `Status: ${riskIssue.statusName}`,
    `Issue Type: ${riskIssue.issueTypeName ?? 'Not set'}`,
    `Priority: ${riskIssue.priorityName ?? 'Not set'}`,
    `Description: ${descriptionText}`,
    `Acceptance Criteria: ${acceptanceCriteriaText}`,
    'Comments (most recent last):',
    commentsText,
  ].join('\n');
}

/**
 * Builds the AI Assist prompt for one release's dev-skip test-risk assessment. The prompt asks for a
 * Markdown report (summary + per-ticket table + overall recommendation) so Toolbox can render it
 * directly, and spells out the heuristics the requester cares about (unit-test evidence lowers risk;
 * configuration-only changes lower risk; untested code changes raise it).
 */
export function buildDevSkipRiskAssistPrompt(input: ReleaseDevSkipRiskPromptInput): string {
  const issuesSection = input.issues.length > 0
    ? input.issues.map((riskIssue) => buildPromptIssueSection(riskIssue)).join('\n\n')
    : '(no Jira issues linked to this release)';

  return [
    'You are a release manager assessing deployment risk for a software release.',
    'The team is considering SKIPPING testing in the Dev environment and promoting these tickets',
    'straight to Integration testing. For each ticket below, judge how risky that shortcut is.',
    '',
    'Weigh these signals from each ticket:',
    '- Evidence that developers unit tested their code (look in the description and comments for',
    '  phrases like "unit tested", "added tests", "coverage", "tests green"). Strong evidence LOWERS risk.',
    '- Whether the change is configuration-only or a data/DB value update with no application code',
    '  change. A pure configuration change is typically LOW risk to promote straight to Integration.',
    '- The issue type, priority, and how completely the acceptance criteria appear to be met.',
    '- Untested application-code changes, vague acceptance criteria, or high priority RAISE risk.',
    '',
    'Rate each ticket on a Low / Medium / High scale for the risk of skipping Dev-environment testing.',
    '',
    `Project Key: ${input.projectKey}`,
    `Release Name: ${input.releaseName}`,
    `Release Date: ${formatReleaseDateLabel(input.releaseDate)}`,
    `Release Readiness: ${input.completionPercentage}% complete (${input.doneCount} done, ${input.progressCount} in progress, ${input.todoCount} to do)`,
    '',
    'Tickets in this release:',
    issuesSection,
    '',
    'Respond in GitHub-flavored Markdown using ONLY headings (##), bold, bullet lists, and a pipe table.',
    'Do not wrap the whole response in a code fence. Use exactly this structure:',
    '',
    '## Dev-Skip Test Risk — <release name>',
    '',
    'A 2-3 sentence overall summary of whether skipping Dev-environment testing is advisable.',
    '',
    '| Ticket | Change Type | Test Evidence | Dev-Skip Risk | Rationale |',
    '| --- | --- | --- | --- | --- |',
    '| TICKET-KEY | Config-only / Code / Mixed | What testing evidence was found, or "None found" | Low / Medium / High | One concise sentence |',
    '',
    '## Recommendation',
    '',
    '- Overall go / no-go for skipping Dev-environment testing, and any High-risk tickets that must be tested first.',
    '',
    'Rules:',
    '- Include exactly one table row for every supplied Issue Key, keeping the key text exactly as provided.',
    '- Base Test Evidence only on what the ticket actually shows; write "None found" when there is no evidence.',
    '- Keep every cell to a single concise sentence.',
  ].join('\n');
}
