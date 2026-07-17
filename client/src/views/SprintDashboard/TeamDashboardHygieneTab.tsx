// TeamDashboardHygieneTab.tsx — Team-scoped adapter for embedding the shared Hygiene workspace in Team Dashboard.

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import HygieneView from '../Hygiene/HygieneView.tsx';
import { buildTeamHygieneScopeJql } from './teamHygieneScope.ts';

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

/** Seeds the shared Hygiene workspace from the active Team Dashboard project and scope so Hygiene opens in team context. */
export default function TeamDashboardHygieneTab({
  projectKey,
  scopeMode,
  selectedPiValue,
  selectedFixVersionName,
  selectedSprintId,
}: TeamDashboardHygieneTabProps) {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  // A Today-card drill-through arrives with ?hygieneFilter=<checkIds> so the tab opens showing
  // exactly the issues that card counted — three team cards used to land on one identical
  // unfiltered view with a number matching none of them (GH #177).
  const [searchParams] = useSearchParams();
  const deepLinkedFilter = searchParams.get('hygieneFilter') ?? undefined;

  const initialExtraJql = useMemo(
    () => buildTeamHygieneScopeJql({ scopeMode, selectedPiValue, selectedFixVersionName, selectedSprintId }),
    [scopeMode, selectedPiValue, selectedFixVersionName, selectedSprintId],
  );

  // The project key flows through a prop (not localStorage) so switching teams immediately
  // re-scopes Hygiene to the new team. The keyed remount resets transient UI (filters, expanded rows).
  return (
    <HygieneView
      key={`${normalizedProjectKey || 'team-hygiene-unscoped'}:${initialExtraJql}:${deepLinkedFilter ?? ''}`}
      projectKey={normalizedProjectKey}
      initialExtraJql={initialExtraJql}
      initialFilter={deepLinkedFilter}
      isTeamMode
    />
  );
}
