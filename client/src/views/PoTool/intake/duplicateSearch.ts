// duplicateSearch.ts — "Check DENP": looks each Enrollment work item up in the target project for an open Epic that
// already covers it, before anything new is created (spec 037, contracts/duplicate-search.md).
//
// The JQL builders and the named-key classifier are pure. `runDuplicateSearch` takes its Jira calls as injected
// dependencies so every outcome — found, not found, forbidden, failed — is proven without a real Jira.

import { extractHttpStatus, fetchIssueByKey } from '../../../services/issueLookup.ts';
import { getProjectIssueTypes, jiraGet } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueTypesResponse, JiraIssue } from '../../../types/jira.ts';
import { escapeJqlValue } from '../../../utils/jqlValue.ts';
import { buildIssueTextMatchTerms } from '../../../utils/jqlTextTerms.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { readFailureReason } from '../jira/runCommit.ts';
import {
  EPIC_ISSUE_TYPE_NAME,
  readItemDisplayTitle,
  readSettledValue,
  type DuplicateCandidate,
  type EpicIntake,
  type EpicTypeResolution,
  type IntakeItem,
  type NamedKey,
  type NamedKeyLookup,
} from './epicIntakeModel.ts';
import { isEnrollmentOwned, refreshApplicability, replaceIntakeItem, settleDecision } from './intakeChecklist.ts';

// ── Constants ──

/** The most Epics one item's search brings back. Enough to spot a duplicate; small enough to read. */
export const DUPLICATE_SEARCH_MAX_RESULTS = 20;

/** How much of a candidate Epic's description is kept for the PO and the matching request. */
export const DESCRIPTION_EXCERPT_MAX_CHARS = 400;

/** The fields each search and lookup needs to describe a candidate. */
const CANDIDATE_FIELDS = ['summary', 'status', 'description', 'issuetype'] as const;

/** A title word shorter than this is too common to search on ("ID", "UI"). */
const MIN_TITLE_TERM_LENGTH = 3;

/**
 * Words Jira's text index ignores. Searching on them either matches nothing or everything, so they are never used as
 * fallback terms taken from a title.
 */
const TITLE_STOP_WORDS = new Set([
  'and', 'are', 'but', 'for', 'into', 'not', 'such', 'that', 'the', 'their', 'then', 'there', 'these', 'they',
  'this', 'was', 'will', 'with',
]);

const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;

/** Jira's status-category key for finished work. */
const DONE_STATUS_CATEGORY_KEY = 'done';
const DONE_STATUS_NAME = 'done';

const TITLE_TERMS_REASON = 'Terms taken from the item title';
const EXCERPT_ELLIPSIS = '…';

// ── Dependencies ──

/** Runs one JQL search and returns the matching issues, with only the requested fields. */
export type SearchIssuesFunction = (jql: string, fields: readonly string[], maxResults: number) => Promise<JiraIssue[]>;

/** The Jira calls "Check DENP" makes, injected so tests can stand in for Jira. */
export interface DuplicateSearchDeps {
  getProjectIssueTypes: (projectKey: string) => Promise<CreateMetaIssueTypesResponse>;
  searchIssues: SearchIssuesFunction;
  fetchIssueByKey: (issueKey: string) => Promise<JiraIssue>;
  extractHttpStatus: (thrownError: unknown) => number | null;
}

/** Runs a JQL search through the shared Jira proxy, returning the issues found (none when Jira lists none). */
export async function searchJiraIssues(jql: string, fields: readonly string[], maxResults: number): Promise<JiraIssue[]> {
  const searchResponse = await jiraGet<{ issues?: JiraIssue[] }>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=${maxResults}`,
  );
  return searchResponse.issues ?? [];
}

/** The real Jira calls, for the Check DENP button. */
export function createDuplicateSearchDeps(): DuplicateSearchDeps {
  return { getProjectIssueTypes, searchIssues: searchJiraIssues, fetchIssueByKey, extractHttpStatus };
}

// ── JQL ──

/**
 * Builds the search for open Epics in the project matching any of the item's search phrases.
 *
 * Each phrase is its own `(summary ~ … OR description ~ …)` clause, OR-ed with the others, and the whole group is
 * wrapped in parentheses: without them `statusCategory != Done` binds only to the first phrase and closed Epics come
 * back. Phrases are stripped of Jira's reserved characters (a key and a colon would otherwise make Jira answer 400)
 * and get no wildcard, because they are finished phrases, not somebody still typing.
 *
 * Returns null when no phrase survives, so the caller can fall back to the title rather than run an empty search.
 */
export function buildDuplicateSearchJql(projectKey: string, epicTypeName: string, searchTerms: readonly string[]): string | null {
  const termClauses = searchTerms
    .map((searchTerm) => buildIssueTextMatchTerms(searchTerm, { shouldWildcardLastTerm: false }))
    .filter((matchTerms): matchTerms is string => matchTerms !== null)
    .map((matchTerms) => {
      const quotedTerms = escapeJqlValue(matchTerms);
      return `(summary ~ "${quotedTerms}" OR description ~ "${quotedTerms}")`;
    });
  if (termClauses.length === 0) {
    return null;
  }
  return `project = "${escapeJqlValue(projectKey)}" AND issuetype = "${escapeJqlValue(epicTypeName)}" `
    + `AND statusCategory != Done AND (${termClauses.join(' OR ')}) ORDER BY updated DESC`;
}

/** The fallback search words: the item title's words of three or more letters, minus words Jira ignores. */
function readTitleSearchTerms(item: IntakeItem): string[] {
  const sanitisedTitle = buildIssueTextMatchTerms(readItemDisplayTitle(item), { shouldWildcardLastTerm: false }) ?? '';
  const seenWords = new Set<string>();
  return sanitisedTitle.split(' ').filter((titleWord) => {
    const lowerWord = titleWord.toLowerCase();
    const isUsable = titleWord.length >= MIN_TITLE_TERM_LENGTH && !TITLE_STOP_WORDS.has(lowerWord) && !seenWords.has(lowerWord);
    seenWords.add(lowerWord);
    return isUsable;
  });
}

// ── Named keys ──

function isIssueDone(issue: JiraIssue): boolean {
  const status = issue.fields.status;
  return status?.statusCategory?.key === DONE_STATUS_CATEGORY_KEY || status?.name?.toLowerCase() === DONE_STATUS_NAME;
}

function classifyFailedLookup(httpStatus: number | null): NamedKeyLookup {
  if (httpStatus === HTTP_STATUS_NOT_FOUND) {
    return { status: 'unusable', reason: 'notFound', detail: 'Jira has no issue with this key.' };
  }
  if (httpStatus === HTTP_STATUS_UNAUTHORIZED || httpStatus === HTTP_STATUS_FORBIDDEN) {
    return { status: 'unusable', reason: 'noPermission', detail: 'You do not have permission to see this issue.' };
  }
  const detail = httpStatus === null ? 'Jira could not be reached.' : `Jira answered ${httpStatus}.`;
  return { status: 'unusable', reason: 'error', detail };
}

/**
 * Says what a key named in the notes turned out to be: an open Epic in the target project (which settles the
 * duplicate question on its own), or why it cannot be used — done, not an Epic, in another project, missing,
 * forbidden, or a lookup error. Pass the fetched issue, or null plus the HTTP status when the fetch failed.
 */
export function classifyNamedKeyLookup(
  issue: JiraIssue | null,
  httpStatus: number | null,
  targetProjectKey: string,
  epicTypeName: string,
): NamedKeyLookup {
  if (issue === null) {
    return classifyFailedLookup(httpStatus);
  }
  const issueProjectKey = issue.key.split('-')[0].toUpperCase();
  if (issueProjectKey !== targetProjectKey.toUpperCase()) {
    return { status: 'unusable', reason: 'otherProject', detail: `${issue.key} is in ${issueProjectKey}, not ${targetProjectKey}.` };
  }
  const issueTypeName = issue.fields.issuetype?.name ?? '';
  if (issueTypeName.toLowerCase() !== epicTypeName.toLowerCase()) {
    return { status: 'unusable', reason: 'notEpic', detail: `${issue.key} is a ${issueTypeName || 'non-Epic issue'}, not an ${epicTypeName}.` };
  }
  if (isIssueDone(issue)) {
    return { status: 'unusable', reason: 'done', detail: `${issue.key} is already done (${issue.fields.status?.name ?? 'Done'}).` };
  }
  return { status: 'openEpicInTarget', summary: issue.fields.summary };
}

// ── Epic type ──

/**
 * Looks up the project's Epic issue type live, giving both its id (for creating) and its name as this Jira spells it
 * (for searching). Never assumes a name: when the project has no Epic type the PO is told which types it does offer,
 * and nothing is searched or created.
 */
export async function resolveEpicType(
  projectKey: string,
  deps: Pick<DuplicateSearchDeps, 'getProjectIssueTypes'>,
): Promise<EpicTypeResolution> {
  try {
    const issueTypesResponse = await deps.getProjectIssueTypes(projectKey);
    const issueTypes = issueTypesResponse.values ?? [];
    const epicType = issueTypes.find(
      (issueType) => !issueType.subtask && issueType.name.toLowerCase() === EPIC_ISSUE_TYPE_NAME.toLowerCase(),
    );
    if (epicType === undefined) {
      return { state: 'missing', offeredTypeNames: issueTypes.filter((issueType) => !issueType.subtask).map((issueType) => issueType.name) };
    }
    return { state: 'resolved', id: epicType.id, name: epicType.name };
  } catch (thrownError) {
    return { state: 'error', reason: readFailureReason(thrownError) };
  }
}

/** Why nothing can be searched when the Epic type is not resolved, in words the PO can act on. */
function describeUnresolvedEpicType(projectKey: string, epicType: EpicTypeResolution): string {
  if (epicType.state === 'missing') {
    const offeredNames = epicType.offeredTypeNames.length > 0 ? epicType.offeredTypeNames.join(', ') : 'none';
    return `${projectKey} has no ${EPIC_ISSUE_TYPE_NAME} issue type (it offers: ${offeredNames}), so it was not checked.`;
  }
  const reason = epicType.state === 'error' ? epicType.reason : 'it was not looked up';
  return `Could not read ${projectKey}'s issue types (${reason}), so it was not checked.`;
}

// ── Candidates ──

function readDescriptionExcerpt(description: unknown): string {
  const plainText = normalizeRichTextToPlainText(description ?? '');
  if (plainText.length <= DESCRIPTION_EXCERPT_MAX_CHARS) {
    return plainText;
  }
  return `${plainText.slice(0, DESCRIPTION_EXCERPT_MAX_CHARS - EXCERPT_ELLIPSIS.length)}${EXCERPT_ELLIPSIS}`;
}

function buildCandidate(issue: JiraIssue, foundBy: DuplicateCandidate['foundBy']): DuplicateCandidate {
  return {
    key: issue.key,
    summary: issue.fields.summary ?? '',
    statusName: issue.fields.status?.name ?? '',
    statusCategory: issue.fields.status?.statusCategory?.key ?? '',
    descriptionExcerpt: readDescriptionExcerpt(issue.fields.description),
    foundBy,
  };
}

// ── Per item ──

/** What looking up every named key on one item found. */
interface NamedKeyOutcome {
  namedKeys: NamedKey[];
  openCandidates: DuplicateCandidate[];
  unusableNotes: string[];
  errorNotes: string[];
}

async function lookUpNamedKey(namedKey: NamedKey, intake: EpicIntake, epicTypeName: string, deps: DuplicateSearchDeps) {
  try {
    const issue = await deps.fetchIssueByKey(namedKey.key);
    return { issue, lookup: classifyNamedKeyLookup(issue, null, intake.targetProjectKey, epicTypeName) };
  } catch (thrownError) {
    const lookup = classifyNamedKeyLookup(null, deps.extractHttpStatus(thrownError), intake.targetProjectKey, epicTypeName);
    // A generic error keeps Jira's own words, which say more than a bare status code.
    const detailedLookup: NamedKeyLookup = lookup.status === 'unusable' && lookup.reason === 'error'
      ? { ...lookup, detail: readFailureReason(thrownError) }
      : lookup;
    return { issue: null, lookup: detailedLookup };
  }
}

async function lookUpNamedKeys(item: IntakeItem, intake: EpicIntake, epicTypeName: string, deps: DuplicateSearchDeps): Promise<NamedKeyOutcome> {
  const outcome: NamedKeyOutcome = { namedKeys: [], openCandidates: [], unusableNotes: [], errorNotes: [] };
  for (const namedKey of item.namedKeys) {
    const { issue, lookup } = await lookUpNamedKey(namedKey, intake, epicTypeName, deps);
    outcome.namedKeys.push({ ...namedKey, lookup });
    if (lookup.status === 'openEpicInTarget' && issue !== null) {
      outcome.openCandidates.push(buildCandidate(issue, 'namedKey'));
    } else if (lookup.status === 'unusable') {
      const note = `Notes name ${namedKey.key}, but ${lookup.detail}`;
      (lookup.reason === 'error' ? outcome.errorNotes : outcome.unusableNotes).push(note);
    }
  }
  return outcome;
}

function markSearchFailed(item: IntakeItem, reason: string): IntakeItem {
  return { ...item, searchStatus: 'failed', searchFailureReason: reason };
}

/** Settles the search terms from the title when nothing else has, and returns the terms the search will use. */
function settleSearchTerms(item: IntakeItem): { item: IntakeItem; searchTerms: string[] } {
  const settledTerms = readSettledValue(item.decisions.searchTerms);
  if (settledTerms !== null && settledTerms.length > 0) {
    return { item, searchTerms: settledTerms };
  }
  const titleTerms = readTitleSearchTerms(item);
  const searchTerms = item.decisions.searchTerms;
  const decisions = { ...item.decisions, searchTerms: settleDecision(searchTerms, titleTerms, 'rule', TITLE_TERMS_REASON) };
  return { item: { ...item, decisions }, searchTerms: titleTerms };
}

/** Exactly one open named Epic: that is the Epic, and no text search is needed. */
function settleExistingByNamedKey(item: IntakeItem, candidate: DuplicateCandidate): IntakeItem {
  const termedItem = settleSearchTerms(item).item;
  const verdict = { verdict: 'existing' as const, key: candidate.key };
  const duplicate = settleDecision(termedItem.decisions.duplicate, verdict, 'rule', `Notes name ${candidate.key}`);
  return {
    ...termedItem,
    candidates: [candidate],
    searchStatus: 'ok',
    searchFailureReason: null,
    decisions: { ...termedItem.decisions, duplicate },
  };
}

/** Runs the text search and records what it found, settling "create new" when a clean search finds nothing. */
async function searchByText(
  item: IntakeItem,
  intake: EpicIntake,
  epicTypeName: string,
  namedOutcome: NamedKeyOutcome,
  deps: DuplicateSearchDeps,
): Promise<IntakeItem> {
  const { item: termedItem, searchTerms } = settleSearchTerms(item);
  const searchJql = buildDuplicateSearchJql(intake.targetProjectKey, epicTypeName, searchTerms)
    ?? buildDuplicateSearchJql(intake.targetProjectKey, epicTypeName, readTitleSearchTerms(item));
  if (searchJql === null) {
    return markSearchFailed(item, 'No usable search words: give this item search terms, then check again.');
  }
  try {
    const foundIssues = await deps.searchIssues(searchJql, CANDIDATE_FIELDS, DUPLICATE_SEARCH_MAX_RESULTS);
    const namedCandidateKeys = new Set(namedOutcome.openCandidates.map((candidate) => candidate.key));
    const searchCandidates = foundIssues.filter((issue) => !namedCandidateKeys.has(issue.key)).map((issue) => buildCandidate(issue, 'search'));
    const candidates = [...namedOutcome.openCandidates, ...searchCandidates];
    const searchedItem: IntakeItem = { ...termedItem, candidates, searchStatus: 'ok', searchFailureReason: null };
    return settleOutcomeOfSearch(searchedItem, intake.targetProjectKey, searchTerms, namedOutcome);
  } catch (thrownError) {
    // The terms stay unsettled on a failure, so a better answer can still replace them before the next check.
    return markSearchFailed(item, readFailureReason(thrownError));
  }
}

/**
 * After a clean search: nothing found settles "create new". A key the notes named that cannot be used (done, not an
 * Epic, missing) is noted on the row for the summary rather than put to the PO — the PO only copies and pastes
 * (GH #387 feedback), so the assistant decides among what was found, and the note keeps the doubt visible.
 */
function settleOutcomeOfSearch(item: IntakeItem, projectKey: string, searchTerms: readonly string[], namedOutcome: NamedKeyOutcome): IntakeItem {
  const flaggedItem = namedOutcome.unusableNotes.length > 0
    ? { ...item, reviewFlag: `Named key not used: ${namedOutcome.unusableNotes.join(' ')}` }
    : item;
  if (flaggedItem.candidates.length > 0) {
    return flaggedItem;
  }
  const reason = `No open ${projectKey} Epic matched "${searchTerms.join(', ')}"`;
  const duplicate = settleDecision(flaggedItem.decisions.duplicate, { verdict: 'createNew' as const }, 'rule', reason);
  return { ...flaggedItem, decisions: { ...flaggedItem.decisions, duplicate } };
}

async function searchOneItem(item: IntakeItem, intake: EpicIntake, epicTypeName: string, deps: DuplicateSearchDeps): Promise<IntakeItem> {
  const namedOutcome = await lookUpNamedKeys(item, intake, epicTypeName, deps);
  const lookedUpItem: IntakeItem = { ...item, namedKeys: namedOutcome.namedKeys, candidates: [] };
  if (namedOutcome.errorNotes.length > 0) {
    return markSearchFailed(lookedUpItem, namedOutcome.errorNotes.join(' '));
  }
  if (namedOutcome.openCandidates.length === 1) {
    return settleExistingByNamedKey(lookedUpItem, namedOutcome.openCandidates[0]);
  }
  return searchByText(lookedUpItem, intake, epicTypeName, namedOutcome, deps);
}

// ── The run ──

/** True for Enrollment work whose duplicate question is still open and whose search has not already succeeded. */
function isItemEligibleForSearch(item: IntakeItem): boolean {
  return readSettledValue(item.decisions.kind) === 'work'
    && isEnrollmentOwned(readSettledValue(item.decisions.owner))
    && item.decisions.duplicate.state === 'open'
    && item.searchStatus !== 'ok';
}

function blockEligibleItems(intake: EpicIntake, reason: string): EpicIntake {
  return {
    ...intake,
    items: intake.items.map((item) => (isItemEligibleForSearch(item) ? markSearchFailed(item, reason) : item)),
  };
}

/**
 * Checks the target project for open Epics that already cover each Enrollment work item, one item at a time.
 *
 * Keys the notes name are looked up individually first: exactly one open Epic settles the question, and a key that
 * cannot be used (done, not an Epic, missing, forbidden) is put to the PO. Then the item's search phrases — or its
 * title's words — are searched. A clean search that finds nothing settles "create new"; a failed one blocks the item
 * from being created until it is checked again. `onProgress` receives the intake after every item, so it can be saved
 * and a closed tab loses at most one item's search.
 */
export async function runDuplicateSearch(
  intake: EpicIntake,
  deps: DuplicateSearchDeps,
  onProgress?: (intake: EpicIntake) => void,
): Promise<EpicIntake> {
  const epicType = intake.epicType.state === 'resolved' ? intake.epicType : await resolveEpicType(intake.targetProjectKey, deps);
  let workingIntake: EpicIntake = { ...intake, epicType };
  if (epicType.state !== 'resolved') {
    workingIntake = blockEligibleItems(workingIntake, describeUnresolvedEpicType(intake.targetProjectKey, epicType));
    onProgress?.(workingIntake);
    return workingIntake;
  }
  for (const item of intake.items.filter(isItemEligibleForSearch)) {
    const searchedItem = refreshApplicability(await searchOneItem(item, workingIntake, epicType.name, deps));
    workingIntake = replaceIntakeItem(workingIntake, searchedItem);
    onProgress?.(workingIntake);
  }
  return workingIntake;
}
