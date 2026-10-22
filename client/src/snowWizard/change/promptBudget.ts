// promptBudget.ts — Keeps a Wizard prompt inside what an AI chat box accepts (pure): when the Jira issue details would push
// it over, each issue's details are cut evenly — the longest first — and each cut says so and where the rest is.
//
// Owner, GH #475: the AI Assist prompt came to 134,856 characters and Copilot refused it ("Character limit exceeded",
// 128,000). The Jira details are the only part that grows with the change, so they are the part that gives way; the
// rules, the record facts and the reply format are never cut.

import type { JiraIssue } from '../../types/jira.ts';
import { buildIssueDetailText } from '../../views/SnowHub/hooks/useAiAssist.ts';

/** The most an AI chat box takes in one message (Copilot's limit, the assistant the owner's team uses). */
export const ASSISTANT_PROMPT_CHARACTER_LIMIT = 128_000;
/** What a Wizard prompt is fitted to: under the limit, with room for a line the user adds when they paste it. */
export const PROMPT_CHARACTER_BUDGET = 120_000;
// The least each issue keeps, so its key, summary and the start of its description always reach the assistant.
const MINIMUM_ISSUE_CHARACTERS = 400;
const ISSUE_SEPARATOR = '\n\n';

/** Issue details that fit, and which issues were cut to make them fit. */
export interface FittedIssueDetails {
  text: string;
  trimmedIssueKeys: string[];
}

/** A prompt that fits, and which issues' details were cut to make it fit. */
export interface FittedPrompt {
  promptText: string;
  trimmedIssueKeys: string[];
}

/** The marker closing a cut issue, so the assistant knows the text stops early and where the rest lives. */
function buildCutMarker(issueKey: string): string {
  return ` … [cut to fit the AI's character limit — the rest is on ${issueKey} in Jira]`;
}

/** The total length when every issue block is held to at most `blockCap` characters (its cut marker included). */
function measureCappedTotal(blocks: readonly { text: string; marker: string }[], blockCap: number): number {
  const blockLengths = blocks.map(({ text, marker }) => (text.length <= blockCap ? text.length : Math.max(0, blockCap - marker.length) + marker.length));
  return blockLengths.reduce((total, blockLength) => total + blockLength, 0) + ISSUE_SEPARATOR.length * Math.max(0, blocks.length - 1);
}

/** The largest per-issue cap whose total fits the budget, never below the minimum each issue keeps. */
function findBlockCap(blocks: readonly { text: string; marker: string }[], characterBudget: number): number {
  let lowestCap = MINIMUM_ISSUE_CHARACTERS;
  let highestCap = Math.max(...blocks.map(({ text }) => text.length));
  while (lowestCap < highestCap) {
    const middleCap = Math.ceil((lowestCap + highestCap) / 2);
    if (measureCappedTotal(blocks, middleCap) <= characterBudget) lowestCap = middleCap;
    else highestCap = middleCap - 1;
  }
  return lowestCap;
}

/**
 * The issues' details (as Toolbox's prompts write them) within a character budget. Short issues stay whole; the long
 * ones are all cut to the same length, so no single issue is starved to keep another whole.
 */
export function buildIssueDetailTextWithin(issues: readonly JiraIssue[], characterBudget: number): FittedIssueDetails {
  const fullText = buildIssueDetailText([...issues]);
  if (issues.length === 0 || fullText.length <= characterBudget) return { text: fullText, trimmedIssueKeys: [] };
  const blocks = issues.map((issue) => ({ issueKey: issue.key, text: buildIssueDetailText([issue]), marker: buildCutMarker(issue.key) }));
  const blockCap = findBlockCap(blocks, characterBudget);
  const trimmedIssueKeys = blocks.filter(({ text }) => text.length > blockCap).map(({ issueKey }) => issueKey);
  const text = blocks
    .map(({ text: blockText, marker }) => (blockText.length <= blockCap ? blockText : `${blockText.slice(0, Math.max(0, blockCap - marker.length)).trimEnd()}${marker}`))
    .join(ISSUE_SEPARATOR);
  return { text, trimmedIssueKeys };
}

/**
 * A prompt built around the issues' details, fitted to the budget: built once in full, and only when that is too long,
 * built again with the details cut by exactly the overflow. `buildPrompt` must place the details text once.
 */
export function fitPromptToBudget(
  issues: readonly JiraIssue[],
  buildPrompt: (issueDetailText: string) => string,
  characterBudget = PROMPT_CHARACTER_BUDGET,
): FittedPrompt {
  const fullDetailText = buildIssueDetailText([...issues]);
  const fullPrompt = buildPrompt(fullDetailText);
  if (issues.length === 0 || fullPrompt.length <= characterBudget) return { promptText: fullPrompt, trimmedIssueKeys: [] };
  const fixedLength = fullPrompt.length - fullDetailText.length;
  const fitted = buildIssueDetailTextWithin(issues, Math.max(0, characterBudget - fixedLength));
  return { promptText: buildPrompt(fitted.text), trimmedIssueKeys: fitted.trimmedIssueKeys };
}

/** "⚠️ This prompt is 134,856 characters…" when a prompt is still over the chat box's limit, else ''. */
export function describePromptOverLimit(promptText: string): string {
  if (promptText.length <= ASSISTANT_PROMPT_CHARACTER_LIMIT) return '';
  return `⚠️ This prompt is ${promptText.length.toLocaleString('en-US')} characters — more than the `
    + `${ASSISTANT_PROMPT_CHARACTER_LIMIT.toLocaleString('en-US')} an AI chat box takes. Choose fewer Jira issues for this change, or shorten the task instructions.`;
}
