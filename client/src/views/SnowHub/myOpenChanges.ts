// myOpenChanges.ts — The changes assigned to the signed-in ServiceNow user that are still active ("Load My Open Changes").
//
// The same read Modify CHG's "Load My Open Changes" makes (assigned_to is the current user, active=true), as one shared
// function so the SNow Wizard offers the identical list. Modify CHG and Release Management keep their own private
// copies of this query for now; they can move onto this one without any change in behaviour.

import { snowFetch } from '../../services/snowApi.ts';
import { extractStringValue } from './hooks/snowFieldValues.ts';

/** One of the user's open changes: its number and title. */
export interface MyOpenChange {
  changeNumber: string;
  shortDescription: string;
}

/** ServiceNow's own way to say "the signed-in user", so no user id is needed. */
export const MY_OPEN_CHANGES_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';
const MY_OPEN_CHANGES_FIELDS = 'number,short_description';
/** The same cap Modify CHG uses; nobody has more open changes than this. */
const MY_OPEN_CHANGES_LIMIT = 100;

/** The request path for the user's open changes, newest numbers first. */
export function buildMyOpenChangesPath(): string {
  return `/api/now/table/change_request?sysparm_query=${encodeURIComponent(`${MY_OPEN_CHANGES_QUERY}^ORDERBYDESCnumber`)}`
    + `&sysparm_limit=${MY_OPEN_CHANGES_LIMIT}&sysparm_fields=${MY_OPEN_CHANGES_FIELDS}&sysparm_display_value=all`;
}

/** The signed-in user's open changes. A failed read throws with ServiceNow's reason. */
export async function fetchMyOpenChanges(): Promise<MyOpenChange[]> {
  const reply = await snowFetch<{ result?: Array<Record<string, unknown>> }>(buildMyOpenChangesPath());
  return (reply?.result ?? [])
    .map((changeRecord) => ({ changeNumber: extractStringValue(changeRecord.number), shortDescription: extractStringValue(changeRecord.short_description) }))
    .filter((change) => change.changeNumber !== '');
}
