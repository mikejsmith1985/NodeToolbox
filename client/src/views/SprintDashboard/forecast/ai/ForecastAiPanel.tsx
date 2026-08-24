// ForecastAiPanel.tsx — Three propose-only narratives over the figures the engine already computed.
//
// A thin wrapper. The gate, the copy button, the paste box and the "renders nothing when locked"
// behaviour all belong to ReportAiPanel and are not reimplemented here — a second gate is a second
// thing that can be wrong about whether AI is unlocked.
//
// Nothing here writes to Jira, so ReportAiPanel's default advisory wording is accurate and is left
// alone. Accepting an item copies its narrative into this panel's own display state and no further.

import { useState } from 'react';

import { ReportAiPanel } from '../../../ReportsHub/ReportAiPanel.tsx';
import {
  buildForecastDailyPrompt,
  buildScopeCutPrompt,
  buildTestCapacityPrompt,
  parseForecastAiReply,
  type ForecastAiItem,
  type ForecastAiKind,
} from './forecastAiAssist.ts';
import type { ScopeCutPlan } from '../scopeCut.ts';
import type { CapacityAssessment, ForecastResult } from '../forecastTypes.ts';
import styles from '../../SprintDashboardView.module.css';

/** The three narratives, in the order a Scrum Master would reach for them. */
const NARRATIVES: Array<{ kind: ForecastAiKind; title: string; ingestLabel: string }> = [
  { kind: 'forecastDaily', title: 'Daily forecast narrative', ingestLabel: 'Ingest narrative' },
  { kind: 'forecastScopeCut', title: 'Scope-cut recommendation', ingestLabel: 'Ingest recommendation' },
  { kind: 'forecastTestCapacity', title: 'Test-capacity mitigation', ingestLabel: 'Ingest mitigation' },
];

export interface ForecastAiPanelProps {
  forecast: ForecastResult;
  /** The code-freeze assessment for the chosen release, when one is chosen. */
  codeFreezeAssessment?: CapacityAssessment | null;
  /** The external-test assessment for the chosen release, when one is chosen. */
  externalTestAssessment?: CapacityAssessment | null;
  /**
   * The ranked drop proposal, when the release does not fit.
   *
   * Passed IN rather than asked for: the order comes from the team's own board ranks, and a model
   * re-deriving it would be inventing a priority nobody gave it.
   */
  scopeCutPlan?: ScopeCutPlan | null;
}

/** Builds the prompt for one narrative, or explains why there is nothing to ask about yet. */
function buildPrompt(
  kind: ForecastAiKind,
  forecast: ForecastResult,
  codeFreezeAssessment: CapacityAssessment | null,
  externalTestAssessment: CapacityAssessment | null,
  scopeCutPlan: ScopeCutPlan | null,
): string {
  if (kind === 'forecastDaily') {
    return buildForecastDailyPrompt(forecast);
  }
  if (kind === 'forecastScopeCut') {
    return codeFreezeAssessment === null
      ? 'Pick a fix version first — there is no release to recommend scope cuts for.'
      : buildScopeCutPrompt(codeFreezeAssessment, forecast.issueForecasts, scopeCutPlan);
  }
  return externalTestAssessment === null
    ? 'Pick a fix version first — there is no test window to mitigate.'
    : buildTestCapacityPrompt(externalTestAssessment, forecast.issueForecasts);
}

/** One narrative: its prompt, its paste box, and whatever came back. */
function NarrativeSection({
  kind,
  title,
  ingestLabel,
  prompt,
  allowedIssueKeys,
  allowedPersonKeys,
}: {
  kind: ForecastAiKind;
  title: string;
  ingestLabel: string;
  prompt: string;
  allowedIssueKeys: string[];
  allowedPersonKeys: string[];
}) {
  const [items, setItems] = useState<ForecastAiItem[]>([]);
  const [rejectedItems, setRejectedItems] = useState<Array<{ id: string; reason: string }>>([]);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleIngest(replyText: string): void {
    try {
      const ingest = parseForecastAiReply(replyText, kind, allowedIssueKeys, allowedPersonKeys);
      setItems(ingest.items);
      setRejectedItems(ingest.rejectedItems);
      setError(null);
    } catch (caughtError) {
      // Previously accepted items are kept: a bad paste should not undo work already reviewed.
      setError(caughtError instanceof Error ? caughtError.message : 'Could not read that reply.');
    }
  }

  return (
    <ReportAiPanel
      title={title}
      prompt={prompt}
      ingestLabel={ingestLabel}
      onIngest={handleIngest}
      error={error}
    >
      {rejectedItems.length > 0 && (
        // Named, never dropped. A reply that silently lost half its content is worse than one that
        // plainly failed, because nobody would know to look for the missing half.
        <ul className={styles.forecastNoteList} role="status">
          {rejectedItems.map((rejected) => (
            <li key={rejected.id}>{`Rejected ${rejected.id} — it ${rejected.reason}.`}</li>
          ))}
        </ul>
      )}

      {items.map((item) => (
        <section className={styles.forecastSection} key={item.id}>
          <h5 className={styles.forecastSectionTitle}>{item.headline}</h5>
          <p className={styles.forecastSectionNote}>{item.narrative}</p>
          {item.issueKeys.length > 0 && (
            <p className={styles.forecastSectionNote}>{item.issueKeys.join(', ')}</p>
          )}
          <button
            className={styles.actionButton}
            disabled={acceptedIds.includes(item.id)}
            onClick={() => setAcceptedIds((previous) => [...previous, item.id])}
            type="button"
          >
            {acceptedIds.includes(item.id) ? '✓ Accepted' : 'Accept'}
          </button>
        </section>
      ))}
    </ReportAiPanel>
  );
}

/** Renders the three gated narratives, or nothing at all when AI Assist is locked. */
export function ForecastAiPanel({
  forecast,
  codeFreezeAssessment = null,
  externalTestAssessment = null,
  scopeCutPlan = null,
}: ForecastAiPanelProps) {
  // Only what the prompt actually named may come back. Everything else is rejected on ingest.
  const allowedIssueKeys = forecast.issueForecasts.map((issueForecast) => issueForecast.issueKey);
  const allowedPersonKeys = [...new Set([
    ...forecast.issueForecasts
      .map((issueForecast) => issueForecast.assigneeDisplayName)
      .filter((displayName): displayName is string => displayName !== null),
    ...(codeFreezeAssessment?.personLoads ?? []).map((load) => load.displayName),
    ...(externalTestAssessment?.personLoads ?? []).map((load) => load.displayName),
    // The PI load table, which the daily prompt now carries. Without it, a reply that named a
    // rostered person with spare capacity was rejected for naming somebody the prompt never did —
    // so the one narrative that is ABOUT who has room could not mention them (GH #375).
    ...(forecast.piCapacity?.personLoads ?? []).map((load) => load.displayName),
  ])];

  return (
    <>
      {NARRATIVES.map((narrative) => (
        <NarrativeSection
          key={narrative.kind}
          kind={narrative.kind}
          title={narrative.title}
          ingestLabel={narrative.ingestLabel}
          prompt={buildPrompt(narrative.kind, forecast, codeFreezeAssessment, externalTestAssessment, scopeCutPlan)}
          allowedIssueKeys={allowedIssueKeys}
          allowedPersonKeys={allowedPersonKeys}
        />
      ))}
    </>
  );
}
