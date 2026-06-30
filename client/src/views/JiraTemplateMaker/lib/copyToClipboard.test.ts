// copyToClipboard.test.ts — Unit tests for the clipboard helper.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './copyToClipboard.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } } as unknown as Navigator);
    const ok = await copyToClipboard('hello');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the Clipboard API throws', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('blocked'); }) } } as unknown as Navigator);
    const execCommand = vi.fn(() => true);
    // jsdom doesn't implement execCommand; provide it for this test.
    (document as unknown as { execCommand: () => boolean }).execCommand = execCommand;
    const ok = await copyToClipboard('hello');
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when no clipboard mechanism works', async () => {
    vi.stubGlobal('navigator', {} as unknown as Navigator);
    (document as unknown as { execCommand?: unknown }).execCommand = undefined;
    expect(await copyToClipboard('hello')).toBe(false);
  });
});
