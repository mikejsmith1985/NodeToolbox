// prbLookups.ts — The reads the problem job needs: find a ServiceNow problem, list Jira projects, find an open Epic,
// and remember the project last chosen.
//
// Framework-first: reads go through Toolbox's own snowFetch and jiraGet. The problem search is custom because
// Toolbox's PRB reader (usePrbState) is private to its hook and only looks one number up — it cannot search words.

import { jiraGet } from '../../services/jiraApi.ts';
import { snowFetch } from '../../services/snowApi.ts';
import type { JiraProject } from '../../types/jira.ts';
import { buildIssueTextMatchTerms } from '../../utils/jqlTextTerms.ts';
import { escapeJqlValue } from '../../utils/jqlValue.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import { DEFAULT_SNOW_URL } from '../wizardDefaults.ts';

// ── Types ──

/** One ServiceNow problem as the job shows it. */
export interface PrbSearchResult {
  sysId: string;
  number: string;
  shortDescription: string;
  description: string;
  stateLabel: string;
}

/** One open Epic the work can go on. */
export interface EpicSearchResult {
  key: string;
  summary: string;
  statusName: string;
}

// ── Constants ──

/** Where the last chosen Jira project is remembered. */
export const PRB_PROJECT_STORAGE_KEY = 'snowWizard:prbProject';

const PROBLEM_TABLE_PATH = '/api/now/table/problem';
const PROBLEM_FIELDS = 'sys_id,number,short_description,description,state';
const PROBLEM_SEARCH_LIMIT = 15;
const EPIC_SEARCH_LIMIT = 20;
const PRB_NUMBER_PATTERN = /^PRB\d+$/i;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/i;
// "^" separates conditions in a ServiceNow query, so it can never be part of the searched words.
const SNOW_QUERY_SEPARATOR_PATTERN = /\^/g;
const WEB_ORIGIN_PATTERN = /^https?:\/\//;

// ── ServiceNow ──

function readDisplayText(fieldValue: unknown): string {
  if (typeof fieldValue === 'string') return fieldValue;
  if (typeof fieldValue !== 'object' || fieldValue === null) return '';
  const tableField = fieldValue as { display_value?: unknown; value?: unknown };
  return String(tableField.display_value ?? tableField.value ?? '');
}

function buildProblemQuery(searchText: string): string {
  if (PRB_NUMBER_PATTERN.test(searchText)) return `number=${searchText.toUpperCase()}`;
  const safeWords = searchText.replace(SNOW_QUERY_SEPARATOR_PATTERN, ' ');
  return `numberLIKE${safeWords}^ORshort_descriptionLIKE${safeWords}^ORDERBYDESCsys_updated_on`;
}

/** Finds problems by exact number (e.g. PRB0012345) or by words in their number or short description. */
export async function searchProblems(searchText: string): Promise<PrbSearchResult[]> {
  const trimmedText = searchText.trim();
  if (trimmedText === '') return [];
  const query = encodeURIComponent(buildProblemQuery(trimmedText));
  const reply = await snowFetch<{ result?: Array<Record<string, unknown>> }>(
    `${PROBLEM_TABLE_PATH}?sysparm_query=${query}&sysparm_limit=${PROBLEM_SEARCH_LIMIT}&sysparm_fields=${PROBLEM_FIELDS}&sysparm_display_value=all`,
  );
  return (reply?.result ?? []).map((problemRecord) => ({
    sysId: readDisplayText(problemRecord.sys_id),
    number: readDisplayText(problemRecord.number),
    shortDescription: readDisplayText(problemRecord.short_description),
    description: normalizeRichTextToPlainText(readDisplayText(problemRecord.description)),
    stateLabel: readDisplayText(problemRecord.state),
  }));
}

/**
 * The ServiceNow address links should point at. The Wizard runs inside ServiceNow, so its own origin is the
 * instance; anywhere else (a test, a file page) falls back to the built-in address.
 */
export function readSnowInstanceOrigin(pageOrigin: string = window.location.origin): string {
  return WEB_ORIGIN_PATTERN.test(pageOrigin) ? pageOrigin : DEFAULT_SNOW_URL;
}

// ── Jira ──

/** Every Jira project the user can see, sorted by name, for the project list. */
export async function loadJiraProjects(): Promise<JiraProject[]> {
  const projects = await jiraGet<JiraProject[]>('/rest/api/2/project');
  return [...(projects ?? [])].sort((first, second) => first.name.localeCompare(second.name));
}

function buildEpicJql(searchText: string): string | null {
  if (ISSUE_KEY_PATTERN.test(searchText)) return `key = "${escapeJqlValue(searchText.toUpperCase())}" AND issuetype = Epic`;
  const matchTerms = buildIssueTextMatchTerms(searchText);
  if (matchTerms === null) return null;
  return `issuetype = Epic AND statusCategory != Done AND summary ~ "${escapeJqlValue(matchTerms)}" ORDER BY updated DESC`;
}

/** Finds open Epics by words in their name, or one Epic by its key. Nothing usable typed ⇒ no search. */
export async function searchOpenEpics(searchText: string): Promise<EpicSearchResult[]> {
  const jql = buildEpicJql(searchText.trim());
  if (jql === null) return [];
  const reply = await jiraGet<{ issues?: Array<{ key: string; fields?: { summary?: string; status?: { name?: string } } }> }>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=${EPIC_SEARCH_LIMIT}`,
  );
  return (reply?.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary ?? '',
    statusName: issue.fields?.status?.name ?? '',
  }));
}

// ── Remembered project ──

/** The project last chosen for problem work, or empty when none (or the browser refuses storage). */
export function readRememberedPrbProject(): string {
  try {
    return localStorage.getItem(PRB_PROJECT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Remembers the chosen project so it is the default next time. */
export function rememberPrbProject(projectKey: string): void {
  try {
    localStorage.setItem(PRB_PROJECT_STORAGE_KEY, projectKey);
  } catch {
    // A browser that refuses storage simply asks again next time.
  }
}
