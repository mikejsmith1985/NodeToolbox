// chgGapFixPrompt.test.ts — The "fix these gaps" round of the risk-check loop (GH #395).

import { describe, expect, it } from 'vitest';

import { buildChgGapFixPrompt } from './chgGapFixPrompt.ts';
import type { RiskCheckFinding } from './riskCheckReview.ts';

const SAMPLE_CONTEXT = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Enrollment Web',
  assignmentGroupLabel: 'Enrollment Dev',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: ['PRD: Enabled — 2026-10-14 20:00 → 2026-10-14 22:00 — Config Item: Enrollment Web'],
  assessmentLines: [],
  changeTaskLines: [],
};

const SAMPLE_FIELDS = {
  shortDescription: 'Enrollment | Deploy 26.10 | PROD',
  description: 'Deploys the October release.',
  justification: 'Planned release.',
  riskImpact: 'Low.',
  implementationPlan: '1. Deploy.',
  testPlan: 'Tested in Dev and INT.',
  backoutPlan: 'Redeploy 26.9.',
};

const SAMPLE_GAPS: RiskCheckFinding[] = [
  { status: 'GAP', field: 'Backout Trigger', detail: 'No trigger stated.', fix: 'Add smoke-test failure as a trigger in BACKOUT_PLAN.' },
  { status: 'NO', field: 'Can the team detect failure quickly?', detail: 'No thresholds.', fix: '' },
];

describe('buildChgGapFixPrompt — only what the gaps touch', () => {
  it('shows and asks for only the fields that have gaps, so the reply is short and direct', () => {
    const prompt = buildChgGapFixPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, [SAMPLE_GAPS[0]]);

    expect(prompt).toContain('Backout Plan:\nRedeploy 26.9.');
    expect(prompt).toContain('BACKOUT_PLAN:');
    expect(prompt).not.toContain('Deploys the October release.');
    expect(prompt).not.toContain('IMPLEMENTATION_PLAN:');
  });
});

describe('buildChgGapFixPrompt', () => {
  it('hands over every gap and failed gate question with its suggested fix', () => {
    const prompt = buildChgGapFixPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, SAMPLE_GAPS);

    expect(prompt).toContain('Backout Trigger — No trigger stated. — Fix: Add smoke-test failure as a trigger in BACKOUT_PLAN.');
    expect(prompt).toContain('Can the team detect failure quickly? — No thresholds.');
  });

  it('gives the change as it stands and the record facts, so the rewrite keeps what is already right', () => {
    const prompt = buildChgGapFixPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, SAMPLE_GAPS);

    expect(prompt).toContain('Backout Plan:\nRedeploy 26.9.');
    expect(prompt).toContain('Change owner (Assigned to): Smith, Mike');
  });

  it('asks for whole rewritten fields in the field markers, only for fields it changes, in a code block', () => {
    const prompt = buildChgGapFixPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, SAMPLE_GAPS);

    ['BACKOUT_PLAN:', 'TEST_PLAN:'].forEach((marker) => expect(prompt).toContain(marker));
    expect(prompt).toContain('complete rewritten text');
    expect(prompt).toContain('leave out any field you did not change');
    expect(prompt).toContain('```text');
  });

  it('keeps the no-invention rule and the card rules, so a fix cannot be a made-up fact', () => {
    const prompt = buildChgGapFixPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, SAMPLE_GAPS);

    expect(prompt).toContain('[CONFIRM:');
    expect(prompt).toContain('Trigger + decision owner + restoration steps + recovery source + duration + validation.');
  });
});
