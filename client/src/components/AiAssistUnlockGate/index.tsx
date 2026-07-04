// index.tsx — App-level gate for the hidden AI Assist capability.
//
// Mounted once at the app root so the Ctrl+Alt+Z shortcut and its passphrase prompt work from ANY
// screen — the unlock no longer depends on the Admin Hub being open. Ctrl+Alt+Z opens the passphrase
// modal when locked and re-locks when already unlocked; a correct passphrase flips the shared
// aiAssistStore, which every "⚡ AI Assist" affordance across the app reads.

import { useCallback, useEffect, useState } from 'react';

import { setAiAssistUnlocked } from '../../store/aiAssistStore.ts';
import { useAiAssist } from '../../views/SnowHub/hooks/useAiAssist.ts';
import styles from './AiAssistUnlockGate.module.css';

// The hidden shortcut key (with Ctrl+Alt) that toggles the AI Assist capability.
const SHORTCUT_KEY = 'z';

/** Renders nothing until Ctrl+Alt+Z opens the passphrase prompt; owns the app-wide unlock. */
export function AiAssistUnlockGate(): React.JSX.Element | null {
  const { isUnlocked, verifyPassphrase } = useAiAssist();
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent): void {
      const isShortcut = keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.key.toLowerCase() === SHORTCUT_KEY;
      if (!isShortcut) {
        return;
      }
      keyboardEvent.preventDefault();
      // Already unlocked → the shortcut re-hides every AI Assist feature (shared store).
      if (isUnlocked) {
        setAiAssistUnlocked(false);
        setIsPromptVisible(false);
        return;
      }
      setPassphrase('');
      setError(null);
      setIsPromptVisible(true);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUnlocked]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const isAccepted = await verifyPassphrase(passphrase);
    if (isAccepted) {
      setIsPromptVisible(false);
      setPassphrase('');
      setError(null);
      return;
    }
    setError('Incorrect passphrase');
  }, [passphrase, verifyPassphrase]);

  if (!isPromptVisible) {
    return null;
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Unlock AI Assist">
      <div className={styles.modal}>
        <h2 className={styles.title}>🔒 AI Assist</h2>
        <label className={styles.label}>
          Passphrase
          <input
            autoFocus
            className={styles.input}
            type="password"
            placeholder="Enter passphrase"
            value={passphrase}
            onChange={(changeEvent) => { setPassphrase(changeEvent.target.value); setError(null); }}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === 'Enter') { void handleSubmit(); }
              if (keyboardEvent.key === 'Escape') { setIsPromptVisible(false); }
            }}
          />
        </label>
        {error !== null && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void handleSubmit()}>Unlock AI Assist</button>
          <button type="button" className={styles.secondary} onClick={() => setIsPromptVisible(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
