// teamHygieneScope.ts — Builds the JQL clause that scopes a team hygiene scan to the team's
// active PI / sprint / fix-version selection.
//
// This is the single source of the team scope clause: the Team Dashboard's embedded Hygiene tab
// AND the Today dashboard's team cards both build their scan scope here, so the two surfaces
// always audit the same set of issues (GH #177 — different scopes made their numbers disagree).

import { buildJqlFieldReference, readConfiguredPiFieldId } from '../Hygiene/checks/hygieneFieldConfig.ts';

const SCOPE_MODE_PI = 'pi';
const SCOPE_MODE_FIX_VERSION = 'fixVersion';

/** The team scope selection a hygiene scan needs, as held by the sprint dashboard state. */
export interface TeamHygieneScopeSelection {
  /** Active scope mode from the Sprint Dashboard — drives which clause is built. */
  scopeMode: string;
  /** Selected PI value when scopeMode is 'pi'. */
  selectedPiValue: string;
  /** Selected fix version name when scopeMode is 'fixVersion'. */
  selectedFixVersionName: string;
  /** Selected sprint ID when scopeMode is 'sprint'. */
  selectedSprintId: number | null;
}

/** Builds the JQL clause that scopes a hygiene scan to the same PI/sprint/fix-version as the dashboard. */
export function buildTeamHygieneScopeJql(selection: TeamHygieneScopeSelection): string {
  const { scopeMode, selectedPiValue, selectedFixVersionName, selectedSprintId } = selection;
  if (scopeMode === SCOPE_MODE_PI && selectedPiValue) {
    // Derived from the ART-configured PI field, never hardcoded: a team whose PI lives in a
    // different custom field would otherwise get an empty scope that rendered as a perfect
    // hygiene score (GH #167). Defaults to cf[10301] when nothing is configured.
    const piJqlFieldReference = buildJqlFieldReference(readConfiguredPiFieldId());
    return `AND ${piJqlFieldReference} = "${selectedPiValue.replace(/"/g, '\\"')}"`;
  }
  if (scopeMode === SCOPE_MODE_FIX_VERSION && selectedFixVersionName) {
    return `AND fixVersion = "${selectedFixVersionName.replace(/"/g, '\\"')}"`;
  }
  if (selectedSprintId !== null) {
    return `AND sprint = ${selectedSprintId}`;
  }
  return '';
}
