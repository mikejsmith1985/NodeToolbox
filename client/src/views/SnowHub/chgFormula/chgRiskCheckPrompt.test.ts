// chgRiskCheckPrompt.test.ts — The Release Manager's pre-approval check, as a copy-out prompt (GH #395).

import { describe, expect, it } from 'vitest';

import { buildChgRiskCheckPrompt, REVISED_FIELDS_HEADING, splitRiskCheckReply } from './chgRiskCheckPrompt.ts';

const SAMPLE_CONTEXT = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Enrollment Web',
  assignmentGroupLabel: 'Enrollment Dev',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: ['REL: Enabled — 2026-10-14 20:00 → 2026-10-14 22:00 — Config Item: Enrollment Web'],
  assessmentLines: [],
  changeTaskLines: [],
};

const SAMPLE_FIELDS = {
  shortDescription: 'Enrollment | Deploy release 26.10 | REL',
  description: 'Deploys the October release.',
  justification: '',
  riskImpact: 'Low risk.',
  implementationPlan: '1. Deploy.',
  testPlan: 'Tested in Dev and INT.',
  backoutPlan: '',
};

describe('buildChgRiskCheckPrompt', () => {
  it('sends the whole change — all seven text fields and the record facts — not just four fields', () => {
    const prompt = buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS);

    expect(prompt).toContain('Implementation Plan:\n1. Deploy.');
    expect(prompt).toContain('Test Plan:\nTested in Dev and INT.');
    expect(prompt).toContain('Backout Plan:\n(not set)');
    expect(prompt).toContain('Justification:\n(not set)');
    expect(prompt).toContain('Change owner: Smith, Mike');
  });

  it('checks the change against every Formula Card field and the quality gate', () => {
    const prompt = buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS);

    expect(prompt).toContain('Blast Radius');
    expect(prompt).toContain('Go or No-Go Criteria');
    expect(prompt).toContain('Is success objective?');
  });

  it('asks for one verdict line per field and an overall verdict, so the review reads as a checklist', () => {
    const prompt = buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS);

    expect(prompt).toContain('PASS |');
    expect(prompt).toContain('GAP |');
    expect(prompt).toContain('N/A |');
    expect(prompt).toContain('VERDICT:');
  });

  it('judges testing against the team\'s Dev → INT → REL → PROD path', () => {
    expect(buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS)).toContain('deploy to INT and test there');
  });

  it('asks for the review only — rewriting is its own round, so a long review is never cut short', () => {
    const prompt = buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS);

    expect(prompt).not.toContain(REVISED_FIELDS_HEADING);
    expect(prompt).not.toContain('IMPLEMENTATION_PLAN:');
    expect(prompt.trim().endsWith('Write nothing outside the code block.')).toBe(true);
  });
});

describe('splitRiskCheckReply', () => {
  it('separates the review a person reads from the corrected fields the app applies', () => {
    const reply = [
      'GAP | Backout Plan — no trigger — Fix: add triggers',
      'VERDICT: NOT READY — 1 gap(s).',
      REVISED_FIELDS_HEADING,
      'BACKOUT_PLAN: 1. Trigger: smoke test fails.',
    ].join('\n');

    expect(splitRiskCheckReply(reply)).toEqual({
      reviewText: 'GAP | Backout Plan — no trigger — Fix: add triggers\nVERDICT: NOT READY — 1 gap(s).',
      revisedFieldsText: 'BACKOUT_PLAN: 1. Trigger: smoke test fails.',
    });
  });

  it('treats a reply with no corrections section as review only', () => {
    expect(splitRiskCheckReply('PASS | Short Description — clear\nVERDICT: READY FOR APPROVAL')).toEqual({
      reviewText: 'PASS | Short Description — clear\nVERDICT: READY FOR APPROVAL',
      revisedFieldsText: '',
    });
  });

  it('still splits a reply whose line breaks were lost in copying (GH #395)', () => {
    const flattened = `GAP | Backout Plan — no trigger. VERDICT: NOT READY — 1 gap(s). ${REVISED_FIELDS_HEADING} `
      + 'DESCRIPTION: Current state. BACKOUT_PLAN: 1. Trigger: smoke test fails.';

    expect(splitRiskCheckReply(flattened)).toEqual({
      reviewText: 'GAP | Backout Plan — no trigger. VERDICT: NOT READY — 1 gap(s).',
      revisedFieldsText: 'DESCRIPTION: Current state.\nBACKOUT_PLAN: 1. Trigger: smoke test fails.',
    });
  });

  it('reads a reply wrapped in a code block', () => {
    const reply = `\`\`\`text\nVERDICT: READY FOR APPROVAL\n${REVISED_FIELDS_HEADING}\nTEST_PLAN: Tested.\n\`\`\``;

    expect(splitRiskCheckReply(reply)).toEqual({ reviewText: 'VERDICT: READY FOR APPROVAL', revisedFieldsText: 'TEST_PLAN: Tested.' });
  });

  it('asks for the reply inside one code block', () => {
    expect(buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS)).toContain('```text');
  });

  it('finds the heading even when the assistant decorates it', () => {
    const reply = `VERDICT: NOT READY — 1 gap(s).\n**${REVISED_FIELDS_HEADING}**\nTEST_PLAN: Tested in Dev and INT.`;

    expect(splitRiskCheckReply(reply).revisedFieldsText).toBe('TEST_PLAN: Tested in Dev and INT.');
  });
});

describe('the pass bar the check holds a change to', () => {
  const prompt = buildChgRiskCheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS);

  it('passes a field that meets its Minimum acceptable, treating the formula and evidence as guidance', () => {
    expect(prompt).toMatch(/PASS when .*Minimum acceptable/i);
    expect(prompt).toMatch(/do not fail a field for lacking them/i);
    expect(prompt).not.toMatch(/literally/i);
  });

  it('marks a field N/A when its "when required" condition does not apply', () => {
    expect(prompt).toMatch(/N\/A when .*when required/i);
  });

  it('asks for facts only the owner has as INFO, never as a gap — including [CONFIRM] placeholders', () => {
    expect(prompt).toContain('INFO |');
    expect(prompt).toMatch(/\[CONFIRM: \.\.\.\] placeholder is INFO/i);
    expect(prompt).not.toMatch(/placeholder as a GAP/i);
  });

  it('sends record fields to the change form, never to a text rewrite', () => {
    expect(prompt).toContain('RECORD |');
  });
});
