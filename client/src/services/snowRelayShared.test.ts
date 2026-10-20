// snowRelayShared.test.ts — Proves the shared relay pieces are exactly what Toolbox's own bookmarklet runs.

import { describe, expect, it } from 'vitest';

import { SNOW_RELAY_BOOKMARKLET_CODE } from './browserRelay.ts';
import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from './snowRelayShared.ts';

describe('snowRelayShared', () => {
  it('is the token resolver inside the ServiceNow bookmarklet', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain(SNOW_TOKEN_RESOLVER_SOURCE);
  });

  it('names the ServiceNow host fragments', () => {
    expect(SNOW_HOSTNAME_FRAGMENTS).toEqual(['service-now', 'servicenow']);
  });
});
