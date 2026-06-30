// copyToClipboard.ts — Copies text to the clipboard with a fallback for environments where the
// async Clipboard API is unavailable or blocked (e.g. some embedded webviews). Returns whether
// the copy succeeded so callers can show accurate feedback (and offer the raw text on failure).

/** Attempts the modern async clipboard, falling back to a hidden-textarea execCommand copy. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy approach below.
  }

  try {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
      return false;
    }
    const helperTextarea = document.createElement('textarea');
    helperTextarea.value = text;
    helperTextarea.style.position = 'fixed';
    helperTextarea.style.opacity = '0';
    document.body.appendChild(helperTextarea);
    helperTextarea.focus();
    helperTextarea.select();
    const didCopy = document.execCommand('copy');
    document.body.removeChild(helperTextarea);
    return didCopy;
  } catch {
    return false;
  }
}
