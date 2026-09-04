// releasePriorityRank.ts — Turning a release's issue list into a numbered priority order.
//
// The Jira Priority field is a driver, not the answer. An issue marked "Medium" that has sat for
// ninety days, or one whose Feature must reach Integration Test next week, may belong above a
// "High" raised yesterday. This module builds ONE prompt that lays every such signal beside every
// issue — priority, age, due date, status, and the linked Feature's own target dates — asks the
// assistant for a single ordering, and reads the reply back as an honest list: every issue exactly
// once, top of the list first, with anything the assistant skipped appended and MARKED as skipped.
//
// The output is a plan of Status Summary values — "01" for the most important item, counting up to
// the bottom of the list. Pure: no React, no I/O. The fetch and the write live in
// releasePriorityApply.ts, so everything that is easy to get subtly wrong is testable without Jira.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';

/** The envelope kind. A reply pasted from another AI surface is caught here rather than written. */
export const RELEASE_PRIORITY_REPLY_KIND = 'releasePriority';

/** Status Summary values are always at least two digits, so "01" sorts before "10" as text. */
const MINIMUM_RANK_DIGITS = 2;

/** Longest rationale the panel keeps per issue; the ordering matters, the essay does not. */
const MAX_RATIONALE_LENGTH = 240;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Everything the prompt says about one issue — read from Jira, never from the assistant. */
export interface ReleasePriorityPromptIssue {
  issueKey: string;
  summary: string;
  issueTypeName: string | null;
  statusName: string;
  priorityName: string | null;
  assigneeName: string | null;
  createdIso: string | null;
  /** Calendar days since the issue was created, so the assistant need not do date arithmetic. */
  ageDays: number | null;
  dueDateIso: string | null;
  /** What the field holds today, so a re-run shows the order it is about to replace. */
  currentStatusSummary: string | null;
  featureKey: string | null;
  featureSummary: string;
  featureTargetEndIso: string | null;
  featureDueDateIso: string | null;
}

export interface ReleasePriorityPromptInput {
  projectKey: string;
  releaseName: string;
  releaseDate: string | null;
  todayIso: string;
  issues: ReleasePriorityPromptIssue[];
}

/** One issue's place in the accepted order. Rank 1 is the top of the list. */
export interface ReleasePriorityRankedItem {
  issueKey: string;
  rank: number;
  rationale: string | null;
  /** False when the assistant left this issue out and it was appended in its original order. */
  wasRankedByAssistant: boolean;
}

/** The parsed reply, plus an honest account of what in it could not be used. */
export interface ReleasePriorityRankResult {
  rankedItems: ReleasePriorityRankedItem[];
  /** Keys the assistant mentioned that are not in this release — dropped, never written. */
  unknownKeys: string[];
  /** Keys in the release the assistant never mentioned — appended at the bottom, flagged. */
  unrankedKeys: string[];
}

/** One Status Summary write the panel is about to make. */
export interface StatusSummaryPlanEntry {
  issueKey: string;
  rank: number;
  value: string;
}

// ── Dates ──

/** Whole calendar days from one ISO date/time to another, or null when either cannot be read. */
export function calculateAgeDays(createdIso: string | null, todayIso: string): number | null {
  if (createdIso === null) return null;
  const createdTime = new Date(createdIso).getTime();
  const todayTime = new Date(todayIso).getTime();
  if (Number.isNaN(createdTime) || Number.isNaN(todayTime)) return null;
  return Math.max(0, Math.floor((todayTime - createdTime) / MILLISECONDS_PER_DAY));
}

// ── Prompt ──

function formatOptional(value: string | number | null, fallback = '(none)'): string {
  return value === null || value === '' ? fallback : String(value);
}

/** One issue block: identity, the priority driver, the age/date signals, then its Feature's dates. */
function buildIssueBlock(issue: ReleasePriorityPromptIssue): string {
  const featureLine = issue.featureKey === null
    ? '    feature: (none)'
    : `    feature: ${issue.featureKey} — ${issue.featureSummary || '(no summary)'}`
      + ` · feature target end: ${formatOptional(issue.featureTargetEndIso)}`
      + ` · feature due: ${formatOptional(issue.featureDueDateIso)}`;

  return [
    `- ${issue.issueKey} · ${issue.issueTypeName ?? 'Issue'} · ${issue.statusName} — ${issue.summary}`,
    `    priority: ${formatOptional(issue.priorityName, 'Not set')}`
      + ` · age: ${issue.ageDays === null ? 'unknown' : `${issue.ageDays} days`}`
      + ` · due: ${formatOptional(issue.dueDateIso)}`
      + ` · assignee: ${formatOptional(issue.assigneeName, 'Unassigned')}`
      + ` · current Status Summary: ${formatOptional(issue.currentStatusSummary)}`,
    featureLine,
  ].join('\n');
}

/**
 * Builds the one prompt that ranks a whole release.
 *
 * The rules spell out that Priority is a driver the assistant may overrule for a stated reason, so
 * the reply carries a rationale per issue and the person accepting it can see WHY a "Medium" sits
 * above a "High" before anything is written.
 */
export function buildReleasePriorityPrompt(input: ReleasePriorityPromptInput): string {
  const issueBlocks = input.issues.map(buildIssueBlock).join('\n');
  const issueKeyList = input.issues.map((issue) => issue.issueKey).join(', ');

  return `You are helping a release manager order every item in one software release from most to least important.

Project: ${input.projectKey}
Release: ${input.releaseName} · release date: ${formatOptional(input.releaseDate, '(not scheduled)')} · today: ${input.todayIso}

Rank all ${input.issues.length} items. Rank 1 is the most important item; the last rank is the least.

How to weigh the signals:
  - The Jira Priority field is the STARTING point, but it can be wrong. Overrule it when another signal says so, and say why.
  - Age: an item that has waited far longer than its peers moves up — old work is a promise the team has not kept.
  - Due dates: an item due before the release date, or already overdue, moves up.
  - The linked Feature's dates: an item whose Feature has an earlier target end or due date moves up; items of the same Feature usually sit together.
  - Status: work already delivered or in test can sit below work not yet started only if that unstarted work is more urgent — a release ships when its last item ships.
  - Issue type: a Defect blocking a Story or a Feature outranks the work it blocks.

Rules:
  - Use only the issue keys listed below. Never invent a key.
  - Every key appears exactly once. Do not skip any.
  - "rationale" is one short sentence naming the deciding signal, under ${MAX_RATIONALE_LENGTH} characters.

Items (${input.issues.length}):
${issueBlocks}

Issue keys you must rank: ${issueKeyList}

Reply with this JSON object and nothing else, items ordered from rank 1 upward:
{
  "kind": "${RELEASE_PRIORITY_REPLY_KIND}",
  "items": [
    { "issueKey": "<one of the keys above>", "rank": 1, "rationale": "<why it sits here>" }
  ]
}`;
}

// ── Parsing ──

/** Trims and caps a rationale; anything that is not a string reads as no rationale. */
function readRationale(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_RATIONALE_LENGTH ? `${trimmed.slice(0, MAX_RATIONALE_LENGTH)}…` : trimmed;
}

/** A rank the assistant wrote, as a number, or null when it wrote nothing usable. */
function readRank(rawValue: unknown): number | null {
  const parsed = typeof rawValue === 'number' ? rawValue : Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ReplyItem {
  issueKey: string;
  rank: number | null;
  rationale: string | null;
  /** Where the item sat in the reply, the tie-break when ranks are missing or repeated. */
  replyPosition: number;
}

/** Reads the raw items into a flat list, keeping only the first mention of each known key. */
function readReplyItems(rawItems: unknown[], knownKeysUpper: readonly string[]): {
  items: ReplyItem[];
  unknownKeys: string[];
} {
  const items: ReplyItem[] = [];
  const unknownKeys: string[] = [];
  const seenKeys = new Set<string>();

  rawItems.forEach((rawItem, replyPosition) => {
    if (typeof rawItem !== 'object' || rawItem === null) return;
    const item = rawItem as Record<string, unknown>;
    const issueKey = typeof item.issueKey === 'string' ? item.issueKey.trim().toUpperCase() : '';
    if (issueKey === '') return;
    if (!knownKeysUpper.includes(issueKey)) {
      if (!unknownKeys.includes(issueKey)) unknownKeys.push(issueKey);
      return;
    }
    if (seenKeys.has(issueKey)) return;
    seenKeys.add(issueKey);
    items.push({ issueKey, rank: readRank(item.rank), rationale: readRationale(item.rationale), replyPosition });
  });

  return { items, unknownKeys };
}

/** Rank first, reply order as the tie-break — so a reply with no ranks at all still orders cleanly. */
function compareReplyItems(leftItem: ReplyItem, rightItem: ReplyItem): number {
  const leftRank = leftItem.rank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = rightItem.rank ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return leftItem.replyPosition - rightItem.replyPosition;
}

/**
 * Parses the assistant's reply into a complete ordering of the release.
 *
 * Throws only for a wholly wrong reply — not JSON, or another surface's kind. Everything else
 * degrades honestly: an unknown key is dropped and reported, a duplicate keeps its first mention,
 * and a key the assistant forgot is appended at the bottom in its original order and flagged, so
 * the person accepting the list can see exactly which rows the assistant never judged.
 */
export function parseReleasePriorityReply(
  replyText: string,
  knownIssueKeys: readonly string[],
): ReleasePriorityRankResult {
  const parsedEnvelope = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsedEnvelope.kind !== RELEASE_PRIORITY_REPLY_KIND) {
    throw new Error(
      `Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${RELEASE_PRIORITY_REPLY_KIND}".`,
    );
  }

  const knownKeysUpper = knownIssueKeys.map((issueKey) => issueKey.toUpperCase());
  const rawItems = Array.isArray(parsedEnvelope.items) ? parsedEnvelope.items : [];
  const { items, unknownKeys } = readReplyItems(rawItems, knownKeysUpper);

  const rankedKeys = new Set(items.map((item) => item.issueKey));
  const unrankedKeys = knownKeysUpper.filter((issueKey) => !rankedKeys.has(issueKey));

  const orderedItems: ReleasePriorityRankedItem[] = [
    ...items.sort(compareReplyItems).map((item) => ({
      issueKey: item.issueKey,
      rank: 0,
      rationale: item.rationale,
      wasRankedByAssistant: true,
    })),
    ...unrankedKeys.map((issueKey) => ({ issueKey, rank: 0, rationale: null, wasRankedByAssistant: false })),
  ];

  // Re-number from 1 so a reply with gaps or repeats still yields 01, 02, 03 … with no holes.
  const rankedItems = orderedItems.map((item, index) => ({ ...item, rank: index + 1 }));

  return { rankedItems, unknownKeys, unrankedKeys };
}

// ── Status Summary values ──

/**
 * Formats one rank as the Status Summary text: zero-padded to at least two digits, and to more when
 * the release is long enough to need them, so "01" … "12" and "001" … "120" both sort as text.
 */
export function formatStatusSummaryValue(rank: number, totalCount: number): string {
  const digitCount = Math.max(MINIMUM_RANK_DIGITS, String(totalCount).length);
  return String(rank).padStart(digitCount, '0');
}

/** The full list of writes an accepted ranking produces, top of the list first. */
export function buildStatusSummaryPlan(rankedItems: readonly ReleasePriorityRankedItem[]): StatusSummaryPlanEntry[] {
  return rankedItems.map((item) => ({
    issueKey: item.issueKey,
    rank: item.rank,
    value: formatStatusSummaryValue(item.rank, rankedItems.length),
  }));
}
