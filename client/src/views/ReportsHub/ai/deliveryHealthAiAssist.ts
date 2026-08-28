// deliveryHealthAiAssist.ts — Handing over the whole picture, and reading back a plan.
//
// The dashboard says WHERE work is stuck. It cannot say why, and it certainly cannot say what to do
// about it: that needs the shape of the team, the workflow it is bound by, and the politics of who
// gets to change what — none of which is in a changelog.
//
// So this is the same propose-only round trip the rest of Toolbox uses: every figure on the dashboard
// goes out in one prompt, a reply is pasted back, and what comes back is a reading of the evidence and
// a plan somebody can argue with. Nothing is sent automatically and nothing is written anywhere.
//
// Two rules shape what is asked for, and both exist because the alternative is a plausible answer that
// cannot be checked:
//
//   - EVERY FINDING CITES THE FIGURE IT RESTS ON. A diagnosis without its evidence is an opinion, and
//     the first person to challenge it in a meeting wins.
//   - AN ACTION SAYS WHO DECIDES. A recommendation nobody owns is a recommendation nobody takes, and a
//     Scrum Master who cannot say whose call it is has not finished the work.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { describeBacklog, describeConstraint, readInFlightStages, type QueueScanResult } from '../queueScan.ts';
import { describeReworkScan, type ReworkScanResult } from '../reworkScan.ts';

export const DELIVERY_HEALTH_REPLY_KIND = 'deliveryHealthPlan';

/** Stages and holders named in the prompt. Enough to see the shape, not a transcript. */
const MAX_PROMPT_ROWS = 8;

/** One thing the reply concluded, and the figure it rests on. */
export interface DeliveryHealthFinding {
  observation: string;
  /** The number from the dashboard this rests on — what makes it checkable rather than plausible. */
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

/** One thing to do about it. */
export interface DeliveryHealthAction {
  action: string;
  rationale: string;
  effort: 'small' | 'medium' | 'large';
  /** Whose call it is. A recommendation nobody owns is one nobody takes. */
  whoDecides: string;
}

/** The whole reply: what is happening, what it rests on, what to do, and what to go and ask. */
export interface DeliveryHealthPlan {
  diagnosis: string;
  findings: DeliveryHealthFinding[];
  actions: DeliveryHealthAction[];
  /** Questions the data cannot answer — the ones to take to the team rather than guess at. */
  questionsToAsk: string[];
}

/** The stage lines, worst first. */
function buildStageLines(queue: QueueScanResult): string[] {
  return readInFlightStages(queue).slice(0, MAX_PROMPT_ROWS).map((stage) =>
    `  - ${stage.statusName}: ${stage.issueCount} issue(s), ${stage.totalWaitingDays} waiting days total, `
      + `${stage.medianWaitingDays} median, oldest ${stage.longestWaitingDays}`);
}

/** The holder lines, worst first. */
function buildHolderLines(queue: QueueScanResult): string[] {
  return queue.holders.slice(0, MAX_PROMPT_ROWS).map((holder) =>
    `  - ${holder.holderName}: ${holder.issueCount} issue(s), ${holder.totalWaitingDays} waiting days`);
}

/** Where returns landed, worst first. */
function buildReturnLines(rework: ReworkScanResult): string[] {
  return rework.returnsByStatus.map((entry) => `  - fell back into ${entry.statusName}: ${entry.count} time(s)`);
}

/**
 * Builds the prompt that turns the dashboard into a reading of it.
 *
 * The team's own context is passed in and stated verbatim, because the numbers alone will produce a
 * generic answer: "reduce work in progress" is true of almost every board ever measured, and useless
 * to somebody who already knows their tester is the constraint.
 */
export function buildDeliveryHealthPrompt(
  queue: QueueScanResult,
  rework: ReworkScanResult,
  teamContext: string,
): string {
  const trimmedContext = teamContext.trim();

  return [
    'You are reading a delivery-health report for one software team and writing up what it shows.',
    'Everything below came from Jira changelog history. Nothing is estimated and nothing is a target.',
    '',
    ...(trimmedContext === ''
      ? ['No context about the team was supplied, so say plainly where your reading would change if',
        'you knew more about how they work.']
      : ['What the team already knows about itself:', trimmedContext]),
    '',
    'THE CONSTRAINT',
    describeConstraint(queue),
    '',
    'WHERE STARTED WORK IS WAITING (worst first)',
    ...(buildStageLines(queue).length === 0 ? ['  (nothing has been started)'] : buildStageLines(queue)),
    '',
    'NOT STARTED AT ALL',
    `  ${describeBacklog(queue)}`,
    '',
    'WHO IS HOLDING THE WAITING (worst first)',
    ...(buildHolderLines(queue).length === 0 ? ['  (nobody holds open work)'] : buildHolderLines(queue)),
    '',
    'WHAT CAME BACK AFTER REACHING DELIVERY',
    `  ${describeReworkScan(rework)}`,
    ...(buildReturnLines(rework).length === 0 ? [] : buildReturnLines(rework)),
    '',
    'Rules:',
    '  1. Every finding must cite the figure it rests on. A diagnosis without its evidence is an opinion,',
    '     and the first person to challenge it in a meeting wins.',
    '  2. Every action must say WHO DECIDES. A recommendation nobody owns is one nobody takes.',
    '  3. Say what the data does NOT show. A queue says where work stopped, never why, and a plan that',
    '     pretends otherwise will be wrong in a way nobody can see.',
    '  4. Judge the SYSTEM, never the people. Naming who holds a queue is describing a workload; saying',
    '     anything about how they work is not supported by anything here.',
    '  5. Use only the figures above. Do not invent a number, a name, or a date.',
    '',
    'Reply with ONLY this JSON:',
    `{"kind":"${DELIVERY_HEALTH_REPLY_KIND}",`,
    '"diagnosis":"What is actually happening here, in three or four sentences",',
    '"findings":[{"observation":"...","evidence":"the figure it rests on","confidence":"high"}],',
    '"actions":[{"action":"...","rationale":"...","effort":"small","whoDecides":"..."}],',
    '"questionsToAsk":["What the data cannot answer and somebody should be asked"]}',
  ].join('\n');
}

/** Coerces to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads a value against a fixed set, falling back rather than rejecting the whole reply for it. */
function readEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  const text = readTrimmedString(value).toLowerCase();
  return (allowed as readonly string[]).includes(text) ? (text as TValue) : fallback;
}

/** Reads the findings, dropping any with nothing in them. */
function readFindings(value: unknown): DeliveryHealthFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): DeliveryHealthFinding => {
      const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        observation: readTrimmedString(record.observation),
        evidence: readTrimmedString(record.evidence),
        // Unstated confidence reads as MEDIUM, never high: an unqualified claim should not be promoted
        // to a confident one by the parser that read it.
        confidence: readEnum(record.confidence, ['high', 'medium', 'low'] as const, 'medium'),
      };
    })
    .filter((finding) => finding.observation !== '');
}

/** Reads the actions, dropping any with nothing to do in them. */
function readActions(value: unknown): DeliveryHealthAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): DeliveryHealthAction => {
      const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        action: readTrimmedString(record.action),
        rationale: readTrimmedString(record.rationale),
        effort: readEnum(record.effort, ['small', 'medium', 'large'] as const, 'medium'),
        // Said plainly rather than left blank: an unowned action is the one that quietly does not happen.
        whoDecides: readTrimmedString(record.whoDecides) || 'Not stated',
      };
    })
    .filter((action) => action.action !== '');
}

/**
 * Parses a `{kind:'deliveryHealthPlan'}` reply.
 *
 * Strict on the envelope, lenient on the contents: a reply of the wrong kind is somebody's previous
 * answer pasted by mistake and must be refused, while one malformed finding is worth dropping rather
 * than losing an otherwise usable plan to.
 */
export function parseDeliveryHealthReply(replyText: string): DeliveryHealthPlan {
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== DELIVERY_HEALTH_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${DELIVERY_HEALTH_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }

  return {
    diagnosis: readTrimmedString(parsed.diagnosis),
    findings: readFindings(parsed.findings),
    actions: readActions(parsed.actions),
    questionsToAsk: Array.isArray(parsed.questionsToAsk)
      ? parsed.questionsToAsk.map((entry) => readTrimmedString(entry)).filter((question) => question !== '')
      : [],
  };
}
