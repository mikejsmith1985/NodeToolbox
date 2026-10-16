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

// ── The sender's answers ──

/** Every question the email can need answered by the sender before it is drafted. */
export type RcpEmailQuestionId =
  | 'directorName' | 'changeNumber' | 'shortDescription' | 'configItemName' | 'ciOwnerName' | 'windowText' | 'riskLabel'
  | 'expectedImpact' | 'whyDuringRcp' | 'deferralImpact' | 'whyWeekday' | 'weekendImpact' | 'senderName' | 'senderContact';

/** One question put to the sender, with an answer box. */
export interface RcpEmailQuestion {
  id: RcpEmailQuestionId;
  /** The answer box's label. */
  label: string;
  /** What a good answer holds, or where to find it. */
  hint: string;
  /** A paragraph rather than a single line. */
  isLongAnswer: boolean;
}

/** The sender's answers, by question. */
export type RcpEmailAnswers = Partial<Record<RcpEmailQuestionId, string>>;

/** The sender's own name and contact block, remembered for every email they send. */
export interface RcpSenderDetails {
  senderName: string;
  senderContact: string;
}

const RCP_SENDER_NAME_STORAGE_KEY = 'tbxRcpSenderName';
const RCP_SENDER_CONTACT_STORAGE_KEY = 'tbxRcpSenderContact';

// A change fact the email shows; asked only when ServiceNow did not have it.
const FACT_QUESTIONS: readonly (RcpEmailQuestion & { id: keyof RcpApprovalEmailContext & RcpEmailQuestionId })[] = [
  { id: 'changeNumber', label: 'Change number', hint: 'The CHG number, once the change is created.', isLongAnswer: false },
  { id: 'shortDescription', label: 'Change title', hint: 'The change\'s short description.', isLongAnswer: false },
  { id: 'configItemName', label: 'Affected service and CI(s)', hint: 'The service and configuration items the change touches.', isLongAnswer: false },
  { id: 'ciOwnerName', label: 'CI owner', hint: 'The owner of the affected configuration item.', isLongAnswer: false },
  { id: 'windowText', label: 'Proposed implementation window', hint: 'Date, start time and end time, in Central Time.', isLongAnswer: false },
  { id: 'riskLabel', label: 'Risk level', hint: 'The change\'s risk, as ServiceNow will show it.', isLongAnswer: false },
];

/** The questions only the sender can answer: no ServiceNow field holds them. */
function buildNarrativeQuestions(isWeekday: boolean): RcpEmailQuestion[] {
  return [
    { id: 'expectedImpact', label: 'Affected users or services, and any expected outage or degradation', hint: 'Who notices, and for how long. Say "none" if nobody is affected.', isLongAnswer: true },
    { id: 'whyDuringRcp', label: 'Why this must occur during RCP', hint: 'The business or operational need, and any deadline or obligation.', isLongAnswer: true },
    { id: 'deferralImpact', label: 'Impact of deferring until after RCP', hint: 'What happens if this waits until after January 19, 2027, 7:00 p.m. CT — with dates or evidence.', isLongAnswer: true },
    ...(isWeekday ? [
      { id: 'whyWeekday', label: 'Why must this occur Monday - Friday?', hint: 'Why it cannot run on a Friday, Saturday or Sunday night.', isLongAnswer: true },
      { id: 'weekendImpact', label: 'What is the impact of deploying on a weekend?', hint: 'What moving it to a weekend night would cost or risk.', isLongAnswer: true },
    ] satisfies RcpEmailQuestion[] : []),
  ];
}

/**
 * Every question the email needs the sender to answer before it is drafted: the Director (always — the
 * approver is chosen by a person, not read from a field), any change fact ServiceNow did not have, the
 * sections only the sender can know, and who is sending it. Nothing the email shows is left to a guess.
 */
export function listRcpEmailQuestions(context: RcpApprovalEmailContext): RcpEmailQuestion[] {
  const ownerHint = context.ciOwnerName.trim() ? ` The CI owner is ${context.ciOwnerName.trim()}.` : '';
  return [
    { id: 'directorName', label: 'Director name', hint: `The director-level approver in the CI owner's leadership chain.${ownerHint}`, isLongAnswer: false },
    ...FACT_QUESTIONS.filter((question) => String(context[question.id] ?? '').trim() === ''),
    ...buildNarrativeQuestions(isWeekdayRequest(context.plannedStartUtc)),
    { id: 'senderName', label: 'Your name', hint: 'How you sign the email. Remembered for next time.', isLongAnswer: false },
    { id: 'senderContact', label: 'Your team and contact details', hint: 'Team, phone or email. Remembered for next time.', isLongAnswer: false },
  ];
}

/** The answers to start from: the Director on the change, its justification, and the sender last used. */
export function buildInitialRcpEmailAnswers(context: RcpApprovalEmailContext, storage: Storage = window.localStorage): RcpEmailAnswers {
  const initialAnswers: RcpEmailAnswers = { ...readRcpSenderDetails(storage) };
  if (context.directorName.trim()) initialAnswers.directorName = context.directorName.trim();
  if (context.justification.trim()) initialAnswers.whyDuringRcp = context.justification.trim();
  return Object.fromEntries(Object.entries(initialAnswers).filter(([, answer]) => answer !== '')) as RcpEmailAnswers;
}

/** The questions still blank — while any remain, the email cannot be drafted. */
export function listUnansweredRcpEmailQuestions(questions: readonly RcpEmailQuestion[], answers: RcpEmailAnswers): RcpEmailQuestion[] {
  return questions.filter((question) => (answers[question.id] ?? '').trim() === '');
}

/** The sender's remembered name and contact block; blank until first saved. */
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
    // Remembering the sender is a convenience; the email is drafted either way.
  }
}

// ── The template ──

/** A fact as the template shows it: the sender's answer, else ServiceNow's value, else a [CONFIRM: …]. */
function fillOrConfirm(value: string, missingDescription: string, answer?: string): string {
  return answer?.trim() || value.trim() || `[CONFIRM: ${missingDescription}]`;
}

/** A section AI Assist writes, carrying the sender's own notes for it so nothing is made up. */
function buildWriteMarker(sectionDescription: string, senderNotes?: string): string {
  return senderNotes?.trim()
    ? `[WRITE: ${sectionDescription}, using only these notes from the sender: "${senderNotes.trim()}"]`
    : `[WRITE: ${sectionDescription}]`;
}

/** Whether the template's "why Monday - Friday" questions belong in this email; kept when the start is unknown. */
function isWeekdayRequest(plannedStartUtc: string | null): boolean {
  const startWeekday = readWindowStartWeekday(plannedStartUtc);
  return startWeekday === null || WEEKDAY_REQUEST_NIGHTS.has(startWeekday);
}

/** The template's change summary block, filled from the change and the sender's answers. */
function buildChangeSummaryLines(context: RcpApprovalEmailContext, answers: RcpEmailAnswers, changeNumber: string, windowText: string): string[] {
  return [
    'Change summary',
    `Change number and title: ${changeNumber} — ${fillOrConfirm(context.shortDescription, 'change title', answers.shortDescription)}`,
    `Affected service and CI(s): ${fillOrConfirm(context.configItemName, 'service and configuration items', answers.configItemName)}`,
    `CI owner: ${fillOrConfirm(context.ciOwnerName, 'CI owner', answers.ciOwnerName)}`,
    `Proposed implementation window: ${windowText}`,
    `Risk and expected impact: ${fillOrConfirm(context.riskLabel, 'risk level', answers.riskLabel)} — `
      + buildWriteMarker('affected users or services, and any expected outage or degradation', answers.expectedImpact),
  ];
}

/** The template's two weekday questions, for a window that starts Monday to Thursday night. */
function buildWeekdayRequestLines(answers: RcpEmailAnswers): string[] {
  return [
    '',
    'Why must this occur during Monday - Friday?',
    buildWriteMarker('why this cannot run on a Friday, Saturday or Sunday night', answers.whyWeekday),
    '',
    'What is the impact of deploying on a weekend?',
    buildWriteMarker('the impact of moving this to a weekend night', answers.weekendImpact),
  ];
}

/**
 * Change Management's RCP approval request email (GH #441), with every fact filled in — from the sender's
 * answers first, then ServiceNow. Sections AI Assist writes are [WRITE: …] carrying the sender's notes; a
 * fact nobody has supplied yet is [CONFIRM: …], which Toolbox asks about before the email can be copied.
 */
export function buildRcpApprovalEmailTemplate(
  context: RcpApprovalEmailContext,
  processOwnerName: string,
  answers: RcpEmailAnswers = {},
): string {
  const changeNumber = fillOrConfirm(context.changeNumber, 'change number', answers.changeNumber);
  const windowText = fillOrConfirm(context.windowText, 'date, start time and end time — Central Time', answers.windowText);
  return [
    `Subject: RCP approval request — ${changeNumber}`,
    '',
    `Hello ${fillOrConfirm(context.directorName, 'Director name', answers.directorName)} and ${processOwnerName},`,
    '',
    `Please review the attached PDF of change ${changeNumber} and reply with your approval before I submit it for Change Management review.`,
    '',
    'You are the director-level approver identified through the affected configuration item (CI) owner’s leadership chain.',
    '',
    ...buildChangeSummaryLines(context, answers, changeNumber, windowText),
    '',
    'Why this must occur during RCP',
    buildWriteMarker('the business or operational need and any time-sensitive deadline or obligation', answers.whyDuringRcp),
    '',
    'Impact of deferring until after RCP',
    buildWriteMarker('the consequence of waiting until after January 19, 2027, at 7:00 p.m. Central Time, with supporting dates or evidence', answers.deferralImpact),
    ...(isWeekdayRequest(context.plannedStartUtc) ? buildWeekdayRequestLines(answers) : []),
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
    fillOrConfirm('', 'your name', answers.senderName),
    fillOrConfirm('', 'team / contact information', answers.senderContact),
    '',
    `Attachment: ${changeNumber} — Change Record.pdf`,
  ].join('\n');
}

/** One labelled fact for the prompt, with an empty value shown plainly. */
function renderFact(label: string, value: string): string {
  return `${label}: ${value.trim() || NOT_SET_TEXT}`;
}

/** The prompt that has AI Assist complete the RCP approval request email from Change Management's template. */
export function buildRcpApprovalEmailPrompt(
  context: RcpApprovalEmailContext,
  processOwnerName: string,
  answers: RcpEmailAnswers = {},
): string {
  return [
    `Complete this RCP approval request email for a ${context.environmentLabel || 'Production'} change during the `
      + `Restricted Change Period (RCP, through January 19, 2027). It goes to the Director and/or the Change Process Owner.`,
    '',
    'Facts about the change:',
    renderFact('What changes', answers.shortDescription || context.shortDescription),
    renderFact('Why now (justification)', context.justification),
    renderFact('Risk', answers.riskLabel || context.riskLabel),
    renderFact('Backout', context.backoutPlan),
    '',
    'Rules:',
    '- Keep every line of the template word for word, in the same order. Do not add, remove or reword anything outside the [WRITE: …] markers.',
    '- Replace each [WRITE: …] marker with one to three plain, professional sentences built only from the sender\'s notes inside it and the facts above.',
    '- Never invent names, dates, counts, impacts or evidence, and never soften or exaggerate what the notes say.',
    '- If something a sentence needs is genuinely missing, write [CONFIRM: <a short question to the sender>] there instead — Toolbox will ask the sender and fill it in before the email can be sent.',
    '- Leave every [CONFIRM: …] marker exactly as it is.',
    '',
    'Template:',
    buildRcpApprovalEmailTemplate(context, processOwnerName, answers),
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

// ── Gaps left in the drafted email ──

/** One placeholder still in the email, and the question it asks the sender. */
export interface RcpEmailGap {
  placeholderText: string;
  questionText: string;
}

// Any [bracketed] text is a placeholder: the finished template has no brackets of its own.
const BRACKETED_PLACEHOLDER_PATTERN = /\[([^\]\n]+)\]/g;
const PLACEHOLDER_PREFIX_PATTERN = /^\s*(?:CONFIRM|WRITE)\s*:\s*/i;
// Filler words a draft uses where a fact belongs.
const FILLER_PLACEHOLDERS = ['(not set)', 'TBD', 'TBA'];

/** True when a filler word stands alone in the email, not inside a longer word. */
function containsFiller(emailText: string, fillerText: string): boolean {
  const escapedFiller = fillerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escapedFiller}([^A-Za-z]|$)`).test(emailText);
}

/**
 * Every placeholder still in the drafted email, once each, in the order found: [CONFIRM: …], [WRITE: …],
 * any other [bracketed] text, then filler such as "(not set)" or "TBD". While any remain, the email is not
 * ready to send — each becomes a question for the sender.
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

/** The email with the sender's answer in place of every copy of one placeholder. */
export function fillRcpEmailGap(emailText: string, placeholderText: string, answer: string): string {
  return emailText.split(placeholderText).join(answer.trim());
}

/** The pasted email, out of its code block, with its word count. */
export function readApprovalEmailReply(replyText: string): { emailText: string; wordCount: number } {
  const emailText = stripCodeFences(replyText).trim();
  return { emailText, wordCount: emailText === '' ? 0 : emailText.split(/\s+/).length };
}

/** The RCP's last day, for the switch's explanation. */
export const RCP_RULES_LAST_DAY = RCP_LAST_DAY_ISO;
