// componentMappingAiAssist.test.ts — Propose-only, allowlist-constrained component mapping (spec 031, US2).

import { describe, expect, it } from 'vitest';

import {
  buildComponentMappingFollowUp,
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
    // The repos arrive pre-listed in the fill-in table, so the assistant answers per row and cannot invent one.
    expect(prompt).toContain('REPO_MAPPING_TABLE:');
    expect(prompt).toContain('Repository | Touched | Why');
    expect(prompt).toContain('payments-api | ___ | ___');
    expect(prompt).not.toContain('Respond ONLY with valid JSON');
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

// An AI Mode reply: an intro sentence, the table as markdown, and a closing offer to help further.
const AI_MODE_MARKDOWN_REPLY = [
  'Based on the Feature description, here is the repository mapping:',
  '',
  'REPO_MAPPING_TABLE:',
  '| Repository | Touched | Why |',
  '|---|---|---|',
  '| payments-api | Yes | refund flow posts to payments |',
  '| ui-web | No | ___ |',
  '| notifications-svc | yes | refund email |',
  '',
  'If you provide the architecture diagram, I can refine this mapping.',
].join('\n');

// The same answer pasted from the web page: tab-separated cells, no markers.
const AI_MODE_TAB_REPLY = [
  'Repository\tTouched\tWhy',
  'payments-api\tYes\trefund flow',
  'ui-web\tNo\t',
  'notifications-svc\tYes\trefund email',
].join('\n');

describe('parseComponentMappingIngest — Google AI Mode replies (GH #499)', () => {
  it('reads a markdown table with an intro and a closing offer into the repos answered yes', () => {
    const result = parseComponentMappingIngest(AI_MODE_MARKDOWN_REPLY, ALLOWLIST);
    expect(result.items.map((item) => item.componentName)).toEqual(['payments-api', 'notifications-svc']);
    expect(result.errors).toEqual([]);
  });

  it('reads a tab-separated table pasted from the web page the same way', () => {
    const result = parseComponentMappingIngest(AI_MODE_TAB_REPLY, ALLOWLIST);
    expect(result.items.map((item) => item.componentName)).toEqual(['payments-api', 'notifications-svc']);
  });

  it('still rejects a repo the assistant added that is not on the allowlist', () => {
    const reply = `${AI_MODE_MARKDOWN_REPLY}
| Enrollment | Yes | domain |`;
    const result = parseComponentMappingIngest(reply, ALLOWLIST);
    expect(result.errors.join(' ')).toMatch(/Enrollment.*ignored/);
    expect(result.items.map((item) => item.componentName)).not.toContain('Enrollment');
  });
});

describe('buildComponentMappingFollowUp', () => {
  it('offers nothing when every repo was answered', () => {
    expect(buildComponentMappingFollowUp(AI_MODE_MARKDOWN_REPLY, ALLOWLIST)).toBe('');
  });

  it('offers nothing for a JSON reply — listing only the chosen repos is its answer', () => {
    expect(buildComponentMappingFollowUp(reply(['payments-api']), ALLOWLIST)).toBe('');
  });

  it('asks for the table again when the reply could not be read', () => {
    const followUp = buildComponentMappingFollowUp('This Feature probably touches the payments service.', ALLOWLIST);
    expect(followUp).toMatch(/not in the form I need/);
    ALLOWLIST.forEach((name) => expect(followUp).toContain(`${name} | ___ | ___`));
  });

  it('asks only for the repos left blank, never guessing them', () => {
    const partialReply = AI_MODE_MARKDOWN_REPLY.replace('| ui-web | No | ___ |', '| ui-web | ___ | ___ |');
    const followUp = buildComponentMappingFollowUp(partialReply, ALLOWLIST);
    expect(followUp).toContain('ui-web | ___ | ___');
    expect(followUp).not.toContain('payments-api | ___');
    expect(parseComponentMappingIngest(partialReply, ALLOWLIST).items.map((item) => item.componentName)).not.toContain('ui-web');
  });
});
