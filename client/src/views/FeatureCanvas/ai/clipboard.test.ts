// clipboard.test.ts — Verifies the modern clipboard path and the non-secure-context fallback.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './clipboard.ts';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Remove the clipboard override so each test starts from a known state.
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('uses navigator.clipboard.writeText when available', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    copyToClipboard('hello prompt');

    expect(writeText).toHaveBeenCalledWith('hello prompt');
  });

  it('falls back to execCommand in a non-secure context and cleans up the scratch textarea', () => {
    // No navigator.clipboard → the legacy hidden-textarea path must run.
    Reflect.deleteProperty(navigator, 'clipboard');
    const execCommand = vi.fn().mockReturnValue(true);
    // document.execCommand is not implemented in jsdom; provide a spy for the fallback to call.
    Object.assign(document, { execCommand });

    copyToClipboard('fallback text');

    expect(execCommand).toHaveBeenCalledWith('copy');
    // The transient textarea must be removed after copying (no DOM leak).
    expect(document.querySelector('textarea')).toBeNull();
  });
});
