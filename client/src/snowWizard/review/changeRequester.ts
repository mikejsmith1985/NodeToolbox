// changeRequester.ts — Reads who asked for a change (name and email), so the Review job can address its coaching note.
//
// Custom (Art VII): the shared readiness gatherer reads the change's owner, not its requester's email, and no Toolbox
// reader returns that email; this is one read through Toolbox's own snowApi.

import { snowFetch } from '../../services/snowApi.ts';

/** The person a coaching note is addressed to; blanks when unknown. */
export interface ChangeRequester {
  name: string;
  email: string;
}

const CHANGE_TABLE_PATH = '/api/now/table/change_request';
// The requester first; whoever opened the change when no requester is set.
const REQUESTER_FIELDS = ['requested_by.name', 'requested_by.email', 'opened_by.name', 'opened_by.email'];
const UNKNOWN_REQUESTER: ChangeRequester = { name: '', email: '' };

function readText(changeRecord: Readonly<Record<string, unknown>>, fieldName: string): string {
  const fieldValue = changeRecord[fieldName];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
}

/** Reads the requester of a change by its number. Never throws: a failed or empty read answers blanks. */
export async function readChangeRequester(changeNumber: string): Promise<ChangeRequester> {
  const changeQuery = encodeURIComponent(`number=${changeNumber.trim()}`);
  try {
    const reply = await snowFetch<{ result?: unknown }>(
      `${CHANGE_TABLE_PATH}?sysparm_query=${changeQuery}&sysparm_limit=1&sysparm_fields=${REQUESTER_FIELDS.join(',')}`,
      { method: 'GET' },
    );
    const changeRecord = Array.isArray(reply?.result) ? reply.result[0] : undefined;
    if (typeof changeRecord !== 'object' || changeRecord === null) return UNKNOWN_REQUESTER;
    const record = changeRecord as Record<string, unknown>;
    const hasRequester = readText(record, 'requested_by.name') !== '';
    const personPrefix = hasRequester ? 'requested_by' : 'opened_by';
    return { name: readText(record, `${personPrefix}.name`), email: readText(record, `${personPrefix}.email`) };
  } catch {
    return UNKNOWN_REQUESTER;
  }
}
