// buildSendPayload.ts — Pure helpers that shape a Reports Hub change-report into
// the payload sent to the Automation webhook, keeping the view declarative and the
// shaping logic unit-testable.

import type { ReportSurface } from '../../api/reportDelivery.ts';
import type { FeatureChangeEntry, ReportsHubTab, ScopeChangeEntry } from './hooks/useReportsHubState.ts';

/** Maps a Reports Hub tab to a deliverable surface id, or undefined if the tab is not deliverable. */
export function surfaceForTab(activeTab: ReportsHubTab): ReportSurface | undefined {
  if (activeTab === 'scopeChange') return 'scope-change';
  if (activeTab === 'featureChange') return 'feature-change';
  return undefined;
}

/** Splits scope-change entries into the documented { releaseChanges, sprintChanges } shape. */
export function buildScopeChangeSendPayload(entries: ScopeChangeEntry[]) {
  return {
    releaseChanges: entries.filter((entry) => entry.changeType === 'fixVersion'),
    sprintChanges: entries.filter((entry) => entry.changeType === 'sprint'),
  };
}

/** Wraps feature-change entries in the documented { featureChanges } shape. */
export function buildFeatureChangeSendPayload(entries: FeatureChangeEntry[]) {
  return { featureChanges: entries };
}
