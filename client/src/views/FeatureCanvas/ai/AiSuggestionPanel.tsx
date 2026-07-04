// AiSuggestionPanel.tsx — The hidden, passphrase-gated accelerator UI (copy prompt → paste JSON).
//
// This panel is only reachable when AI Assist is unlocked (Ctrl+Alt+Z). It generates a prompt to
// copy into an external assistant and ingests a strict JSON reply, surfacing every suggestion as
// an accept/reject proposal. Accepting mutates ONLY the overlay; nothing here touches Jira, and
// the whole workflow is fully usable without ever opening this panel.

import { useMemo, useState } from 'react';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import type { MoscowBucket } from '../overlay/overlayModel.ts';
import {
  buildCanvasAiPrompt,
  parseCanvasAiResponse,
  type AiSuggestion,
  type AiSuggestionKind,
} from './canvasAiAssist.ts';

/** Props for the gated AI accelerator panel. */
export interface AiSuggestionPanelProps {
  canvasNodes: readonly CanvasNode[];
  controller: CanvasOverlayController;
  onClose: () => void;
}

/** Applies one accepted suggestion to the overlay based on the analysis kind. */
function applySuggestion(kind: AiSuggestionKind, suggestion: AiSuggestion, controller: CanvasOverlayController): void {
  if (kind === 'priorityOrder') {
    controller.setPriority(suggestion.issueKey, suggestion.proposedValue as MoscowBucket);
  } else if (kind === 'staleCandidates') {
    controller.setParked(suggestion.issueKey, true);
  }
}

/** The gated copy-paste AI accelerator. Renders nothing when AI Assist is locked. */
export function AiSuggestionPanel({ canvasNodes, controller, onClose }: AiSuggestionPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [kind, setKind] = useState<AiSuggestionKind>('priorityOrder');
  const [responseText, setResponseText] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const knownKeys = useMemo(() => new Set(canvasNodes.map((node) => node.issueKey)), [canvasNodes]);
  const prompt = useMemo(
    () => buildCanvasAiPrompt(kind, canvasNodes.map((node) => ({ issueKey: node.issueKey, summary: node.summary, status: node.status, storyPoints: node.storyPoints, businessValue: node.businessValue }))),
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
    <div style={{ position: 'absolute', right: 340, top: 16, width: 360, padding: 16, background: '#0f172a', border: '1px solid #8b5cf6', borderRadius: 8, zIndex: 20, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>⚡ AI suggestions (optional)</strong>
        <button type="button" onClick={onClose}>✕</button>
      </div>
      <select value={kind} onChange={(event) => setKind(event.target.value as AiSuggestionKind)} style={{ margin: '8px 0', width: '100%' }}>
        <option value="priorityOrder">Priority order</option>
        <option value="staleCandidates">Stale candidates</option>
        <option value="duplicateCandidates">Duplicate candidates</option>
        <option value="sprintGrouping">Sprint grouping</option>
      </select>
      <textarea readOnly value={prompt} rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" onClick={() => navigator.clipboard?.writeText(prompt)} style={{ margin: '6px 0' }}>📋 Copy prompt</button>
      <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} placeholder="Paste the JSON reply here" rows={4} style={{ width: '100%', fontSize: 11 }} />
      <button type="button" onClick={handleIngest} style={{ margin: '6px 0' }}>Ingest suggestions</button>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: 180, overflowY: 'auto' }}>
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.issueKey}:${suggestion.proposedValue}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
            <span>{suggestion.issueKey} → {suggestion.proposedValue}</span>
            <span>
              <button type="button" onClick={() => acceptSuggestion(suggestion)}>Accept</button>
              <button type="button" onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>Reject</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
