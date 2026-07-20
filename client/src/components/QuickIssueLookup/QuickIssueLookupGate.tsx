// QuickIssueLookupGate.tsx — App-wide F2 shortcut that opens the Quick Issue Lookup popup anywhere.
//
// Mounted once at the app root (TodoQuickAdd / AiAssistUnlockGate precedent). F2 opens the popup and
// preventDefault()s the browser default; F2 while already open re-focuses and clears the search
// input (via a remount) rather than stacking a second popup. Escape closes. The global handler
// ignores F2 while the user is typing in a field OUTSIDE the popup (keyboard-guard).

import { useCallback, useEffect, useRef, useState } from 'react';

import { QuickIssueLookup } from './QuickIssueLookup.tsx';
import styles from './QuickIssueLookup.module.css';

const LOOKUP_HOTKEY = 'F2';
const CLOSE_KEY = 'Escape';
const DIALOG_LABEL = 'Quick issue lookup';
const CLOSE_LABEL = 'Close';
const EDITABLE_TAG_NAMES = ['INPUT', 'TEXTAREA'];

/** True when a keydown originated in a text field / contenteditable OUTSIDE the lookup popup. */
function isTypingOutsidePopup(eventTarget: EventTarget | null): boolean {
  if (!(eventTarget instanceof HTMLElement)) {
    return false;
  }
  // Inside the popup (its own input) F2 should still be handled, so those targets are not "outside".
  if (eventTarget.closest(`.${styles.backdrop}`)) {
    return false;
  }
  return EDITABLE_TAG_NAMES.includes(eventTarget.tagName) || eventTarget.isContentEditable;
}

/** Renders nothing until F2 opens the popup; owns the app-wide lookup shell. */
export function QuickIssueLookupGate(): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  // Bumped on every F2 press; used as the popup's React key so a repeat press remounts (clears) it.
  const [openNonce, setOpenNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    // Defer to the next frame so the freshly mounted input exists before we focus it.
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent): void {
      if (keyboardEvent.key !== LOOKUP_HOTKEY || isTypingOutsidePopup(keyboardEvent.target)) {
        return;
      }
      keyboardEvent.preventDefault();
      setIsOpen(true);
      setOpenNonce((previousNonce) => previousNonce + 1);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      focusInput();
    }
  }, [isOpen, openNonce, focusInput]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-label={DIALOG_LABEL}
      aria-modal="true"
      className={styles.backdrop}
      role="dialog"
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === CLOSE_KEY) {
          setIsOpen(false);
        }
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.title}>🔍 Quick issue lookup</h2>
          <button
            aria-label={CLOSE_LABEL}
            className={styles.closeButton}
            type="button"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>
        </div>
        <QuickIssueLookup key={openNonce} inputRef={inputRef} />
      </div>
    </div>
  );
}
