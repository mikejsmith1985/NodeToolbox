// gapFocus.test.ts — Keeping each round of the risk-check loop to the gaps that are still open.

import { describe, expect, it } from 'vitest';

import { buildGapRecheckPrompt, mergeRecheckIntoReview, resolveGapTextFields } from './gapFocus.ts';
import type { RiskCheckFinding } from './riskCheckReview.ts';

const SAMPLE_CONTEXT = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Enrollment Web',
  assignmentGroupLabel: 'Enrollment Dev',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: [],
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

const backoutTriggerGap: RiskCheckFinding = {
  status: 'GAP', field: 'Backout Trigger', detail: 'No trigger.', fix: 'Add smoke-test failure.',
};
const blastRadiusGap: RiskCheckFinding = {
  status: 'GAP', field: 'Blast Radius', detail: 'No consumers.', fix: 'List downstream consumers.',
};

describe('resolveGapTextFields', () => {
  it('maps each gap to the text field that answers it, once each, in form order', () => {
    expect(resolveGapTextFields([backoutTriggerGap, blastRadiusGap, { ...backoutTriggerGap, field: 'Recovery Point' }]))
      .toEqual(['riskImpact', 'backoutPlan']);
  });

  it('maps a failed quality-gate question to the field that would answer it', () => {
    expect(resolveGapTextFields([{ status: 'NO', field: 'Can the team detect failure quickly?', detail: '', fix: '' }]))
      .toEqual(['testPlan']);
  });

  it('leaves out record fields, which text cannot fix', () => {
    expect(resolveGapTextFields([{ status: 'GAP', field: 'Configuration Item', detail: '', fix: '' }])).toEqual([]);
  });

  it('prefers the exact card field, so "Impact" is not also read as "Data Impact"', () => {
    expect(resolveGapTextFields([{ status: 'GAP', field: 'Impact', detail: '', fix: '' }])).toEqual(['riskImpact']);
  });

  it('tolerates a field name the assistant reworded slightly', () => {
    expect(resolveGapTextFields([{ status: 'GAP', field: 'backout trigger(s)', detail: '', fix: '' }])).toEqual(['backoutPlan']);
  });
});

describe('buildGapRecheckPrompt', () => {
  it('re-checks only the open gaps, against their own card rules, and shows only the fields they live in', () => {
    const prompt = buildGapRecheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, [backoutTriggerGap]);

    expect(prompt).toContain('Backout Trigger');
    expect(prompt).toContain('Observable threshold or failed check + elapsed-time trigger + last safe decision point.');
    expect(prompt).toContain('Backout Plan:\nRedeploy 26.9.');
    expect(prompt).not.toContain('Deploys the October release.');
    expect(prompt).not.toContain('Blast Radius');
  });

  it('asks for one verdict line per gap and a verdict, in a code block', () => {
    const prompt = buildGapRecheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, [backoutTriggerGap]);

    expect(prompt).toContain('PASS |');
    expect(prompt).toContain('VERDICT:');
    expect(prompt).toContain('```text');
  });
});

describe('mergeRecheckIntoReview', () => {
  const PREVIOUS_REVIEW = [
    'PASS | Short Description — Clear.',
    'GAP | Backout Trigger — No trigger. — Fix: Add smoke-test failure.',
    'GAP | Blast Radius — No consumers. — Fix: List downstream consumers.',
    'VERDICT: NOT READY — 2 gap(s).',
  ].join('\n');

  it('replaces the re-checked findings and recalculates the verdict, keeping everything else', () => {
    const merged = mergeRecheckIntoReview(PREVIOUS_REVIEW, 'PASS | Backout Trigger — Smoke-test failure is now a trigger.\nVERDICT: READY FOR APPROVAL');

    expect(merged).toContain('PASS | Short Description — Clear.');
    expect(merged).toContain('PASS | Backout Trigger — Smoke-test failure is now a trigger.');
    expect(merged).toContain('GAP | Blast Radius — No consumers. — Fix: List downstream consumers.');
    expect(merged).toContain('VERDICT: NOT READY — 1 gap(s).');
  });

  it('declares the change ready once no gap or failed gate question is left', () => {
    const merged = mergeRecheckIntoReview(
      PREVIOUS_REVIEW,
      'PASS | Backout Trigger — Stated.\nPASS | Blast Radius — Consumers listed.\nVERDICT: READY FOR APPROVAL',
    );

    expect(merged).toContain('VERDICT: READY FOR APPROVAL');
  });

  it('matches re-checked findings to the earlier ones regardless of case', () => {
    expect(mergeRecheckIntoReview(PREVIOUS_REVIEW, 'PASS | backout trigger — Stated.')).not.toContain('GAP | Backout Trigger');
  });
});
