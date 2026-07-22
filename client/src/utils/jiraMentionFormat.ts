// jiraMentionFormat.ts — The single vocabulary for Jira @-mentions: how to read one, how to write one.
//
// A Jira comment stores a mention as a machine identifier ("[~accountid:557058:ab-12]" or "[~jsmith]"),
// never as a person's name. This module is the one place that knows those forms, and it owns BOTH
// directions — turning a stored body into readable runs, and turning a picked person into a token to
// store. Because the same table drives both, reading and writing can never drift apart (spec NFR-002);
// that property is proved by the round-trip test in jiraMentionFormat.test.ts.
//
// Deliberately NOT handled here: rendering (see CommentBody.tsx) and name lookup (see
// mentionDirectoryStore.ts). This module is pure and synchronous — it never triggers a request.

import type { FeatureReviewUserCandidate } from '../views/SprintDashboard/featureReviewFixes.ts';

/** Which identifier form the connected Jira instance uses. Derived from data, never configured. */
export type MentionFlavour = 'accountId' | 'name' | 'key';

/** One mention exactly as it is stored in (or will be written to) a comment body. */
export interface MentionToken {
  flavour: MentionFlavour;
  /** The identifier value with no flavour prefix, e.g. '557058:ab-12' or 'jsmith'. */
  identifier: string;
  /** The literal text as it appears in the body, so it can be substituted or re-emitted verbatim. */
  raw: string;
}

/** A comment body decomposed into ordered plain text and mention pieces. */
export type MentionRun =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; token: MentionToken };

/**
 * One person's place in the session directory. Tri-state on purpose: a two-state "name or null"
 * cannot tell "still loading" apart from "cannot be identified", and the spec (FR-005a) requires
 * those to look different to the reader.
 */
export type DirectoryEntry =
  | { status: 'resolved'; displayName: string }
  | { status: 'pending' }
  | { status: 'unresolvable' };

// Matches a wiki-markup mention token. The inner part must be non-empty, so "[~]" is not a mention;
// excluding "]" and newlines keeps an unclosed "[~foo" from swallowing the rest of the comment.
const WIKI_MENTION_PATTERN = /\[~([^\]\n]+)\]/g;

// Jira Cloud writes the account id behind this marker inside wiki markup.
const CLOUD_IDENTIFIER_MARKER = 'accountid:';

// Shown while a lookup is still in flight. MUST differ from UNRESOLVABLE_DISPLAY_TEXT (FR-005a).
const PENDING_DISPLAY_TEXT = '@…';

// Shown when a person genuinely cannot be identified. Terminal (FR-004).
const UNRESOLVABLE_DISPLAY_TEXT = '@unknown user';

// ADF node types that start a new block; a newline is emitted between them so separate paragraphs
// do not run together into one unreadable line.
const ADF_BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock']);

// ── Reading ──

/**
 * Splits a comment body into ordered text and mention runs.
 *
 * Accepts the two shapes Jira actually returns: a wiki-markup string (the REST v2 default) and an
 * Atlassian Document Format object. ADF support is the important half — an ADF mention node carries
 * its name in `attrs.text` and has no top-level `text`, so the app's shared plain-text normalizer
 * drops it entirely and the person disappears from the sentence. Here it becomes a mention run.
 */
export function parseCommentMentions(body: unknown): MentionRun[] {
  if (typeof body === 'string') {
    return mergeAdjacentTextRuns(parseWikiMarkupBody(body));
  }
  if (!isRecord(body)) {
    return [];
  }
  return mergeAdjacentTextRuns(collectAdfRuns(body, []));
}

/** Pulls every mention out of a composer draft, so the UI can show who is about to be tagged. */
export function extractMentionTokens(draftText: string): MentionToken[] {
  return parseCommentMentions(draftText)
    .filter((run): run is { kind: 'mention'; token: MentionToken } => run.kind === 'mention')
    .map((run) => run.token);
}

// ── Writing ──

/**
 * Builds the token to insert when a person is picked from the mention picker.
 *
 * The candidate's `userIdentifier` already encodes which form this instance uses
 * ("accountId:…" / "name:…" / "key:…"), so the correct token is derived rather than guessed.
 *
 * Returns null when no token can be built. That is a real case, not defensive padding: the picker
 * must not offer such a person, because inserting their plain name would post a comment that
 * notifies nobody — the exact silent failure this feature exists to remove (FR-012).
 */
export function buildMentionToken(candidate: FeatureReviewUserCandidate): MentionToken | null {
  const separatorIndex = candidate.userIdentifier.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const prefix = candidate.userIdentifier.slice(0, separatorIndex);
  const identifier = candidate.userIdentifier.slice(separatorIndex + 1).trim();
  if (identifier === '') {
    return null;
  }

  if (prefix === 'accountId') {
    return { flavour: 'accountId', identifier, raw: `[~${CLOUD_IDENTIFIER_MARKER}${identifier}]` };
  }
  if (prefix === 'name' || prefix === 'key') {
    return { flavour: prefix, identifier, raw: `[~${identifier}]` };
  }
  return null;
}

// ── Display ──

/** The key a mention is looked up under. Prefixed so two flavours can never collide. */
export function readMentionDirectoryKey(token: MentionToken): string {
  return `${token.flavour}:${token.identifier}`;
}

/**
 * Maps a mention plus what we know about that person to the text shown in its place. The visual
 * treatment (loading shimmer, emphasis) belongs to the component; this decides the words only.
 */
export function formatMentionForDisplay(_token: MentionToken, entry: DirectoryEntry | undefined): string {
  if (entry?.status === 'resolved') {
    return `@${entry.displayName}`;
  }
  if (entry?.status === 'unresolvable') {
    return UNRESOLVABLE_DISPLAY_TEXT;
  }
  // No entry yet is the same situation as an in-flight one: we simply do not know the name *yet*.
  return PENDING_DISPLAY_TEXT;
}

// ── Helpers ──

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}

/** Interprets the inside of a "[~…]" token, or returns null when it is not a usable mention. */
function readWikiMentionToken(innerText: string, raw: string): MentionToken | null {
  if (innerText.toLowerCase().startsWith(CLOUD_IDENTIFIER_MARKER)) {
    const identifier = innerText.slice(CLOUD_IDENTIFIER_MARKER.length).trim();
    return identifier === '' ? null : { flavour: 'accountId', identifier, raw };
  }

  const identifier = innerText.trim();
  // A bare "[~X]" cannot reveal whether X is a username or a user key, so it is read as a username
  // and the directory lookup falls back to a key search — mirroring the legacy retry the app's
  // existing Jira user search already performs.
  return identifier === '' ? null : { flavour: 'name', identifier, raw };
}

/** Scans a wiki-markup string, emitting the text between mentions and the mentions themselves. */
function parseWikiMarkupBody(body: string): MentionRun[] {
  const runs: MentionRun[] = [];
  let lastMatchEnd = 0;

  WIKI_MENTION_PATTERN.lastIndex = 0;
  let match = WIKI_MENTION_PATTERN.exec(body);
  while (match !== null) {
    const token = readWikiMentionToken(match[1], match[0]);
    if (token) {
      appendTextRun(runs, body.slice(lastMatchEnd, match.index));
      runs.push({ kind: 'mention', token });
      lastMatchEnd = match.index + match[0].length;
    }
    // A malformed token is simply left alone; the surrounding slice will re-emit it as plain text.
    match = WIKI_MENTION_PATTERN.exec(body);
  }

  appendTextRun(runs, body.slice(lastMatchEnd));
  return runs;
}

/** Walks an ADF document, turning mention nodes into runs instead of silently dropping them. */
function collectAdfRuns(node: unknown, runs: MentionRun[]): MentionRun[] {
  if (!isRecord(node)) {
    return runs;
  }

  if (node.type === 'mention') {
    const attributes = isRecord(node.attrs) ? node.attrs : {};
    const identifier = typeof attributes.id === 'string' ? attributes.id.trim() : '';
    if (identifier !== '') {
      runs.push({ kind: 'mention', token: { flavour: 'accountId', identifier, raw: `[~${CLOUD_IDENTIFIER_MARKER}${identifier}]` } });
    }
    return runs;
  }

  if (typeof node.type === 'string' && ADF_BLOCK_NODE_TYPES.has(node.type) && runs.length > 0) {
    appendTextRun(runs, '\n');
  }
  if (typeof node.text === 'string') {
    appendTextRun(runs, node.text);
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((childNode) => collectAdfRuns(childNode, runs));
  }
  return runs;
}

/** Adds a text run, skipping empties so adjacent mentions produce no blank run between them. */
function appendTextRun(runs: MentionRun[], text: string): void {
  if (text !== '') {
    runs.push({ kind: 'text', text });
  }
}

/** Collapses consecutive text runs, so a mention-free body is a single run. */
function mergeAdjacentTextRuns(runs: MentionRun[]): MentionRun[] {
  return runs.reduce<MentionRun[]>((mergedRuns, run) => {
    const previousRun = mergedRuns[mergedRuns.length - 1];
    if (run.kind === 'text' && previousRun?.kind === 'text') {
      mergedRuns[mergedRuns.length - 1] = { kind: 'text', text: previousRun.text + run.text };
      return mergedRuns;
    }
    mergedRuns.push(run);
    return mergedRuns;
  }, []);
}
