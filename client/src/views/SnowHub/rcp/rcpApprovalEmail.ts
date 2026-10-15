// rcpApprovalEmail.ts — The RCP Director / Process Owner approval request email, drafted by AI Assist, and the RCP switch.
//
// Every Production change in the restricted change period needs the Director's (and/or the Change Process
// Owner's) email approval attached. Change Management publishes one template for that request (GH #441), so
// Toolbox fills every fact it already holds into that template itself, and AI Assist writes only the
// narrative sections marked [WRITE: …] — the rest of the wording stays exactly as Change Management wrote
// it. Anything Toolbox does not know becomes a visible [CONFIRM: …] rather than a plausible invention.
//
// The switch lives here too: the RCP rules are temporary, so the whole checklist can be turned off.

import { CODE_BLOCK_REPLY_INSTRUCTION, stripCodeFences } from '../chgFormula/assistantReplyText.ts';
import { RCP_LAST_DAY_ISO, readWindowStartWeekday } from './rcpRules.ts';

/** The change facts the approval email is written from. */
export interface RcpApprovalEmailContext {
  changeNumber: string;
  shortDescription: string;
  environmentLabel: string;
  /** The planned window in Central Time, already worded. */
  windowText: string;
  /** The planned start as an ISO instant, to tell a weekday request from a weekend one; null when not set. */
  plannedStartUtc: string | null;
  configItemName: string;
  /** The configuration item's owner; empty when it could not be read. */
  ciOwnerName: string;
  directorName: string;
  riskLabel: string;
  justification: string;
  backoutPlan: string;
}

const RCP_RULES_ENABLED_STORAGE_KEY = 'tbxRcpRulesEnabled';
const RCP_PROCESS_OWNER_STORAGE_KEY = 'tbxRcpProcessOwnerName';
/** The Change Process Owner Change Management's template names, used until Admin Hub names someone else. */
export const DEFAULT_RCP_PROCESS_OWNER_NAME = 'Ben Labout';
const NOT_SET_TEXT = '(not set)';
// Monday–Thursday nights are outside the normal Friday–Sunday RCP nights, so the template's weekday
// questions apply to them. A Friday-night window is a normal RCP night and does not need them.
const WEEKDAY_REQUEST_NIGHTS = new Set(['Mon', 'Tue', 'Wed', 'Thu']);

/** True unless the RCP checklist has been switched off on this machine. */
export function readRcpRulesEnabled(storage: Storage = window.localStorage): boolean {
  try {
    return storage.getItem(RCP_RULES_ENABLED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Switches the RCP checklist on or off. */
export function writeRcpRulesEnabled(isEnabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(RCP_RULES_ENABLED_STORAGE_KEY, String(isEnabled));
}

/** The Change Process Owner the approval email is addressed to, beside the Director. */
export function readRcpProcessOwnerName(storage: Storage = window.localStorage): string {
  try {
    return storage.getItem(RCP_PROCESS_OWNER_STORAGE_KEY)?.trim() || DEFAULT_RCP_PROCESS_OWNER_NAME;
  } catch {
    return DEFAULT_RCP_PROCESS_OWNER_NAME;
  }
}

/** Names the Change Process Owner; a blank name goes back to the template's default. */
export function writeRcpProcessOwnerName(processOwnerName: string, storage: Storage = window.localStorage): void {
  storage.setItem(RCP_PROCESS_OWNER_STORAGE_KEY, processOwnerName.trim());
}

/** A fact as the template shows it, or a [CONFIRM: …] naming what is missing. */
function fillOrConfirm(value: string, missingDescription: string): string {
  return value.trim() || `[CONFIRM: ${missingDescription}]`;
}

/** Whether the template's "why Monday - Friday" questions belong in this email; kept when the start is unknown. */
function isWeekdayRequest(plannedStartUtc: string | null): boolean {
  const startWeekday = readWindowStartWeekday(plannedStartUtc);
  return startWeekday === null || WEEKDAY_REQUEST_NIGHTS.has(startWeekday);
}

/** The template's change summary block, filled from the change. */
function buildChangeSummaryLines(context: RcpApprovalEmailContext, changeNumber: string, windowText: string): string[] {
  return [
    'Change summary',
    `Change number and title: ${changeNumber} — ${fillOrConfirm(context.shortDescription, 'change title')}`,
    `Affected service and CI(s): ${fillOrConfirm(context.configItemName, 'service and configuration items')}`,
    `CI owner: ${fillOrConfirm(context.ciOwnerName, 'CI owner')}`,
    `Proposed implementation window: ${windowText}`,
    `Risk and expected impact: ${fillOrConfirm(context.riskLabel, 'risk level')} — `
      + '[WRITE: affected users or services, and any expected outage or degradation]',
  ];
}

/** The template's two weekday questions, for a window that starts Monday to Thursday night. */
function buildWeekdayRequestLines(): string[] {
  return [
    '',
    'Why must this occur during Monday - Friday?',
    '[WRITE: why this cannot run on a Friday, Saturday or Sunday night]',
    '',
    'What is the impact of deploying on a weekend?',
    '[WRITE: the impact of moving this to a weekend night]',
  ];
}

/**
 * Change Management's RCP approval request email (GH #441), with every fact Toolbox holds filled in.
 * Sections only a person or AI Assist can write are marked [WRITE: …]; missing facts are [CONFIRM: …].
 */
export function buildRcpApprovalEmailTemplate(context: RcpApprovalEmailContext, processOwnerName: string): string {
  const changeNumber = fillOrConfirm(context.changeNumber, 'change number');
  const windowText = fillOrConfirm(context.windowText, 'date, start time and end time — Central Time');
  return [
    `Subject: RCP approval request — ${changeNumber}`,
    '',
    `Hello ${fillOrConfirm(context.directorName, 'Director name')} and ${processOwnerName},`,
    '',
    `Please review the attached PDF of change ${changeNumber} and reply with your approval before I submit it for Change Management review.`,
    '',
    'You are the director-level approver identified through the affected configuration item (CI) owner’s leadership chain.',
    '',
    ...buildChangeSummaryLines(context, changeNumber, windowText),
    '',
    'Why this must occur during RCP',
    '[WRITE: the business or operational need and any time-sensitive deadline or obligation]',
    '',
    'Impact of deferring until after RCP',
    '[WRITE: the consequence of waiting until after January 19, 2027, at 7:00 p.m. Central Time, with supporting dates or evidence]',
    ...(isWeekdayRequest(context.plannedStartUtc) ? buildWeekdayRequestLines() : []),
    '',
    'The attached PDF contains the implementation plan, risk and impact analysis, backout plan, and pre-production and post-implementation testing details. The proposed window includes live work, testing and backout within permitted hours on one calendar day.',
    '',
    'If you approve, please reply with:',
    '',
    `“I approve the RCP request for change ${changeNumber}, as described in the attached PDF, for the proposed window of ${windowText}.”`,
    '',
    'If you need additional information or require changes before approving, please identify them in your reply.',
    '',
    'I will attach your approval email to the change record before submission. Implementation remains subject to the remaining required reviews and authorization.',
    '',
    'Thank you,',
    '[CONFIRM: your name]',
    '[CONFIRM: team / contact information]',
    '',
    `Attachment: ${changeNumber} — Change Record.pdf`,
  ].join('\n');
}

/** One labelled fact for the prompt, with an empty value shown plainly. */
function renderFact(label: string, value: string): string {
  return `${label}: ${value.trim() || NOT_SET_TEXT}`;
}

/** The prompt that has AI Assist complete the RCP approval request email from Change Management's template. */
export function buildRcpApprovalEmailPrompt(context: RcpApprovalEmailContext, processOwnerName: string): string {
  return [
    `Complete this RCP approval request email for a ${context.environmentLabel || 'Production'} change during the `
      + `Restricted Change Period (RCP, through January 19, 2027). It goes to the Director and/or the Change Process Owner.`,
    '',
    'Facts about the change:',
    renderFact('What changes', context.shortDescription),
    renderFact('Why now (justification)', context.justification),
    renderFact('Risk', context.riskLabel),
    renderFact('Backout', context.backoutPlan),
    '',
    'Rules:',
    '- Keep every line of the template word for word, in the same order. Do not add, remove or reword anything outside the [WRITE: …] markers.',
    '- Replace each [WRITE: …] marker with one to three plain sentences, using only the facts above.',
    '- Where the facts do not cover a [WRITE: …] marker, replace it with [CONFIRM: <what is needed>] — never invent names, dates, counts or impacts.',
    '- Leave every [CONFIRM: …] marker exactly as it is, for the sender to fill in.',
    '',
    'Template:',
    buildRcpApprovalEmailTemplate(context, processOwnerName),
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/** The pasted email, out of its code block, with its word count. */
export function readApprovalEmailReply(replyText: string): { emailText: string; wordCount: number } {
  const emailText = stripCodeFences(replyText).trim();
  return { emailText, wordCount: emailText === '' ? 0 : emailText.split(/\s+/).length };
}

/** The RCP's last day, for the switch's explanation. */
export const RCP_RULES_LAST_DAY = RCP_LAST_DAY_ISO;
