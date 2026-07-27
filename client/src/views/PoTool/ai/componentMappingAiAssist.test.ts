// componentMappingAiAssist.test.ts — Propose-only, allowlist-constrained component mapping (spec 031, US2).

import { describe, expect, it } from 'vitest';

import {
  buildComponentMappingPrompt,
  parseComponentMappingIngest,
  COMPONENT_MAPPING_KIND,
} from './componentMappingAiAssist.ts';

const ALLOWLIST = ['payments-api', 'ui-web', 'notifications-svc'];

function reply(components: unknown[], kind: string = COMPONENT_MAPPING_KIND): string {
  return JSON.stringify({ kind, featureKey: 'DENP-1', components, rationale: 'x' });
}

describe('buildComponentMappingPrompt', () => {
  it('includes the Feature text and every allowlist name as the only menu', () => {
    const prompt = buildComponentMappingPrompt(
      { key: 'DENP-1', summary: 'Add refunds', description: 'refund flow' },
      ALLOWLIST,
    );
    expect(prompt).toContain('DENP-1');
    expect(prompt).toContain('Add refunds');
    ALLOWLIST.forEach((name) => expect(prompt).toContain(name));
    expect(prompt).toContain(COMPONENT_MAPPING_KIND);
  });
});

describe('parseComponentMappingIngest', () => {
  it('accepts allowlist names and rejects anything not on the list, with a reason', () => {
    const result = parseComponentMappingIngest(reply(['payments-api', 'Enrollment', 'made-up-repo']), ALLOWLIST);
    expect(result.items.map((item) => item.componentName)).toEqual(['payments-api']);
    expect(result.errors.join(' ')).toMatch(/Enrollment.*ignored/);
    expect(result.errors.join(' ')).toMatch(/made-up-repo.*ignored/);
  });

  it('is case-insensitive and de-duplicates, preserving allowlist casing', () => {
    const result = parseComponentMappingIngest(reply(['PAYMENTS-API', 'payments-api', 'UI-Web']), ALLOWLIST);
    expect(result.items.map((item) => item.componentName)).toEqual(['payments-api', 'ui-web']);
  });

  it('returns errors (no items) when the kind is wrong', () => {
    const result = parseComponentMappingIngest(reply(['payments-api'], 'somethingElse'), ALLOWLIST);
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toMatch(/is not componentMapping/);
  });

  it('does not throw on an empty/garbage reply', () => {
    expect(parseComponentMappingIngest('no json here', ALLOWLIST).items).toEqual([]);
    expect(parseComponentMappingIngest(reply([]), ALLOWLIST).items).toEqual([]);
  });
});
