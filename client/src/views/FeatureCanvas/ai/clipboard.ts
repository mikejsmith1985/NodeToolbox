// clipboard.ts — Clipboard write shared by the canvas AI accelerator panels.
//
// Extracted so both the AI suggestions panel and the Work Re-Allocation panel copy prompts the same
// way, including the fallback for non-secure contexts (the packaged app served over a LAN IP or a
// restricted webview), where `navigator.clipboard` is undefined and the modern API silently no-ops.

/**
 * Copies text to the clipboard, falling back to a transient off-screen textarea when the modern
 * `navigator.clipboard` API is unavailable (non-secure context).
 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

/** Legacy clipboard write via a transient off-screen textarea and document.execCommand('copy'). */
export function fallbackCopy(text: string): void {
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.style.position = 'fixed';
  scratch.style.left = '-9999px';
  document.body.appendChild(scratch);
  scratch.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(scratch);
  }
}
