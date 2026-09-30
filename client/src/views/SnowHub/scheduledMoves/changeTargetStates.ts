// changeTargetStates.ts — Which states a change can be booked to move to.
//
// Kept apart from ScheduledMovesSection.tsx so that file exports only its component (a component file
// that also exports helpers breaks fast refresh).

import { ALL_CHG_STATES, CHG_STATE_TRANSITIONS } from '../hooks/useReleaseManagement.ts';

/**
 * The states the selected change can be moved to.
 *
 * ServiceNow's own transition map is the source, so the list offered is the list that will actually
 * be accepted; a change in an unmapped state falls back to the full set rather than to nothing.
 */
export function listTargetStatesForChange(currentStateValue: string): { value: string; label: string }[] {
  const mappedTransitions = CHG_STATE_TRANSITIONS[currentStateValue];
  if (mappedTransitions && mappedTransitions.length > 0) {
    return mappedTransitions.map((transition) => ({ value: transition.value, label: transition.label }));
  }
  return ALL_CHG_STATES.map((changeState) => ({ value: changeState.value, label: changeState.label }));
}
