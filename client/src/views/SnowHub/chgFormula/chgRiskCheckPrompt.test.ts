// chgRiskCheckPrompt.test.ts — The Release Manager's pre-approval check, as a copy-out prompt (GH #395).

import { describe, expect, it } from 'vitest';

import { buildChgRiskCheckPrompt } from './chgRiskCheckPrompt.ts';

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
});
