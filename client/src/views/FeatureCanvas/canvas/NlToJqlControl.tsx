// NlToJqlControl.tsx — Hidden, passphrase-gated helper that turns a plain-language scope into JQL.
//
// This is the accelerator only the owner (who has unlocked Ctrl+Alt+Z) ever sees. It generates a
// prompt to paste into an external assistant and ingests a strict JSON reply containing a single
// JQL string, which the owner can accept into the scope box. It only proposes — rejecting changes
// nothing — and it is invisible/inert when AI Assist is locked, so the scope bar is fully usable
// without it.

import { useMemo, useState } from 'react';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import { buildScopeQueryPrompt, parseScopeQueryResponse } from '../ai/canvasAiAssist.ts';

/** Props for the gated NL→JQL scope helper. */
export interface NlToJqlControlProps {
  projectKey: string;
  piName: string;
  onAcceptJql: (jql: string) => void;
}

/** The gated NL→JQL helper. Renders nothing when AI Assist is locked. */
export function NlToJqlControl({ projectKey, piName, onAcceptJql }: NlToJqlControlProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [replyText, setReplyText] = useState('');
  const [proposedJql, setProposedJql] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prompt = useMemo(() => buildScopeQueryPrompt({ projectKey, piName, description }), [projectKey, piName, description]);

  // Guard: invisible and inert unless the owner has unlocked AI Assist.
  if (!isUnlocked) {
    return null;
  }

  const handleIngest = (): void => {
    try {
      setProposedJql(parseScopeQueryResponse(replyText).jql);
      setError(null);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : 'Could not read the reply.');
      setProposedJql(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setIsOpen((open) => !open)} title="Describe the scope in words (AI)" style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid #8b5cf6', background: 'transparent', color: 'inherit' }}>
        ⚡ Ask
      </button>
      {isOpen && (
        <div style={{ position: 'absolute', right: 0, top: 36, width: 340, padding: 12, background: '#0f172a', border: '1px solid #8b5cf6', borderRadius: 8, zIndex: 30, color: '#e2e8f0' }}>
          <input aria-label="Describe the scope" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="features for PI 26.3 with the ENCUC label" style={{ width: '100%', marginBottom: 6 }} />
          <textarea readOnly aria-label="Generated prompt" value={prompt} rows={3} style={{ width: '100%', fontSize: 11 }} />
          <button type="button" onClick={() => navigator.clipboard?.writeText(prompt)} style={{ margin: '4px 0' }}>📋 Copy prompt</button>
          <textarea aria-label="Paste reply" value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Paste the JSON reply" rows={3} style={{ width: '100%', fontSize: 11 }} />
          <button type="button" onClick={handleIngest} style={{ margin: '4px 0' }}>Get JQL</button>
          {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
          {proposedJql && (
            <div style={{ fontSize: 12 }}>
              <code style={{ display: 'block', wordBreak: 'break-all', margin: '4px 0' }}>{proposedJql}</code>
              <button type="button" onClick={() => { onAcceptJql(proposedJql); setIsOpen(false); }}>Use this query</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
