// readToolVersion.test.ts — Tests for the shared tool-version provenance reader.
//
// A report states which version produced it so a reader can trust its provenance. The one behaviour
// that matters is the failure path: a version is provenance, not content, so an unreachable endpoint
// must never stop a report being produced — it degrades to "unknown" instead.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readToolVersion } from './readToolVersion.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readToolVersion', () => {
  it('reads currentVersion when the endpoint returns it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ currentVersion: '1.2.3' }) })));

    expect(await readToolVersion()).toBe('1.2.3');
  });

  it('falls back to the legacy version field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ version: '4.5.6' }) })));

    expect(await readToolVersion()).toBe('4.5.6');
  });

  it('returns "unknown" rather than throwing when the fetch rejects', async () => {
    // The report must still be produced; provenance is not content.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    expect(await readToolVersion()).toBe('unknown');
  });

  it('returns "unknown" when the payload has neither field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })));

    expect(await readToolVersion()).toBe('unknown');
  });
});
