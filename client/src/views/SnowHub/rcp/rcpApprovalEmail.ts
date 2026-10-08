// rcpApprovalEmail.ts — The Director approval email for an RCP change, drafted by AI Assist, and the RCP switch.
//
// Every Production change in the restricted change period needs the Director-level Service Owner's email
// approval attached. A Director reads dozens of these, so the draft is held to under 200 words: what is
// changing, when, why it cannot wait, the risk and the way back, and one clear ask. It is built only from the
// change's own facts — anything missing becomes a visible [CONFIRM: …] rather than a plausible invention.
//
// The switch lives here too: the RCP rules are temporary, so the whole checklist can be turned off.

import { CODE_BLOCK_REPLY_INSTRUCTION, stripCodeFences } from '../chgFormula/assistantReplyText.ts';
import { RCP_LAST_DAY_ISO } from './rcpRules.ts';

/** The change facts the approval email is written from. */
export interface RcpApprovalEmailContext {
  changeNumber: string;
  shortDescription: string;
  environmentLabel: string;
  /** The planned window in Central Time, already worded. */
  windowText: string;
  configItemName: string;
  directorName: string;
  riskLabel: string;
  justification: string;
  backoutPlan: string;
}

const RCP_RULES_ENABLED_STORAGE_KEY = 'tbxRcpRulesEnabled';
const MAX_EMAIL_WORDS = 200;
const RCP_LAST_DAY_LABEL = 'Jan 19, 2027';
const NOT_SET_TEXT = '(not set)';

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

/** One labelled fact for the prompt, with an empty value shown plainly so it becomes a [CONFIRM: …]. */
function renderFact(label: string, value: string): string {
  return `${label}: ${value.trim() || NOT_SET_TEXT}`;
}

/** The prompt that drafts the Director approval email. */
export function buildRcpApprovalEmailPrompt(context: RcpApprovalEmailContext): string {
  return [
    `Write an email to ${context.directorName || '[CONFIRM: Director name]'}, the Director-level Service Owner, asking them to `
      + `approve a ${context.environmentLabel || 'Production'} change during the Restricted Change Period (RCP, through ${RCP_LAST_DAY_LABEL}).`,
    '',
    'The change:',
    renderFact('Change number', context.changeNumber),
    renderFact('What changes', context.shortDescription),
    renderFact('Configuration item', context.configItemName),
    renderFact('Window', context.windowText),
    renderFact('Risk', context.riskLabel),
    renderFact('Why now', context.justification),
    renderFact('Backout', context.backoutPlan),
    '',
    `Rules: under ${MAX_EMAIL_WORDS} words, including a one-line subject. Punchy and to the point — no wall of text.`,
    'Structure: Subject line; one sentence on what and when; 3–4 short bullets (why it cannot wait until after '
      + `${RCP_LAST_DAY_LABEL}, the impact of delaying, the risk, the backout); then one clear ask: "Please reply 'Approved' `
      + 'so I can attach your approval to the change."',
    'Use only the facts above. Where something needed is not set, write [CONFIRM: <what is needed>] — never invent '
      + 'names, dates, counts or impacts.',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/** The pasted email, out of its code block, with its word count so an over-long draft is visible. */
export function readApprovalEmailReply(replyText: string): { emailText: string; wordCount: number } {
  const emailText = stripCodeFences(replyText).trim();
  return { emailText, wordCount: emailText === '' ? 0 : emailText.split(/\s+/).length };
}

/** The words-per-email limit, for the panel's over-length warning. */
export const RCP_MAX_EMAIL_WORDS = MAX_EMAIL_WORDS;
/** The RCP's last day, for the switch's explanation. */
export const RCP_RULES_LAST_DAY = RCP_LAST_DAY_ISO;
