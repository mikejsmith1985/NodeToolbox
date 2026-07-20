// QuickIssueLookupGate.tsx — App-wide F2 shortcut that opens the Quick Issue Lookup popup anywhere.
//
// Mounted once at the app root (TodoQuickAdd / AiAssistUnlockGate precedent). F2 opens the popup and
// preventDefault()s the browser default; F2 while already open re-focuses and clears the search
// input (via a remount) rather than stacking a second popup. Escape closes. The global handler
// ignores F2 while the user is typing in a field OUTSIDE the popup (keyboard-guard).

import { useCallback, useEffect, useRef } from 'react';

import { QuickIssueLookup } from './QuickIssueLookup.tsx';
import { useQuickLookupStore } from './quickLookupStore.ts';
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
  // Open/close/seed state is app-wide (quickLookupStore) so a linked-issue click can open this same
  // popup seeded with a key; the F2 keydown below is just one of the store's callers.
  const isOpen = useQuickLookupStore((state) => state.isOpen);
  const seedKey = useQuickLookupStore((state) => state.seedKey);
  // Bumped on every open; used as the popup's React key so a repeat open remounts (clears) it.
  const openNonce = useQuickLookupStore((state) => state.openNonce);
  const openLookup = useQuickLookupStore((state) => state.open);
  const closeLookup = useQuickLookupStore((state) => state.close);
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
      // F2 opens idle (no seed); open() bumps the nonce so F2-while-open still remounts/clears it.
      openLookup();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openLookup]);

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
          closeLookup();
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
            onClick={() => closeLookup()}
          >
            ×
          </button>
        </div>
        <QuickIssueLookup key={openNonce} inputRef={inputRef} seedKey={seedKey ?? undefined} />
      </div>
    </div>
  );
}
