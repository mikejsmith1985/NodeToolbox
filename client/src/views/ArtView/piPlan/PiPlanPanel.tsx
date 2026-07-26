// PiPlanPanel.tsx — The PI planner surface (spec 028, US1). Gated by the shared ReportAiPanel (which
// renders nothing until AI Assist is unlocked), it shows the assembled prompt, ingests a {kind:'piPlan'}
// reply, runs the deterministic engine, and renders the reviewable proposal + capacity map. Nothing
// writes to Jira until the operator accepts an item (propose-only, FR-052).

import React, { useState } from 'react';

import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx';
import type { PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import { buildPiPlanAiPrompt, parsePiPlanAiReply } from './piPlanAiAssist.ts';
import type { PiPlanPromptContext } from './piPlanAiAssist.ts';
import { applyBreakdownSuggestion } from './piPlanAiApply.ts';
import { buildPiPlanProposal } from './piPlanEngine.ts';
import { PiPlanCapacityMap } from './PiPlanCapacityMap.tsx';
import { PlanProposalTable } from './PlanProposalTable.tsx';
import type {
  FeatureInput,
  PlanItemProposal,
  PlanProposal,
  ReleaseSchedule,
  StorySuggestion,
  WorkingCalendar,
} from './piPlanTypes.ts';

/** Everything the panel needs to build the prompt, run the engine, and write accepted items. */
export interface PiPlanPanelProps {
  promptContext: PiPlanPromptContext;
  features: FeatureInput[];
  people: PersonCapacity[];
  releaseSchedule: ReleaseSchedule;
  workingCalendar: WorkingCalendar;
  piName: string;
  piStartIso: string;
  piEndIso: string;
  sprintLengthDays?: number;
  todayIso: string;
  /** Writes one accepted Story (+ its sub-tasks) to Jira. Injected so tests never touch the network. */
  onApplyStory: (item: PlanItemProposal) => Promise<void>;
}

/** The PI planner panel: prompt → ingest → deterministic proposal → per-item accept → Jira write. */
export function PiPlanPanel(props: PiPlanPanelProps): React.ReactElement {
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const prompt = buildPiPlanAiPrompt(props.promptContext);
  const knownFeatureKeys = props.features.map((feature) => feature.key);

  function handleIngest(responseText: string): void {
    try {
      const parsed = parsePiPlanAiReply(responseText, knownFeatureKeys);
      const acceptedByFeature: Record<string, StorySuggestion[]> = {};
      parsed.suggestions.forEach((suggestion) => {
        const feature = props.features.find((candidate) => candidate.key === suggestion.featureKey);
        if (feature) {
          acceptedByFeature[suggestion.featureKey] = applyBreakdownSuggestion(feature, suggestion);
        }
      });
      const nextProposal = buildPiPlanProposal({
        piName: props.piName,
        piStartIso: props.piStartIso,
        piEndIso: props.piEndIso,
        features: props.features,
        acceptedByFeature,
        people: props.people,
        releaseSchedule: props.releaseSchedule,
        workingCalendar: props.workingCalendar,
        sprintLengthDays: props.sprintLengthDays,
      }, props.todayIso);
      setProposal(nextProposal);
      setAcceptedIds(new Set());
      setDismissedIds(new Set());
      const softNote = parsed.rejected.length > 0 || parsed.unparsedCount > 0
        ? `Ingested with ${parsed.rejected.length} rejected item(s) and ${parsed.unparsedCount} unparsed story(ies).`
        : null;
      setParseError(softNote);
    } catch (ingestError) {
      setProposal(null);
      setParseError(ingestError instanceof Error ? ingestError.message : String(ingestError));
    }
  }

  async function handleAccept(id: string): Promise<void> {
    const item = proposal?.items.find((candidate) => candidate.id === id && candidate.kind === 'story');
    if (item) {
      await props.onApplyStory(item);
    }
    setAcceptedIds((previous) => new Set(previous).add(id));
  }

  function handleDismiss(id: string): void {
    setDismissedIds((previous) => new Set(previous).add(id));
  }

  const decoratedItems = (proposal?.items ?? []).map((item) => ({
    ...item,
    status: acceptedIds.has(item.id) ? 'accepted' : dismissedIds.has(item.id) ? 'dismissed' : item.status,
  } as PlanItemProposal));

  return (
    <ReportAiPanel
      title="🗓️ PI Planner"
      prompt={prompt}
      ingestLabel="Ingest plan reply"
      onIngest={handleIngest}
      error={parseError}
      hint="Accepted Stories are created in Jira with their sub-tasks and dates. Review each item before accepting."
    >
      {proposal ? (
        <div className="pi-plan-results">
          {proposal.honestStates.length > 0 ? (
            <ul className="pi-plan-honest-states">
              {proposal.honestStates.map((state) => <li key={state}>{state}</li>)}
            </ul>
          ) : null}
          <PlanProposalTable items={decoratedItems} onAccept={handleAccept} onDismiss={handleDismiss} />
          <PiPlanCapacityMap planResult={proposal.planResult} people={props.people} />
        </div>
      ) : null}
    </ReportAiPanel>
  );
}
