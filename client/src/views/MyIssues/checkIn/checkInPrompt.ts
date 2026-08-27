// checkInPrompt.ts — The propose-only round trip behind a developer status check-in.
//
// What comes back is not a report to file. It is a message somebody is about to send to a colleague,
// and that shapes every rule here:
//
//   - PER ISSUE, ONE QUESTION. Not an assessment of the person, not a judgement of their pace — a
//     specific thing to ask about a specific ticket. "Still waiting on the Axway change?" beats
//     "please provide a status update" by the whole width of the conversation.
//   - THE ASSISTANT NEVER STATES A STATUS AS FACT. It has read a ticket, not talked to anyone; the
//     entire point of sending the message is that only the developer knows. Anything it infers is
//     framed as a question to confirm, which is also what stops a wrong guess becoming an accusation.
//   - AN ISSUE THAT LOOKS FINE IS SAID TO LOOK FINE. A check-in that queries everything trains the
//     person to skim it, and the next real question gets skimmed too.
//
// Propose-only, like every other AI surface here: a prompt goes out, a reply is pasted back, and
// nothing is written to Jira or sent anywhere on its own.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import type { CheckInComment, CheckInIssue } from './checkInModel.ts';

export const CHECK_IN_REPLY_KIND = 'developerCheckIn';

/** What the assistant concluded about one issue, and what to ask about it. */
export interface CheckInItem {
  issueKey: string;
  /** How it reads from the outside — always framed as an observation, never as a verdict. */
  observation: string;
  /** The one thing to ask this person about this issue. Empty when nothing needs asking. */
  question: string;
  /** What might help it move, or '' when it looks fine as it is. */
  suggestion: string;
  /** True when nothing about this issue needs raising — kept so the message can say so briefly. */
  looksFine: boolean;
}

/** The whole reply: an opening line for the message, then one entry per issue. */
export interface CheckInReply {
  opening: string;
  items: CheckInItem[];
}

/** Renders one comment as a line the assistant can read. */
function formatComment(comment: CheckInComment): string {
  return `    · ${comment.authorName}: ${comment.text}`;
}

/** Describes an issue's timing in the plainest terms that are still true. */
function formatTiming(issue: CheckInIssue): string {
  const parts: string[] = [];
  if (issue.daysInStage !== null) {
    parts.push(`${issue.daysInStage}d at this stage`);
  }
  if (issue.daysSinceUpdate !== null) {
    parts.push(`last touched ${issue.daysSinceUpdate}d ago`);
  }
  if (issue.daysPastDue !== null) {
    // Stated as overdue or as time remaining, because those lead to different conversations and a
    // signed number leads to neither.
    parts.push(issue.daysPastDue > 0
      ? `OVERDUE by ${issue.daysPastDue}d (due ${issue.dueDateIso})`
      : `due ${issue.dueDateIso} (${Math.abs(issue.daysPastDue)}d away)`);
  }
  return parts.length === 0 ? 'no timing recorded' : parts.join(' · ');
}

/** The block describing one issue. */
function buildIssueBlock(issue: CheckInIssue): string {
  const lines = [
    `- ${issue.issueKey} (${issue.issueType}) — ${issue.summary}`,
    `    status: ${issue.status} · ${formatTiming(issue)}`,
  ];

  if (issue.priority !== null || issue.storyPoints !== null) {
    const sizeParts = [
      issue.priority === null ? '' : `priority ${issue.priority}`,
      issue.storyPoints === null ? '' : `${issue.storyPoints} pts`,
    ].filter((part) => part !== '');
    lines.push(`    ${sizeParts.join(' · ')}`);
  }

  // The Feature is stated so the conversation can be about an outcome rather than a ticket number.
  if (issue.featureKey !== null) {
    const featureLabel = issue.featureSummary === null || issue.featureSummary === ''
      ? issue.featureKey
      : `${issue.featureKey} — ${issue.featureSummary}`;
    lines.push(`    delivers: ${featureLabel}`);
  }

  if (issue.description !== '') {
    lines.push(`    what it is: ${issue.description}`);
  }

  if (issue.comments.length > 0) {
    // Newest first: a status question whose answer is already in the latest comment wastes an afternoon.
    lines.push('    latest comments (newest first):');
    issue.comments.forEach((comment) => lines.push(formatComment(comment)));
  } else {
    lines.push('    no comments');
  }

  return lines.join('\n');
}

/**
 * Builds the prompt that turns one person's plate into a message worth sending them.
 *
 * Returns an empty string when the person has nothing assigned — a prompt listing no work still costs
 * somebody's attention and gets a confidently useless answer.
 */
export function buildCheckInPrompt(personName: string, issues: readonly CheckInIssue[]): string {
  if (issues.length === 0) {
    return '';
  }

  return [
    `You are helping prepare a short status check-in message to send to ${personName}, who has the`,
    'work below assigned. The message will be pasted into an instant-message chat and sent to them',
    'directly, so write it as something a colleague would actually send.',
    '',
    'Rules, in order of importance:',
    `  1. NEVER state what the status of an item IS. You have read a ticket; you have not spoken to`,
    `     ${personName}, and only they know. Anything you infer must be phrased as something to confirm.`,
    '  2. Ask ONE specific question per item that needs one. "Still waiting on the Axway change?" is',
    '     worth sending; "please provide a status update" is not.',
    '  3. If an item looks fine, say so and set looksFine to true. A check-in that queries everything',
    '     teaches the reader to skim it, and the next real question gets skimmed too.',
    '  4. Judge the WORK, never the person. No comment on their pace, their capacity or their habits.',
    '  5. Use only what is below. Do not invent a blocker, a dependency, or a date.',
    '',
    `${personName}'s assigned work:`,
    issues.map((issue) => buildIssueBlock(issue)).join('\n\n'),
    '',
    'Reply with ONLY this JSON:',
    `{"kind":"${CHECK_IN_REPLY_KIND}","opening":"One friendly sentence to open the message",`,
    '"items":[{"issueKey":"KEY-1","observation":"How it reads from the outside",',
    '"question":"The one thing to ask about it","suggestion":"What might help it move, or empty",',
    '"looksFine":false}]}',
  ].join('\n');
}

/** Coerces to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parses a `{kind:'developerCheckIn'}` reply, keeping only issues that were actually asked about.
 *
 * Strict on the key, lenient on the fields. An invented key is dropped: a question about a ticket
 * this person does not hold would be sent to them anyway, and there is no recovering from that once
 * it is in a chat window. A missing field is merely an emptier line.
 */
export function parseCheckInReply(replyText: string, knownIssueKeys: readonly string[]): CheckInReply {
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== CHECK_IN_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${CHECK_IN_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }

  const knownKeySet = new Set(knownIssueKeys);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: CheckInItem[] = [];

  rawItems.forEach((rawItem) => {
    const itemRecord = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
    const issueKey = readTrimmedString(itemRecord.issueKey);
    if (issueKey === '' || !knownKeySet.has(issueKey) || items.some((kept) => kept.issueKey === issueKey)) {
      return;
    }
    items.push({
      issueKey,
      observation: readTrimmedString(itemRecord.observation),
      question: readTrimmedString(itemRecord.question),
      suggestion: readTrimmedString(itemRecord.suggestion),
      looksFine: itemRecord.looksFine === true,
    });
  });

  return { opening: readTrimmedString(parsed.opening), items };
}
