// rcpChangeFixes.ts — Fixes an existing change's RCP gaps straight in ServiceNow (GH #415).
//
// Three of the five rules can be fixed from Toolbox: the window (moved to the next approved night by exact date
// arithmetic — never guessed by AI), Requested By (set to the CI's owner), and the justification (rewritten by AI
// Assist to cover the RCP points). Each fix writes only its own fields directly to the change: Modify's own Save
// does not write Requested By at all, so routing fixes through the form would silently drop one of them.
// The Director's approval stays manual — it is an email the Director sends.

import { snowFetch } from '../../../services/snowApi.ts';
import { CODE_BLOCK_REPLY_INSTRUCTION } from '../chgFormula/assistantReplyText.ts';
import type { ChgTextFieldKey } from '../chgFormula/formulaCard.ts';
import { buildChgFieldsFollowUp, parseAiAssistChgResponse } from '../hooks/useAiAssist.ts';
import type { RcpChangeFacts } from './rcpChangeFacts.ts';
import { findNextApprovedWindow } from './rcpRules.ts';

/** The fields one RCP fix writes; only those present are sent. */
export interface RcpChangeFix {
  justification?: string;
  requestedBySysId?: string;
  plannedStartUtc?: string;
  plannedEndUtc?: string;
}

const MILLISECONDS_PER_MINUTE = 60_000;
const RCP_LAST_DAY_LABEL = 'Jan 19, 2027';
// The one change field the RCP rewrite round asks for.
const RCP_ASKED_FIELD_KEYS: readonly ChgTextFieldKey[] = ['justification'];

/** An ISO instant in ServiceNow's stored date-time format, which is UTC: "2026-10-10 00:00:00". */
function toSnowUtcDateTime(instantIso: string): string {
  return new Date(instantIso).toISOString().slice(0, 19).replace('T', ' ');
}

/** Writes one fix to the change. A fix with nothing in it is refused rather than sent as an empty update. */
export async function saveRcpChangeFix(changeSysId: string, fix: RcpChangeFix): Promise<void> {
  const patchBody: Record<string, string> = {};
  if (fix.justification !== undefined && fix.justification.trim() !== '') patchBody.justification = fix.justification.trim();
  if (fix.requestedBySysId) patchBody.requested_by = fix.requestedBySysId;
  if (fix.plannedStartUtc) patchBody.start_date = toSnowUtcDateTime(fix.plannedStartUtc);
  if (fix.plannedEndUtc) patchBody.end_date = toSnowUtcDateTime(fix.plannedEndUtc);
  if (Object.keys(patchBody).length === 0) {
    throw new Error('There is nothing to write to the change.');
  }
  await snowFetch(`/api/now/table/change_request/${changeSysId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
}

/**
 * The next approved window for the change: as long as its implementation, validation and backout estimates,
 * or — with none — as long as its current window. Null when that cannot fit inside one night.
 */
export function planRcpWindowFix(facts: RcpChangeFacts, nowUtc: string): { plannedStartUtc: string; plannedEndUtc: string } | null {
  const currentWindowMinutes = facts.plannedStartUtc && facts.plannedEndUtc
    ? Math.round((Date.parse(facts.plannedEndUtc) - Date.parse(facts.plannedStartUtc)) / MILLISECONDS_PER_MINUTE)
    : null;
  const durationMinutes = facts.totalEstimateMinutes ?? currentWindowMinutes;
  return durationMinutes === null ? null : findNextApprovedWindow({ nowUtc, durationMinutes, riskLabel: facts.riskLabel });
}

/** The AI Assist prompt that rewrites the justification to meet the RCP rule. */
export function buildRcpJustificationPrompt(facts: RcpChangeFacts): string {
  return [
    `Rewrite the Justification of ServiceNow change ${facts.changeNumber} so it meets Change Management's Restricted Change `
      + `Period (RCP, through ${RCP_LAST_DAY_LABEL}) rule. It must explain:`,
    '1. Why it must happen during the RCP.',
    `2. The impact of delaying it until after ${RCP_LAST_DAY_LABEL}.`,
    '3. Any time-sensitive business or operational need.',
    '',
    'The change:',
    `What changes: ${facts.shortDescription || '(not set)'}`,
    `Configuration item: ${facts.configItem.displayName || '(not set)'}`,
    `Risk: ${facts.riskLabel || '(not set)'}`,
    `Current justification: ${facts.justification.trim() || '(not set)'}`,
    '',
    'Keep every correct fact already in it. Be concise — a short paragraph or a few bullets. Never invent names, dates, '
      + 'counts or impacts: where a fact is missing, write [CONFIRM: <what is needed>] so the owner can fill it in.',
    CODE_BLOCK_REPLY_INSTRUCTION,
    // The labelled form comes last, so the reply's shape is the final thing the assistant reads (GH #499).
    'Reply with exactly this label, starting its own line, and the whole rewritten justification after it:',
    'JUSTIFICATION: [the whole rewritten justification]',
  ].join('\n');
}

/**
 * The rewritten justification from a pasted reply, or '' when the reply carries none. Its label or a heading such as
 * "Rewritten Justification" is read; an intro sentence and a closing offer to help further are left out (GH #499).
 */
export function readRcpJustificationReply(replyText: string): string {
  return parseAiAssistChgResponse(replyText).justification?.trim() ?? '';
}

/**
 * The follow-up for the same AI chat when a reply carries no readable justification, or '' when it does. It asks for
 * the labelled form only — the rewrite is never taken from unlabelled prose, which may be the assistant's own commentary.
 */
export function buildRcpJustificationFollowUp(replyText: string): string {
  return buildChgFieldsFollowUp(replyText, RCP_ASKED_FIELD_KEYS);
}
