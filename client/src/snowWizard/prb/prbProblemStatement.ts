// prbProblemStatement.ts — Puts the Defect's Jira key on the end of the ServiceNow problem's Problem statement
// ("… Post Deploy Fix Needed - ENFCT-2175", GH #475), so anyone opening the problem sees which Defect fixes it.
//
// Framework-first: the read and the write go through Toolbox's own snowFetch, the same call every other Wizard
// ServiceNow write uses. What is custom is only the "already there?" check that keeps a retry from adding it twice.

import { snowFetch } from '../../services/snowApi.ts';

/** What sits between the problem's own words and the Defect key (owner's format, GH #475). */
export const DEFECT_KEY_SEPARATOR = ' - ';

const PROBLEM_TABLE_PATH = '/api/now/table/problem';
/** The Problem statement is the problem's short description in ServiceNow's table. */
const STATEMENT_FIELD = 'short_description';

function escapeForPattern(plainText: string): string {
  return plainText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the statement already names the key as a whole word (ENFCT-217 is not ENFCT-2175). */
export function statementHasDefectKey(statement: string, defectKey: string): boolean {
  if (defectKey.trim() === '') return false;
  return new RegExp(`(^|[^A-Z0-9-])${escapeForPattern(defectKey.trim())}(?![0-9])`, 'i').test(statement);
}

/** The statement with " - <key>" on the end, or unchanged when it already names the key. */
export function appendDefectKey(statement: string, defectKey: string): string {
  if (statementHasDefectKey(statement, defectKey)) return statement;
  const trimmedStatement = statement.trimEnd();
  return trimmedStatement === '' ? defectKey : `${trimmedStatement}${DEFECT_KEY_SEPARATOR}${defectKey}`;
}

async function readCurrentStatement(problemSysId: string): Promise<string> {
  const reply = await snowFetch<{ result?: { short_description?: string } }>(
    `${PROBLEM_TABLE_PATH}/${encodeURIComponent(problemSysId)}?sysparm_fields=${STATEMENT_FIELD}`,
  );
  return reply?.result?.short_description ?? '';
}

/**
 * Adds " - <defect key>" to the problem's Problem statement. It reads the statement fresh first, so words someone
 * changed since the search are kept, and writes nothing when the key is already there. Returns the statement as saved.
 */
export async function stampDefectKeyOnProblem(problemSysId: string, defectKey: string): Promise<string> {
  const currentStatement = await readCurrentStatement(problemSysId);
  const stampedStatement = appendDefectKey(currentStatement, defectKey);
  if (stampedStatement === currentStatement) return currentStatement;
  await snowFetch(`${PROBLEM_TABLE_PATH}/${encodeURIComponent(problemSysId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [STATEMENT_FIELD]: stampedStatement }),
  });
  return stampedStatement;
}
