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
//
// The reply is asked for as a short document — DIAGNOSIS, a FINDINGS table, an ACTIONS table, then
// QUESTIONS_TO_ASK — because Google's AI Mode, the team's only assistant (GH #499), writes documents and
// tables and ignores a JSON reply format. Each part is found by its label or by the heading AI Mode writes
// for it, the tables are read by their headers, and the result goes through the same readers a JSON reply
// does. A JSON reply is still read. A part left out gets a follow-up for the same chat, never a guess.

import { readRecordTableItems, type ReplyRecordSpec } from '../../../utils/aiReplyRecords.ts';
import { FILL_IN_BLANK } from '../../../utils/aiReplyTable.ts';
import { readReplySections, type ReplySection } from '../../../utils/aiReplySections.ts';
import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { describeBacklog, describeConstraint, readInFlightStages, type QueueScanResult } from '../queueScan.ts';
import { describeReworkScan, type ReworkScanResult } from '../reworkScan.ts';

export const DELIVERY_HEALTH_REPLY_KIND = 'deliveryHealthPlan';

/**
 * Which panel a finding or action belongs beside.
 *
 * The reading used to land in one block under the report, which nobody reads: a wall of text at the
 * bottom is a second document somebody has to reconcile with the first. Tagged, each observation sits
 * INSIDE the panel holding the evidence it rests on, where it is read at the moment the figure is.
 */
export type DeliveryHealthTopic = 'constraint' | 'backlog' | 'holders' | 'rework' | 'overall';

/** Every topic, so the prompt lists exactly what the parser will accept. */
export const DELIVERY_HEALTH_TOPICS: readonly DeliveryHealthTopic[] =
  ['constraint', 'backlog', 'holders', 'rework', 'overall'];

/** Stages and holders named in the prompt. Enough to see the shape, not a transcript. */
const MAX_PROMPT_ROWS = 8;

/** The four parts of the reply document, in the order the prompt asks for them. */
type DeliveryHealthPartKey = 'diagnosis' | 'findings' | 'actions' | 'questions';

/** Each part's label, and the headings AI Mode writes for it instead. */
const DELIVERY_HEALTH_PARTS: readonly ReplySection<DeliveryHealthPartKey>[] = [
  { key: 'diagnosis', marker: 'DIAGNOSIS', headingPattern: /^(?:the )?diagnosis$|^what is (?:actually )?happening/i },
  { key: 'findings', marker: 'FINDINGS', headingPattern: /^(?:key )?findings$/i },
  { key: 'actions', marker: 'ACTIONS', headingPattern: /^(?:recommended |suggested )?actions?(?: plan)?$/i },
  { key: 'questions', marker: 'QUESTIONS_TO_ASK', headingPattern: /^(?:open )?questions(?: to ask)?(?: the team)?$/i },
];

/** The findings table. Observation leads: a row with no observation is dropped, as an empty finding always was. */
const FINDINGS_TABLE_SPEC: ReplyRecordSpec = {
  kind: 'deliveryHealthFinding',
  replyMarker: 'FINDINGS:',
  columns: [
    { field: 'observation', header: 'Observation' },
    { field: 'evidence', header: 'Evidence' },
    { field: 'confidence', header: 'Confidence' },
    { field: 'topic', header: 'Topic' },
  ],
};

/** The actions table. Action leads, for the same reason. */
const ACTIONS_TABLE_SPEC: ReplyRecordSpec = {
  kind: 'deliveryHealthAction',
  replyMarker: 'ACTIONS:',
  columns: [
    { field: 'action', header: 'Action' },
    { field: 'rationale', header: 'Rationale' },
    { field: 'effort', header: 'Effort' },
    { field: 'whoDecides', header: 'Who decides' },
    { field: 'topic', header: 'Topic' },
  ],
};

/** The parts a follow-up chases. Questions are optional: "the data answers everything" is a fair answer. */
const REQUIRED_PART_KEYS = ['diagnosis', 'findings', 'actions'] as const;
// A list entry's bullet or number: "- ", "• ", "1. ".
const LIST_BULLET_PATTERN = /^\s*(?:[•\-*–◦▪]|\d+[.)])\s+/;
/** The error every round shows for a reply it cannot read — kept word for word. */
const UNREADABLE_REPLY_MESSAGE = 'No JSON object found in the assistant response.';

/** One thing the reply concluded, and the figure it rests on. */
export interface DeliveryHealthFinding {
  /** The panel this belongs beside. Anything unrecognised falls to 'overall' rather than vanishing. */
  topic: DeliveryHealthTopic;
  observation: string;
  /** The number from the dashboard this rests on — what makes it checkable rather than plausible. */
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

/** One thing to do about it. */
export interface DeliveryHealthAction {
  topic: DeliveryHealthTopic;
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
    `  6. Tag every finding and action with the part of the report it is about: ${DELIVERY_HEALTH_TOPICS.join(', ')}.`,
    '     Each one is shown beside the figures it rests on, so a wrong tag puts it next to the wrong evidence.',
    '',
    ...buildDeliveryHealthReplyForm(DELIVERY_HEALTH_PARTS.map((part) => part.key)),
  ].join('\n');
}

/** One table's header and a blank row to copy, each cell on one line. */
function buildBlankTableLines(spec: ReplyRecordSpec): string[] {
  return [spec.columns.map((column) => column.header).join(' | '), spec.columns.map(() => FILL_IN_BLANK).join(' | ')];
}

/** The lines asking for one part of the reply document. */
function buildPartFormLines(partKey: DeliveryHealthPartKey): string[] {
  if (partKey === 'diagnosis') return ['DIAGNOSIS: what is actually happening here, in three or four sentences.'];
  if (partKey === 'findings') {
    return ['FINDINGS: one table row per finding. Evidence is the figure above it rests on; Confidence is high, '
      + `medium or low; Topic is one of ${DELIVERY_HEALTH_TOPICS.join(', ')}.`, ...buildBlankTableLines(FINDINGS_TABLE_SPEC)];
  }
  if (partKey === 'actions') {
    return ['ACTIONS: one table row per action. Effort is small, medium or large; Who decides names whose call it is; '
      + 'Topic as above.', ...buildBlankTableLines(ACTIONS_TABLE_SPEC)];
  }
  return ['QUESTIONS_TO_ASK: one line per question the data cannot answer and somebody should be asked.'];
}

/**
 * The reply form for the given parts: each starts on its own line with its label, the findings and actions
 * as tables. Used whole by the prompt and in part by a follow-up asking only for what was left out.
 */
function buildDeliveryHealthReplyForm(partKeys: readonly DeliveryHealthPartKey[]): string[] {
  return [
    'Answer in these parts, each starting on its own line with its label exactly as written:',
    '',
    ...partKeys.flatMap((partKey) => [...buildPartFormLines(partKey), '']),
    'Keep each table cell on one line and never put a "|" inside a cell. Do not answer in JSON. Write nothing '
      + 'before the first label or after the last part, and ask me no questions — give your best judgement.',
  ];
}

/**
 * The follow-up for the same AI chat: the whole form when the reply could not be read (`plan` null), or only
 * the parts a read plan came back without. '' when nothing is missing.
 */
export function buildDeliveryHealthFollowUpPrompt(plan: DeliveryHealthPlan | null): string {
  if (plan === null) {
    return ['Your last reply was not in the form I need, so it could not be read. Keep what you concluded, but lay it out like this.',
      ...buildDeliveryHealthReplyForm(DELIVERY_HEALTH_PARTS.map((part) => part.key))].join('\n');
  }
  const partEntryCounts = { diagnosis: plan.diagnosis === '' ? 0 : 1, findings: plan.findings.length, actions: plan.actions.length };
  const missingPartKeys = REQUIRED_PART_KEYS.filter((partKey) => partEntryCounts[partKey] === 0);
  if (missingPartKeys.length === 0) return '';
  const missingLabels = missingPartKeys.map((partKey) => DELIVERY_HEALTH_PARTS.find((part) => part.key === partKey)?.marker);
  return [`Your last reply did not include ${missingLabels.join(', ')}. Write only those now.`,
    ...buildDeliveryHealthReplyForm(missingPartKeys)].join('\n');
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
        // Unrecognised topics fall to 'overall', which is shown: a finding filed under a panel that
        // does not exist would otherwise be silently dropped from a report somebody is relying on.
        topic: readEnum(record.topic, DELIVERY_HEALTH_TOPICS, 'overall'),
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
        topic: readEnum(record.topic, DELIVERY_HEALTH_TOPICS, 'overall'),
        action: readTrimmedString(record.action),
        rationale: readTrimmedString(record.rationale),
        effort: readEnum(record.effort, ['small', 'medium', 'large'] as const, 'medium'),
        // Said plainly rather than left blank: an unowned action is the one that quietly does not happen.
        whoDecides: readTrimmedString(record.whoDecides) || 'Not stated',
      };
    })
    .filter((action) => action.action !== '');
}

/** A list part's entries, one per line, bullets and numbers removed. */
function readListLines(partText: string | undefined): string[] {
  return (partText ?? '').split(/\r?\n/).map((partLine) => partLine.replace(LIST_BULLET_PATTERN, '').trim())
    .filter((partLine) => partLine !== '');
}

/**
 * The plan from a document-shaped reply, or null when the reply has none of the four parts (a JSON reply,
 * or prose that ignored the form). The tables go through the same readers as JSON, so every rule holds.
 */
function readDeliveryHealthDocument(replyText: string): DeliveryHealthPlan | null {
  const partTexts = readReplySections(replyText, DELIVERY_HEALTH_PARTS);
  if (Object.keys(partTexts).length === 0) return null;
  return {
    diagnosis: (partTexts.diagnosis ?? '').replace(/\s*\r?\n\s*/g, ' ').trim(),
    findings: readFindings(readRecordTableItems(partTexts.findings ?? '', FINDINGS_TABLE_SPEC) ?? []),
    actions: readActions(readRecordTableItems(partTexts.actions ?? '', ACTIONS_TABLE_SPEC) ?? []),
    questionsToAsk: readListLines(partTexts.questions),
  };
}

/** The reply's JSON text, refused in the words every round shows when there is none. */
function extractDeliveryHealthJson(replyText: string): string {
  try {
    return extractJsonPayload(replyText);
  } catch {
    throw new Error(UNREADABLE_REPLY_MESSAGE);
  }
}

/**
 * Parses a delivery-health reply: the asked-for document (DIAGNOSIS, FINDINGS, ACTIONS, QUESTIONS_TO_ASK)
 * first, then a `{kind:'deliveryHealthPlan'}` JSON reply.
 *
 * Strict on the envelope, lenient on the contents: a reply of the wrong kind is somebody's previous
 * answer pasted by mistake and must be refused, while one malformed finding is worth dropping rather
 * than losing an otherwise usable plan to.
 */
export function parseDeliveryHealthReply(replyText: string): DeliveryHealthPlan {
  const documentPlan = readDeliveryHealthDocument(replyText);
  if (documentPlan !== null) return documentPlan;
  const parsed = JSON.parse(extractDeliveryHealthJson(replyText)) as Record<string, unknown>;
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
