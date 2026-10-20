// changeReadinessFacts.ts — Gathers, in parallel and from the readers SNow Hub already has, the facts the readiness checklist judges.
//
// The checklist engine (changeReadiness.ts) is pure; this is its only I/O. Each read is the same one the Advanced
// panel uses — RCP facts, CTASK records, outages, the PRB scan — so the checklist and the panel cannot see different
// records. Each read is wrapped on its own: one that fails (an access rule, a timeout) becomes a null fact with a
// plain-English reason, which the engine shows as "could not check", while every other fact is still gathered.

import { snowFetch } from '../../../services/snowApi.ts';
import { fetchChangeTaskRecords } from '../chgFormula/ctaskReviewApi.ts';
import { readReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import { buildCtaskFindingField, checkCtaskRules } from '../chgFormula/ctaskReviewRules.ts';
import { findJiraKeysInChangeText } from '../chgFormula/changeJiraStories.ts';
import type { ChgTextFieldKey } from '../chgFormula/formulaCard.ts';
import { extractSnowReference, extractStringValue } from '../hooks/snowFieldValues.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';
import { fetchChangeOutages } from '../outage/changeOutageRecord.ts';
import { scanIssuesForProblems, type ChangeProblemRow } from '../problems/changeProblems.ts';
import { evaluateRcpChecklist, fetchRcpChangeFacts, readUtcInstant, type RcpChangeFacts } from '../rcp/rcpChangeFacts.ts';
import { isRcpPeriodActive } from '../rcp/rcpRules.ts';
import type {
  ChangeReadinessFacts,
  PrbLinkStatus,
  ReadinessChangeRecord,
  ReadinessCtask,
  ReadinessFactName,
  ReadinessPrb,
} from './changeReadiness.ts';

/** What the caller supplies that is not on the record: this session's risk check and the RCP switch. */
export interface ReadinessGatherOptions {
  riskReview: { isReady: boolean } | null;
  isRcpRulesEnabled: boolean;
  /** Today in Central Time (YYYY-MM-DD), the day the RCP rules are judged on. */
  todayIso: string;
}

/** The facts, plus the record identity the fixes need to write back. */
export interface GatheredChangeReadiness {
  facts: ChangeReadinessFacts;
  changeSysId: string | null;
  /** The Jira issues the change's text names — the scope the PRB scan read. */
  issueKeys: string[];
}

/** The change record as the lookup returns it. */
interface LookedUpChange {
  changeSysId: string;
  record: ReadinessChangeRecord;
  configItem: SnowReference;
  textFields: Record<ChgTextFieldKey, string>;
}

const CHANGE_TABLE_PATH = '/api/now/table/change_request';
// Where each drafted text lives on the change record (the same names Modify reads).
const TEXT_FIELD_RECORD_NAMES: Readonly<Record<ChgTextFieldKey, string>> = {
  shortDescription: 'short_description',
  description: 'description',
  justification: 'justification',
  riskImpact: 'risk_impact_analysis',
  implementationPlan: 'implementation_plan',
  testPlan: 'test_plan',
  backoutPlan: 'backout_plan',
};
const CHANGE_LOOKUP_FIELDS = ['sys_id', 'number', 'state', 'assigned_to', 'cmdb_ci', ...Object.values(TEXT_FIELD_RECORD_NAMES)].join(',');
// The HTTP status in a failed read's message ("HTTP 403 …"), the one detail worth showing a person.
const HTTP_STATUS_PATTERN = /\b([45]\d{2})\b/;
// Readable names for each fact, used in "could not read …" reasons.
const FACT_DESCRIPTIONS: Readonly<Record<ReadinessFactName, string>> = {
  change: 'the change',
  textFields: 'the change\'s text',
  environment: 'the change\'s environment',
  plannedWindow: 'the change\'s planned window',
  rcpChecks: 'the restricted change period facts',
  outages: 'the outage records',
  ctasks: 'the change\'s tasks',
  prbs: 'the problem records named in the change\'s issues',
  attachments: 'the change\'s attachments',
};

// ── Pure readers ──

/**
 * One change task as the checklist judges it: the CTASK rules decide whether its configuration item matches
 * the change's (so the checklist and the risk check agree), and its planned dates are read as stored.
 */
export function readReadinessCtask(taskRecord: Readonly<Record<string, unknown>>, changeConfigItem: SnowReference): ReadinessCtask {
  const ctask = readReviewedCtask(taskRecord);
  const configItemField = buildCtaskFindingField(ctask.number, 'configItem');
  const configItemFinding = checkCtaskRules([ctask], changeConfigItem).find((finding) => finding.field === configItemField);
  return {
    number: ctask.number,
    isImplementation: ctask.isImplementation,
    isConfigItemMatching: configItemFinding?.status === 'PASS',
    hasBackoutPlan: ctask.backoutPlan.trim() !== '',
    hasPlannedDates: readUtcInstant(taskRecord.planned_start_date) !== null && readUtcInstant(taskRecord.planned_end_date) !== null,
  };
}

/** Where one PRB stands against this change, read the way the problems panel reads it. */
export function readPrbLinkStatus(row: ChangeProblemRow, changeSysId: string): PrbLinkStatus {
  if (row.problem === null) return 'notInServiceNow';
  const linkedChangeSysId = row.problem.linkedChange.sysId;
  if (linkedChangeSysId === '') return 'unlinked';
  return linkedChangeSysId === changeSysId ? 'thisChange' : 'otherChange';
}

/** A plain-English reason for a failed read, keeping only the HTTP status — never a path or a field name. */
function describeReadFailure(factName: ReadinessFactName, readError: unknown): string {
  const errorMessage = readError instanceof Error ? readError.message : String(readError ?? '');
  const statusMatch = HTTP_STATUS_PATTERN.exec(errorMessage);
  const statusNote = statusMatch ? ` (ServiceNow answered ${statusMatch[1]})` : '';
  return `Could not read ${FACT_DESCRIPTIONS[factName]}${statusNote}.`;
}

/** The record fields of a looked-up change, as the checklist needs them. */
function readLookedUpChange(changeRecord: Readonly<Record<string, unknown>>): LookedUpChange {
  const configItem = extractSnowReference(changeRecord.cmdb_ci);
  const textEntries = (Object.keys(TEXT_FIELD_RECORD_NAMES) as ChgTextFieldKey[])
    .map((fieldKey) => [fieldKey, extractStringValue(changeRecord[TEXT_FIELD_RECORD_NAMES[fieldKey]])]);
  return {
    changeSysId: extractSnowReference(changeRecord.sys_id).sysId || extractStringValue(changeRecord.sys_id),
    record: {
      changeNumber: extractStringValue(changeRecord.number),
      stateLabel: extractStringValue(changeRecord.state),
      ownerName: extractSnowReference(changeRecord.assigned_to).displayName,
      configItemName: configItem.displayName,
    },
    configItem,
    textFields: Object.fromEntries(textEntries) as Record<ChgTextFieldKey, string>,
  };
}

// ── Reads ──

/** A read's value, or its failure reason — never a thrown error. */
type SettledRead<TValue> = { isRead: true; value: TValue } | { isRead: false; failureReason: string };

/** Runs one read, turning a failure into a reason for the fact it was meant to supply. */
async function settleRead<TValue>(factName: ReadinessFactName, runRead: () => Promise<TValue>): Promise<SettledRead<TValue>> {
  try {
    return { isRead: true, value: await runRead() };
  } catch (readError) {
    return { isRead: false, failureReason: describeReadFailure(factName, readError) };
  }
}

/** Finds the change by its number; throws when ServiceNow has no such change. */
async function lookUpChange(changeNumber: string): Promise<LookedUpChange> {
  const changeQuery = encodeURIComponent(`number=${changeNumber.trim()}`);
  const reply = await snowFetch<{ result?: unknown }>(
    `${CHANGE_TABLE_PATH}?sysparm_query=${changeQuery}&sysparm_display_value=all&sysparm_limit=1&sysparm_fields=${CHANGE_LOOKUP_FIELDS}`,
    { method: 'GET' },
  );
  const changeRecord = Array.isArray(reply?.result) ? reply.result[0] : undefined;
  if (typeof changeRecord !== 'object' || changeRecord === null) {
    throw new Error(`ServiceNow has no change ${changeNumber}.`);
  }
  return readLookedUpChange(changeRecord as Record<string, unknown>);
}

/** The facts for a change that could not be read at all: every fact null, each with the same reason. */
function buildUnreadFacts(options: ReadinessGatherOptions, failureReason: string): ChangeReadinessFacts {
  const failedFactNames = Object.keys(FACT_DESCRIPTIONS) as ReadinessFactName[];
  return {
    change: null, textFields: null, isProduction: null, plannedWindow: null, riskReview: options.riskReview,
    isRcpActive: isRcpPeriodActive(options.isRcpRulesEnabled, options.todayIso), rcpChecks: null, outageCount: null,
    ctasks: null, prbs: null, attachmentFileNames: null,
    failureReasons: Object.fromEntries(failedFactNames.map((factName) => [factName, failureReason])),
  };
}

/** The facts that come from the RCP read: environment, window, attachments, and the RCP verdicts. */
function readRcpDerivedFacts(
  rcpRead: SettledRead<RcpChangeFacts>,
  isRcpActive: boolean,
  todayIso: string,
): Pick<ChangeReadinessFacts, 'isProduction' | 'plannedWindow' | 'attachmentFileNames' | 'rcpChecks'> {
  if (!rcpRead.isRead) return { isProduction: null, plannedWindow: null, attachmentFileNames: null, rcpChecks: null };
  const rcpFacts = rcpRead.value;
  return {
    isProduction: rcpFacts.isProduction,
    plannedWindow: { plannedStartUtc: rcpFacts.plannedStartUtc, plannedEndUtc: rcpFacts.plannedEndUtc },
    attachmentFileNames: rcpFacts.attachmentFileNames,
    rcpChecks: isRcpActive && rcpFacts.isProduction ? evaluateRcpChecklist(rcpFacts, todayIso) : [],
  };
}

/** The failure reasons of every read that failed, keyed by the facts each was meant to supply. */
function collectFailureReasons(
  reads: ReadonlyArray<[readonly ReadinessFactName[], SettledRead<unknown>]>,
  attachmentFileNames: readonly string[] | null,
  isRcpRead: boolean,
): Partial<Record<ReadinessFactName, string>> {
  const failureReasons: Partial<Record<ReadinessFactName, string>> = {};
  for (const [factNames, settledRead] of reads) {
    if (settledRead.isRead) continue;
    for (const factName of factNames) failureReasons[factName] = settledRead.failureReason;
  }
  // The RCP read itself can succeed while its own attachment read failed; that is reported as unread attachments.
  if (isRcpRead && attachmentFileNames === null) failureReasons.attachments = describeReadFailure('attachments', null);
  return failureReasons;
}

/**
 * Gathers every fact the readiness checklist judges for one existing change, reading in parallel. Never throws:
 * a change that cannot be found, or any single read that fails, comes back as null facts with a reason.
 */
export async function gatherChangeReadinessFacts(changeNumber: string, options: ReadinessGatherOptions): Promise<GatheredChangeReadiness> {
  const changeRead = await settleRead('change', () => lookUpChange(changeNumber));
  if (!changeRead.isRead) {
    return { facts: buildUnreadFacts(options, `Could not find or read change ${changeNumber}.`), changeSysId: null, issueKeys: [] };
  }
  const { changeSysId, record, configItem, textFields } = changeRead.value;
  const issueKeys = findJiraKeysInChangeText(Object.values(textFields));
  const isRcpActive = isRcpPeriodActive(options.isRcpRulesEnabled, options.todayIso);
  const [rcpRead, ctaskRead, outageRead, prbRead] = await Promise.all([
    settleRead('rcpChecks', () => fetchRcpChangeFacts(changeSysId)),
    settleRead('ctasks', async () => (await fetchChangeTaskRecords(changeSysId)).map((taskRecord) => readReadinessCtask(taskRecord, configItem))),
    settleRead('outages', async () => (await fetchChangeOutages(changeSysId)).length),
    settleRead('prbs', async (): Promise<ReadinessPrb[]> => (issueKeys.length === 0 ? [] : (await scanIssuesForProblems(issueKeys))
      .map((row) => ({ prbNumber: row.prbNumber, linkStatus: readPrbLinkStatus(row, changeSysId) })))),
  ]);
  const rcpDerivedFacts = readRcpDerivedFacts(rcpRead, isRcpActive, options.todayIso);
  const failureReasons = collectFailureReasons([
    [['rcpChecks', 'environment', 'plannedWindow', 'attachments'], rcpRead],
    [['ctasks'], ctaskRead], [['outages'], outageRead], [['prbs'], prbRead],
  ], rcpDerivedFacts.attachmentFileNames, rcpRead.isRead);
  const facts: ChangeReadinessFacts = {
    change: record, textFields, riskReview: options.riskReview, isRcpActive, ...rcpDerivedFacts,
    outageCount: outageRead.isRead ? outageRead.value : null,
    ctasks: ctaskRead.isRead ? ctaskRead.value : null,
    prbs: prbRead.isRead ? prbRead.value : null,
    failureReasons,
  };
  return { facts, changeSysId, issueKeys };
}
