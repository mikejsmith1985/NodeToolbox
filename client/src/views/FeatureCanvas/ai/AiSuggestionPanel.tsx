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
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import type { MoscowBucket } from '../overlay/overlayModel.ts';
import {
  buildCanvasAiPrompt,
  parseCanvasAiResponse,
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
  onClose: () => void;
}

/** Applies one accepted suggestion to the overlay based on the analysis kind. */
function applySuggestion(kind: AiSuggestionKind, suggestion: AiSuggestion, controller: CanvasOverlayController): void {
  if (kind === 'priorityOrder') {
    controller.setPriority(suggestion.issueKey, suggestion.proposedValue as MoscowBucket);
  } else if (kind === 'staleCandidates' || kind === 'wipReduction') {
    // Both analyses recommend deferring work, so accepting one parks the feature (overlay only).
    controller.setParked(suggestion.issueKey, true);
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
  };
}

/** The gated copy-paste AI accelerator. Renders nothing when AI Assist is locked. */
export function AiSuggestionPanel({ canvasNodes, controller, wip, onClose }: AiSuggestionPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [kind, setKind] = useState<AiSuggestionKind>('priorityOrder');
  const [responseText, setResponseText] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const knownKeys = useMemo(() => new Set(canvasNodes.map((node) => node.issueKey)), [canvasNodes]);
  const prompt = useMemo(() => {
    // Reduce WIP reasons only over the features that actually count toward WIP (in progress, not
    // parked) and is handed the limit + count; every other analysis considers the whole canvas.
    if (kind === 'wipReduction') {
      const inProgressNodes = canvasNodes.filter((node) => !node.isParked && node.statusCategoryKey === IN_PROGRESS_STATUS_CATEGORY);
      return buildCanvasAiPrompt(kind, inProgressNodes.map(toPromptIssue), { wipLimit: wip.limit, inProgressCount: wip.inProgressCount });
    }
    return buildCanvasAiPrompt(kind, canvasNodes.map(toPromptIssue));
  }, [kind, canvasNodes, wip.limit, wip.inProgressCount]);

  // For value-driven analyses, warn when no feature carries Business Value or points — the
  // assistant will then lean on status/health/completion/blockers, which the user should know.
  const lacksValueSignals = useMemo(
    () => (kind === 'priorityOrder' || kind === 'wipReduction')
      && canvasNodes.length > 0
      && canvasNodes.every((node) => node.businessValue === null && node.storyPoints === null),
    [kind, canvasNodes],
  );

  // Guard: invisible and inert unless the operator has unlocked AI Assist.
  if (!isUnlocked) {
    return null;
  }

  const handleIngest = (): void => {
    try {
      const parsed = parseCanvasAiResponse(kind, responseText);
      setSuggestions(parsed.items.filter((item) => knownKeys.has(item.issueKey)));
      setError(null);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : 'Could not read the response.');
      setSuggestions([]);
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
      <select value={kind} onChange={(event) => setKind(event.target.value as AiSuggestionKind)} style={{ margin: '8px 0', width: '100%' }}>
        <option value="priorityOrder">Priority order</option>
        <option value="wipReduction">Reduce WIP (park to limit)</option>
        <option value="staleCandidates">Stale candidates</option>
        <option value="duplicateCandidates">Duplicate candidates</option>
        <option value="sprintGrouping">Sprint grouping</option>
      </select>
      {lacksValueSignals && (
        <p style={{ margin: '4px 0', fontSize: 11, color: 'var(--color-warning)' }}>
          No Business Value or story points found on these features — suggestions will rely on status, health, completion, and blockers.
        </p>
      )}
      <textarea readOnly value={prompt} rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" className={controlStyles.btn} onClick={() => navigator.clipboard?.writeText(prompt)} style={{ margin: '6px 0' }}>📋 Copy prompt</button>
      <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="Paste the JSON reply here" rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" className={controlStyles.btnPrimary} onClick={handleIngest} style={{ margin: '6px 0' }}>Ingest suggestions</button>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: 180, overflowY: 'auto' }}>
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.issueKey}:${suggestion.proposedValue}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span>{suggestion.issueKey} → {suggestion.proposedValue}</span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <button type="button" className={controlStyles.btnPrimary} onClick={() => acceptSuggestion(suggestion)}>Accept</button>
              <button type="button" className={controlStyles.btn} onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>Reject</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
