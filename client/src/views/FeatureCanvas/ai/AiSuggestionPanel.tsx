// AiSuggestionPanel.tsx — The hidden, passphrase-gated accelerator UI (copy prompt → paste JSON).
//
// This panel is only reachable when AI Assist is unlocked (Ctrl+Alt+Z). It generates a prompt to
// copy into an external assistant and ingests a strict JSON reply, surfacing every suggestion as
// an accept/reject proposal. Accepting mutates ONLY the overlay; nothing here touches Jira, and
// the whole workflow is fully usable without ever opening this panel.

import { useMemo, useState } from 'react';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { CanvasNode, WipSnapshot } from '../logic/canvasTypes.ts';
import { IN_PROGRESS_STATUS_CATEGORY } from '../logic/wip.ts';
import { daysRemainingInPi } from '../logic/piSchedule.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import type { MoscowBucket, TshirtSize } from '../overlay/overlayModel.ts';
import { createProvisionalContainer } from '../overlay/containerFactory.ts';
import {
  buildCanvasAiPrompt,
  describeSuggestionAction,
  parseCanvasAiResponse,
  parseMasterPlan,
  type AiPromptIssue,
  type AiSuggestion,
  type AiSuggestionKind,
} from './canvasAiAssist.ts';
import controlStyles from '../canvas/canvasControls.module.css';

/** Props for the gated AI accelerator panel. */
export interface AiSuggestionPanelProps {
  canvasNodes: readonly CanvasNode[];
  controller: CanvasOverlayController;
  /** Current WIP readout — feeds the Reduce WIP prompt with the limit and in-progress count. */
  wip: WipSnapshot;
  /** Active PI name (may carry a date range) — drives the days-left signal in the prompts. */
  piName: string;
  onClose: () => void;
}

/**
 * Assigns a feature to the suggested sprint box: reuses an existing sprint of that title, else
 * creates a provisional one first. All overlay-only — Review & Commit is what writes to Jira.
 */
function assignToSuggestedSprint(suggestion: AiSuggestion, controller: CanvasOverlayController): void {
  const targetTitle = suggestion.proposedValue.trim();
  if (targetTitle === '') {
    return;
  }
  const existing = controller.overlay.containers.find(
    (container) => container.kind === 'sprint' && container.title.trim().toLowerCase() === targetTitle.toLowerCase(),
  );
  if (existing) {
    controller.assignToContainer(suggestion.issueKey, existing.id);
    return;
  }
  // Create the provisional sprint, then move the card inside it (assignToContainer repositions).
  const container = createProvisionalContainer('sprint', controller.overlay.containers.length, targetTitle);
  controller.addContainer(container);
  controller.assignToContainer(suggestion.issueKey, container.id);
}

/** Applies one accepted suggestion to the overlay based on the analysis kind. */
function applySuggestion(kind: AiSuggestionKind, suggestion: AiSuggestion, controller: CanvasOverlayController): void {
  if (kind === 'priorityOrder') {
    controller.setPriority(suggestion.issueKey, suggestion.proposedValue as MoscowBucket);
  } else if (kind === 'sizeEstimate') {
    controller.setSize(suggestion.issueKey, suggestion.proposedValue as TshirtSize);
  } else if (kind === 'sprintGrouping') {
    assignToSuggestedSprint(suggestion, controller);
  } else if (kind === 'parkCandidates') {
    // proposedValue holds the triage action. Park → Parking Lot with reason; complete → Complete box;
    // breakout is advisory only (the feature needs splitting in Jira — nothing to move here).
    if (suggestion.proposedValue === 'complete') {
      controller.completeNode(suggestion.issueKey);
    } else if (suggestion.proposedValue === 'park') {
      controller.parkNode(suggestion.issueKey, suggestion.rationale);
    }
  }
}

/** Projects a canvas node into the data-rich issue shape the AI prompt needs (real signals only). */
function toPromptIssue(node: CanvasNode): AiPromptIssue {
  const activeChildCount = node.childStories.filter((child) => child.statusCategoryKey === IN_PROGRESS_STATUS_CATEGORY).length;
  return {
    issueKey: node.issueKey,
    summary: node.summary,
    status: node.status,
    storyPoints: node.storyPoints,
    businessValue: node.businessValue,
    priority: node.priority,
    health: node.health,
    completionPercent: node.completionPercent,
    activeChildCount,
    totalChildCount: node.childStories.length,
    blockerCount: node.dependencies.length,
    description: node.description,
    acceptanceCriteria: node.acceptanceCriteria,
  };
}

/** The gated copy-paste AI accelerator. Renders nothing when AI Assist is locked. */
export function AiSuggestionPanel({ canvasNodes, controller, wip, piName, onClose }: AiSuggestionPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [kind, setKind] = useState<AiSuggestionKind>('sizeEstimate');
  const [responseText, setResponseText] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Set after a master-plan ingest applies (a summary of what changed); cleared on any kind switch.
  const [planSummary, setPlanSummary] = useState<string | null>(null);

  const knownKeys = useMemo(() => new Set(canvasNodes.map((node) => node.issueKey)), [canvasNodes]);
  // Features that are parked or already in the Complete box are OUT of active flow — never sequence
  // them into sprints (that was the "why is my parked/done work in a sprint?" bug).
  const completeBoxIds = useMemo(
    () => new Set(controller.overlay.containers.filter((container) => container.kind === 'complete').map((container) => container.id)),
    [controller.overlay.containers],
  );

  const prompt = useMemo(() => {
    // Prioritize and Triage get PI time-remaining (days to DoD) as context; Triage also gets the WIP
    // limit. Days-left is read from the PI name's date range at render.
    if (kind === 'priorityOrder' || kind === 'parkCandidates' || kind === 'masterPlan') {
      const context = {
        wipLimit: wip.limit,
        inProgressCount: wip.inProgressCount,
        daysRemainingInPi: daysRemainingInPi(piName, new Date().toISOString().slice(0, 10)),
        piName,
      };
      return buildCanvasAiPrompt(kind, canvasNodes.map(toPromptIssue), context);
    }
    // Sequence (sprint grouping) considers only active features — never parked or completed ones.
    if (kind === 'sprintGrouping') {
      const sequenceable = canvasNodes.filter((node) => !node.isParked && !completeBoxIds.has(node.containerId ?? ''));
      return buildCanvasAiPrompt(kind, sequenceable.map(toPromptIssue));
    }
    return buildCanvasAiPrompt(kind, canvasNodes.map(toPromptIssue));
  }, [kind, canvasNodes, wip.limit, wip.inProgressCount, piName, completeBoxIds]);

  // For value-driven analyses, warn when no feature carries Business Value or points — the
  // assistant will then lean on status/health/completion/blockers, which the user should know.
  const lacksValueSignals = useMemo(
    () => (kind === 'priorityOrder' || kind === 'parkCandidates' || kind === 'masterPlan')
      && canvasNodes.length > 0
      && canvasNodes.every((node) => node.businessValue === null && node.storyPoints === null),
    [kind, canvasNodes],
  );

  // The master plan performs the Stabilize-WIP phase, so it REQUIRES a WIP limit to know how much to
  // park. Block the prompt/ingest until one is set (settable inline below).
  const needsWipLimit = kind === 'masterPlan' && wip.limit === null;

  // Guard: invisible and inert unless the operator has unlocked AI Assist.
  if (!isUnlocked) {
    return null;
  }

  const handleIngest = (): void => {
    try {
      // Master plan is applied in one shot (all recommendations accepted); every other analysis
      // surfaces accept/reject rows the operator confirms individually.
      if (kind === 'masterPlan') {
        const plan = parseMasterPlan(responseText).filter((item) => knownKeys.has(item.issueKey));
        controller.applyMasterPlan(plan);
        const parked = plan.filter((item) => item.triage === 'park').length;
        const completed = plan.filter((item) => item.triage === 'complete').length;
        const sequenced = plan.filter((item) => item.triage !== 'park' && item.triage !== 'complete' && item.sprint !== null).length;
        const sized = plan.filter((item) => item.size !== null).length;
        const prioritized = plan.filter((item) => item.bucket !== null).length;
        setPlanSummary(`Applied to ${plan.length} feature(s): ${sized} sized · ${prioritized} prioritized · ${sequenced} sequenced · ${parked} parked · ${completed} completed. Undo reverts it all.`);
        setSuggestions([]);
        setError(null);
        return;
      }
      const parsed = parseCanvasAiResponse(kind, responseText);
      setSuggestions(parsed.items.filter((item) => knownKeys.has(item.issueKey)));
      setError(null);
      setPlanSummary(null);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : 'Could not read the response.');
      setSuggestions([]);
      setPlanSummary(null);
    }
  };

  const acceptSuggestion = (accepted: AiSuggestion): void => {
    applySuggestion(kind, accepted, controller);
    setSuggestions((current) => current.filter((item) => item !== accepted));
  };

  return (
    <div className={controlStyles.popover} style={{ position: 'absolute', right: 340, top: 16, width: 360, padding: 16, zIndex: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>⚡ AI suggestions (optional)</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close AI suggestions">✕</button>
      </div>
      <select
        value={kind}
        onChange={(event) => { setKind(event.target.value as AiSuggestionKind); setSuggestions([]); setPlanSummary(null); setError(null); }}
        style={{ margin: '8px 0', width: '100%' }}
      >
        {/* The master plan runs all phases in one round-trip; the rest match the coaching phase order. */}
        <option value="masterPlan">★ Master plan — all phases, applied at once</option>
        <option value="sizeEstimate">Size — t-shirt estimate</option>
        <option value="priorityOrder">Prioritize — MoSCoW buckets</option>
        <option value="parkCandidates">Stabilize WIP — triage (park / complete / break out)</option>
        <option value="sprintGrouping">Sequence — assign to sprint</option>
      </select>
      {kind === 'masterPlan' && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0', fontSize: 12 }}>
          WIP limit (required):
          <input
            type="number"
            min={1}
            aria-label="WIP limit"
            value={wip.limit ?? ''}
            onChange={(event) => controller.setWipLimit(event.target.value === '' ? null : Number(event.target.value))}
            style={{ width: 70 }}
          />
        </label>
      )}
      {needsWipLimit && (
        <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--color-warning)' }}>
          Set a WIP limit — the master plan needs it to decide how much to park.
        </p>
      )}
      {lacksValueSignals && (
        <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--color-warning)' }}>
          No Business Value or story points found on these features — suggestions will rely on status, health, completion, and blockers.
        </p>
      )}
      <textarea readOnly value={prompt} rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" className={controlStyles.btn} onClick={() => navigator.clipboard?.writeText(prompt)} disabled={needsWipLimit} style={{ margin: '6px 0' }}>📋 Copy prompt</button>
      <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="Paste the JSON reply here" rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" className={controlStyles.btnPrimary} onClick={handleIngest} disabled={needsWipLimit} style={{ margin: '6px 0' }}>
        {kind === 'masterPlan' ? 'Ingest & apply plan' : 'Ingest suggestions'}
      </button>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {planSummary && <p style={{ color: 'var(--color-success)', fontSize: 12 }}>{planSummary}</p>}
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: 220, overflowY: 'auto' }}>
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.issueKey}:${suggestion.proposedValue}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Say exactly what Accept will do, then why — so it's never a blind click. */}
              <div><strong>{suggestion.issueKey}</strong> · {describeSuggestionAction(kind, suggestion)}</div>
              {suggestion.rationale && <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.35 }}>{suggestion.rationale}</div>}
            </div>
            <span style={{ display: 'inline-flex', gap: 4, flex: 'none' }}>
              <button type="button" className={controlStyles.btnPrimary} onClick={() => acceptSuggestion(suggestion)}>Accept</button>
              <button type="button" className={controlStyles.btn} onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>Reject</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
