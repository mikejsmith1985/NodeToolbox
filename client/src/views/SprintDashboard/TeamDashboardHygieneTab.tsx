// TeamDashboardHygieneTab.tsx — Team-scoped adapter for embedding the shared Hygiene workspace in Team Dashboard.

import { useEffect } from 'react';

import HygieneView from '../Hygiene/HygieneView.tsx';
import { HYGIENE_PROJECT_KEY_STORAGE_KEY } from '../Hygiene/hooks/useHygieneState.ts';

interface TeamDashboardHygieneTabProps {
  projectKey: string;
}

/** Seeds the shared Hygiene workspace from the active Team Dashboard project so Hygiene opens in team context. */
export default function TeamDashboardHygieneTab({ projectKey }: TeamDashboardHygieneTabProps) {
  const normalizedProjectKey = projectKey.trim().toUpperCase();

  useEffect(() => {
    if (!normalizedProjectKey) {
      return;
    }

    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, normalizedProjectKey);
  }, [normalizedProjectKey]);

  return <HygieneView key={normalizedProjectKey || 'team-hygiene-unscoped'} isTeamMode />;
}
