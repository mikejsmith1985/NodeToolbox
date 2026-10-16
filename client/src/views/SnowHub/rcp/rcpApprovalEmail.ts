// rcpApprovalEmail.ts — The RCP Director / Process Owner approval request email, drafted by AI Assist, and the RCP switch.
//
// Every Production change in the restricted change period needs the Director's (and/or the Change Process
// Owner's) email approval attached. Change Management publishes one template for that request (GH #441).
// Toolbox fills in every fact it holds and hands AI Assist everything else known about the change, so AI
// Assist can work out each remaining section itself. Only what truly cannot be worked out is asked — by AI
// Assist, in its own chat, with its best guess — and an email that still has a gap cannot be copied.
//
// The switch lives here too: the RCP rules are temporary, so the whole checklist can be turned off.

import { CONVERSATIONAL_REPLY_INSTRUCTION, stripCodeFences } from '../chgFormula/assistantReplyText.ts';
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
  // ── Read only for an existing change (or from the builder's draft) — more for AI Assist to work from ──
  description?: string;
  implementationPlan?: string;
  riskImpactAnalysis?: string;
  testPlan?: string;
  impactLabel?: string;
  requestedByName?: string;
  assignmentGroupName?: string;
  /** One line per change task: number, type, summary, group / assignee and window. */
  changeTaskLines?: string[];
  /** The sender's name and contact block, learned from their last approval email. */
  senderName?: string;
  senderContact?: string;
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

// ── The sender ──

/** The sender's own name and contact block, learned from their last finished email. */
export interface RcpSenderDetails {
  senderName: string;
  senderContact: string;
}

const RCP_SENDER_NAME_STORAGE_KEY = 'tbxRcpSenderName';
const RCP_SENDER_CONTACT_STORAGE_KEY = 'tbxRcpSenderContact';
// The sign-off line the template ends with; the sender's name and contact follow it.
const SIGN_OFF_LINE_PATTERN = /^(thank you|thanks|regards|best regards|kind regards)[,.!]?$/i;
const ATTACHMENT_LINE_PATTERN = /^attachment:/i;

/** The sender's remembered name and contact block; blank until a finished email has been taken. */
export function readRcpSenderDetails(storage: Storage = window.localStorage): RcpSenderDetails {
  try {
    return {
      senderName: storage.getItem(RCP_SENDER_NAME_STORAGE_KEY)?.trim() ?? '',
      senderContact: storage.getItem(RCP_SENDER_CONTACT_STORAGE_KEY)?.trim() ?? '',
    };
  } catch {
    return { senderName: '', senderContact: '' };
  }
}

/** Remembers the sender's name and contact block for the next email. */
export function writeRcpSenderDetails(senderDetails: RcpSenderDetails, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(RCP_SENDER_NAME_STORAGE_KEY, senderDetails.senderName.trim());
    storage.setItem(RCP_SENDER_CONTACT_STORAGE_KEY, senderDetails.senderContact.trim());
  } catch {
    // Remembering the sender is a convenience; the next email simply asks again.
  }
}

/**
 * The sender's name and contact block read from a finished email's sign-off, so the next email needs no
 * question about them. Null when the email has no recognisable sign-off.
 */
export function readRcpSenderFromEmail(emailText: string): RcpSenderDetails | null {
  const emailLines = emailText.split(/\r?\n/).map((emailLine) => emailLine.trim());
  const signOffIndex = emailLines.findIndex((emailLine) => SIGN_OFF_LINE_PATTERN.test(emailLine));
  if (signOffIndex === -1) {
    return null;
  }
  const signatureLines = [];
  for (const emailLine of emailLines.slice(signOffIndex + 1)) {
    if (emailLine === '' || ATTACHMENT_LINE_PATTERN.test(emailLine)) break;
    signatureLines.push(emailLine);
  }
  const [senderName = '', ...contactLines] = signatureLines;
  return senderName === '' ? null : { senderName, senderContact: contactLines.join(' ') };
}

// ── The template ──

/** A fact as the template shows it, or a [CONFIRM: …] for AI Assist to work out or ask the sender about. */
function fillOrConfirm(value: string | undefined, missingDescription: string): string {
  return value?.trim() || `[CONFIRM: ${missingDescription}]`;
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
 * Sections AI Assist writes are [WRITE: …]; a fact Toolbox does not hold is [CONFIRM: …], which AI Assist
 * works out from the change or asks the sender about — never leaves in the finished email.
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
    fillOrConfirm(context.senderName, 'your name'),
    fillOrConfirm(context.senderContact, 'team / contact information'),
    '',
    `Attachment: ${changeNumber} — Change Record.pdf`,
  ].join('\n');
}

// ── The prompt ──

/** One labelled fact for the prompt, with an empty value shown plainly. */
function renderFact(label: string, value: string | undefined): string {
  return `${label}: ${value?.trim() || NOT_SET_TEXT}`;
}

/** Everything known about the change, for AI Assist to work each section out from. */
function renderChangeFacts(context: RcpApprovalEmailContext): string[] {
  return [
    'Everything known about the change:',
    renderFact('Change number', context.changeNumber),
    renderFact('Title', context.shortDescription),
    renderFact('Environment', context.environmentLabel),
    renderFact('Configuration item', context.configItemName),
    renderFact('CI owner', context.ciOwnerName),
    renderFact('Requested By (the RCP rules require this to be the Director)', context.requestedByName),
    renderFact('Assignment group', context.assignmentGroupName),
    renderFact('Planned window (Central Time)', context.windowText),
    renderFact('Risk', context.riskLabel),
    renderFact('Impact', context.impactLabel),
    renderFact('Description', context.description),
    renderFact('Justification', context.justification),
    renderFact('Implementation plan', context.implementationPlan),
    renderFact('Risk and impact analysis', context.riskImpactAnalysis),
    renderFact('Test plan', context.testPlan),
    renderFact('Backout plan', context.backoutPlan),
    `Change tasks: ${context.changeTaskLines?.length ? `\n${context.changeTaskLines.map((taskLine) => `- ${taskLine}`).join('\n')}` : NOT_SET_TEXT}`,
    renderFact('Sender (from their last approval email)', [context.senderName, context.senderContact].filter(Boolean).join(' — ')),
  ];
}

// How AI Assist completes the email: infer first, ask only what it truly cannot, and never leave a placeholder.
const EMAIL_RULES = [
  'Rules:',
  '- Keep every line of the template word for word, in the same order. Change only the [WRITE: …] and [CONFIRM: …] markers.',
  '- Work out every marker yourself from the facts above before asking anything. For example: the Director is normally '
    + 'the Requested By person, or the CI owner\'s director; the expected impact and any outage come from the risk and '
    + 'impact analysis, the implementation plan and the task windows; why it must happen during RCP and the impact of '
    + 'deferring come from the justification and description; the weekday answers come from the justification and the window.',
  '- Write each [WRITE: …] section as one to three plain, professional sentences. Never invent names, dates, counts, '
    + 'impacts or evidence the facts do not support.',
  '- Only when something truly cannot be worked out from the facts, ask me — in ONE chat message, as a short numbered '
    + 'list, as few questions as possible, each with your best guess so I can simply reply "yes" or correct it.',
  '- The finished email must contain no [ ] markers, no placeholders and nothing marked TBD.',
];

/** The prompt that has AI Assist complete the RCP approval request email, asking the sender only what it must. */
export function buildRcpApprovalEmailPrompt(context: RcpApprovalEmailContext, processOwnerName: string): string {
  return [
    `Complete this RCP approval request email for a ${context.environmentLabel || 'Production'} change during the `
      + 'Restricted Change Period (RCP, through January 19, 2027). It goes to the Director and/or the Change Process Owner, '
      + 'so it must be complete and correct — no gaps.',
    '',
    ...renderChangeFacts(context),
    '',
    ...EMAIL_RULES,
    '',
    'Template:',
    buildRcpApprovalEmailTemplate(context, processOwnerName),
    '',
    CONVERSATIONAL_REPLY_INSTRUCTION.replace('the fields', 'the whole email'),
  ].join('\n');
}

// ── Gaps left in the pasted email ──

/** One placeholder still in the email, and what it stands for. */
export interface RcpEmailGap {
  placeholderText: string;
  questionText: string;
}

// Any [bracketed] text is a placeholder: the finished template has no brackets of its own.
const BRACKETED_PLACEHOLDER_PATTERN = /\[([^\]\n]+)\]/g;
const PLACEHOLDER_PREFIX_PATTERN = /^\s*(?:CONFIRM|WRITE)\s*:\s*/i;
// Filler words a draft uses where a fact belongs.
const FILLER_PLACEHOLDERS = ['(not set)', 'TBD', 'TBA'];
const SUBJECT_LINE_PATTERN = /^\s*Subject:/im;

/** True when a filler word stands alone in the email, not inside a longer word. */
function containsFiller(emailText: string, fillerText: string): boolean {
  const escapedFiller = fillerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escapedFiller}([^A-Za-z]|$)`).test(emailText);
}

/**
 * Every placeholder still in the pasted email, once each, in the order found: [CONFIRM: …], [WRITE: …], any
 * other [bracketed] text, then filler such as "(not set)" or "TBD". While any remain, the email is not ready.
 */
export function findRcpEmailGaps(emailText: string): RcpEmailGap[] {
  const gapsByPlaceholder = new Map<string, RcpEmailGap>();
  for (const placeholderMatch of emailText.matchAll(BRACKETED_PLACEHOLDER_PATTERN)) {
    const placeholderText = placeholderMatch[0];
    if (!gapsByPlaceholder.has(placeholderText)) {
      gapsByPlaceholder.set(placeholderText, { placeholderText, questionText: placeholderMatch[1].replace(PLACEHOLDER_PREFIX_PATTERN, '').trim() });
    }
  }
  for (const fillerText of FILLER_PLACEHOLDERS) {
    if (containsFiller(emailText, fillerText)) {
      gapsByPlaceholder.set(fillerText, { placeholderText: fillerText, questionText: `A value the email shows as "${fillerText}"` });
    }
  }
  return [...gapsByPlaceholder.values()];
}

/**
 * True when the pasted text is AI Assist's question rather than the email — it has no Subject line and asks
 * something. The question is answered in the AI chat; only the finished email comes back here.
 */
export function isRcpEmailQuestionReply(replyText: string): boolean {
  const pastedText = stripCodeFences(replyText);
  return !SUBJECT_LINE_PATTERN.test(pastedText) && pastedText.includes('?');
}

/** The follow-up prompt for an email that came back with gaps: work each out, or ask the sender, then resend. */
export function buildRcpEmailGapPrompt(emailText: string, gaps: readonly RcpEmailGap[]): string {
  return [
    'The RCP approval email below still has gaps the Director must not see:',
    ...gaps.map((gap) => `- ${gap.placeholderText}`),
    '',
    'Work out each one from the change facts earlier in this chat. Only if one truly cannot be worked out, ask me in '
      + 'ONE chat message — a short numbered list, each with your best guess so I can reply "yes".',
    'Then send the whole email again, unchanged apart from the gaps, with no [ ] markers, placeholders or TBD left.',
    '',
    'Email:',
    emailText,
    '',
    CONVERSATIONAL_REPLY_INSTRUCTION.replace('the fields', 'the whole email'),
  ].join('\n');
}

/** The pasted email, out of its code block, with its word count. */
export function readApprovalEmailReply(replyText: string): { emailText: string; wordCount: number } {
  const emailText = stripCodeFences(replyText).trim();
  return { emailText, wordCount: emailText === '' ? 0 : emailText.split(/\s+/).length };
}

/** The RCP's last day, for the switch's explanation. */
export const RCP_RULES_LAST_DAY = RCP_LAST_DAY_ISO;
