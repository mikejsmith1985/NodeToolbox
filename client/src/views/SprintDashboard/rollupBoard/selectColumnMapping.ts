// selectColumnMapping.ts — Which of a column's claimed states a drop should actually write.
//
// A column may claim several Jira states: "Accepted/Done" on a real board claims both Accepted and
// Done and holds 106 issues. The drop path took `mappings[0]` and wrote that one, always — which is
// fine while a column claims one state and wrong the moment it claims two. Dragging a Done issue
// into its own column tried to move it to Accepted; where the workflow offers no such transition the
// move simply failed, and the reason came back in Jira's words about a transition rather than in
// terms of anything the person had done.
//
// The choice is made from what Jira says the issue can actually do, in a deliberate order:
//
//   1. a state the column claims that the issue is ALREADY in — no status change is needed at all
//   2. the first claimed state the workflow can actually reach from here
//   3. neither — refused, naming what the column claims and what Jira offered instead
//
// Rule 1 matters more than it looks. Dropping a card into the column it already sits in is how you
// change only its SUB-status, and re-writing the status underneath it would be a pointless write
// that can fail on its own.

import type { ColumnStatusMapping } from './rollupBoardTypes.ts';

/** What a drop should do about the target column's claimed states. */
export type ColumnMappingChoice =
  | { kind: 'write'; mapping: ColumnStatusMapping }
  | { kind: 'refused'; reason: string };

/** Compares status names the way Jira does: case- and whitespace-insensitively. */
function normalizeStatusName(statusName: string): string {
  return String(statusName ?? '').trim().toLowerCase();
}

/**
 * Picks the state to write when a card is dropped into a column.
 *
 * `reachableStatusNames` is the set of statuses the issue's own transitions lead to. Pass an empty
 * list only when they could not be read — a column claiming ONE state still writes it, because
 * refusing a move on the strength of a failed lookup would make an unreadable transition list look
 * like a workflow rule.
 */
export function selectColumnMapping(
  columnMappings: readonly ColumnStatusMapping[],
  currentStatusName: string,
  reachableStatusNames: readonly string[],
  columnName: string,
): ColumnMappingChoice {
  const mappings = columnMappings ?? [];
  if (mappings.length === 0) {
    return { kind: 'refused', reason: `“${columnName}” does not claim any Jira status yet, so there is nothing to write.` };
  }

  // 1. Already in a state this column claims: keep it, and let the sub-status be the only change.
  const currentName = normalizeStatusName(currentStatusName);
  const alreadyHere = mappings.find((mapping) => normalizeStatusName(mapping.jiraStatusName) === currentName);
  if (alreadyHere) return { kind: 'write', mapping: alreadyHere };

  // A single-claim column is unambiguous, so it never needs the transition list to decide.
  if (mappings.length === 1) return { kind: 'write', mapping: mappings[0] };

  const reachable = new Set((reachableStatusNames ?? []).map(normalizeStatusName));
  if (reachable.size === 0) return { kind: 'write', mapping: mappings[0] };

  // 2. The first claimed state the workflow can actually reach. The team named this column for
  //    several states on purpose — any of them is a correct landing place — so the first reachable
  //    one is chosen rather than asking a question on every drag.
  const reachableMapping = mappings.find((mapping) => reachable.has(normalizeStatusName(mapping.jiraStatusName)));
  if (reachableMapping) return { kind: 'write', mapping: reachableMapping };

  // 3. Neither. Said in terms of this board and this workflow, not as a Jira transition error.
  const claimedNames = mappings.map((mapping) => mapping.jiraStatusName).join(' or ');
  const offeredNames = [...new Set(reachableStatusNames)].join(', ');
  return {
    kind: 'refused',
    reason: `“${columnName}” claims ${claimedNames}, and this issue's workflow offers none of them from`
      + ` ${currentStatusName}.`
      + (offeredNames === '' ? ' Jira offers no transitions at all from here.' : ` It offers: ${offeredNames}.`),
  };
}
