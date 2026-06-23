// TeamDashboardHygieneTab.tsx — Team-scoped adapter for embedding the shared Hygiene workspace in Team Dashboard.

import { useMemo } from 'react';

import HygieneView from '../Hygiene/HygieneView.tsx';

const PI_JQL_FIELD_ID = 'cf[10301]';
const SCOPE_MODE_PI = 'pi';
const SCOPE_MODE_FIX_VERSION = 'fixVersion';

interface TeamDashboardHygieneTabProps {
  projectKey: string;
  /** Active scope mode from the Sprint Dashboard — drives the auto-populated extra JQL. */
  scopeMode: string;
  /** Selected PI value when scopeMode is 'pi'. */
  selectedPiValue: string;
  /** Selected fix version name when scopeMode is 'fixVersion'. */
  selectedFixVersionName: string;
  /** Selected sprint ID when scopeMode is 'sprint'. */
  selectedSprintId: number | null;
}

/** Builds the JQL clause that scopes Hygiene to the same PI/sprint/fix-version as the rest of the dashboard. */
function buildScopeJql(
  scopeMode: string,
  selectedPiValue: string,
  selectedFixVersionName: string,
  selectedSprintId: number | null,
): string {
  if (scopeMode === SCOPE_MODE_PI && selectedPiValue) {
    return `AND ${PI_JQL_FIELD_ID} = "${selectedPiValue.replace(/"/g, '\\"')}"`;
  }
  if (scopeMode === SCOPE_MODE_FIX_VERSION && selectedFixVersionName) {
    return `AND fixVersion = "${selectedFixVersionName.replace(/"/g, '\\"')}"`;
  }
  if (selectedSprintId !== null) {
    return `AND sprint = ${selectedSprintId}`;
  }
  return '';
}

/** Seeds the shared Hygiene workspace from the active Team Dashboard project and scope so Hygiene opens in team context. */
export default function TeamDashboardHygieneTab({
  projectKey,
  scopeMode,
  selectedPiValue,
  selectedFixVersionName,
  selectedSprintId,
}: TeamDashboardHygieneTabProps) {
  const normalizedProjectKey = projectKey.trim().toUpperCase();

  const initialExtraJql = useMemo(
    () => buildScopeJql(scopeMode, selectedPiValue, selectedFixVersionName, selectedSprintId),
    [scopeMode, selectedPiValue, selectedFixVersionName, selectedSprintId],
  );

  // The project key flows through a prop (not localStorage) so switching teams immediately
  // re-scopes Hygiene to the new team. The keyed remount resets transient UI (filters, expanded rows).
  return (
    <HygieneView
      key={`${normalizedProjectKey || 'team-hygiene-unscoped'}:${initialExtraJql}`}
      projectKey={normalizedProjectKey}
      initialExtraJql={initialExtraJql}
      isTeamMode
    />
  );
}
