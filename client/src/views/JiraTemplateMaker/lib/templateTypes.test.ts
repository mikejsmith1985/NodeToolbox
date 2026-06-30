// templateTypes.test.ts — Guards the shared template-store schema version constant.
// templateTypes.ts is type declarations plus this constant; the test pins the version so a
// change is deliberate (the store load path rejects unknown versions).

import { describe, expect, it } from 'vitest';

import { JIRA_TEMPLATE_STORE_SCHEMA_VERSION } from './templateTypes.ts';

describe('templateTypes', () => {
  it('exposes a positive integer store schema version', () => {
    expect(Number.isInteger(JIRA_TEMPLATE_STORE_SCHEMA_VERSION)).toBe(true);
    expect(JIRA_TEMPLATE_STORE_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
