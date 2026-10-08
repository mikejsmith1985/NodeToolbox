// gapFocus.test.ts — Keeping each round of the risk-check loop to the gaps that are still open.

import { describe, expect, it } from 'vitest';

import {
  buildGapRecheckPrompt,
  isUnsettledFinding,
  mergeRecheckIntoReview,
  renderReviewText,
  resolveGapTextFields,
} from './gapFocus.ts';
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

  it('shows the whole change when a question is re-checked, since its answer can be in any field (GH #415)', () => {
    const durationQuestion: RiskCheckFinding = {
      status: 'INFO', field: 'Implementation Duration', detail: 'What is the estimated implementation duration?', fix: '',
    };

    const prompt = buildGapRecheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, [durationQuestion]);

    expect(prompt).toContain('Deploys the October release.');
    expect(prompt).toContain('Redeploy 26.9.');
    expect(prompt).toMatch(/Earlier question: What is the estimated implementation duration\?/);
    expect(prompt).toMatch(/PASS it if anything given here meets the minimum/i);
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

describe('the verdict counts only what text can fix as gaps', () => {
  const finding = (status: RiskCheckFinding['status'], field: string): RiskCheckFinding => ({ status, field, detail: '', fix: '' });

  it('is ready only when nothing is left: no gaps, no questions, no record fields', () => {
    expect(renderReviewText([finding('PASS', 'Short Description')])).toContain('VERDICT: READY FOR APPROVAL');
  });

  it('says how many facts and record fields remain when the text itself has no gaps', () => {
    const verdict = renderReviewText([finding('INFO', 'Support Coverage'), finding('INFO', 'Test Results'), finding('RECORD', 'Configuration Item')]);

    expect(verdict).toContain('VERDICT: NOT READY — no text gaps; 2 facts needed from you; 1 record field to set.');
  });

  it('leads with the text gaps when there are some', () => {
    expect(renderReviewText([finding('GAP', 'Backout Plan'), finding('INFO', 'Support Coverage')]))
      .toContain('VERDICT: NOT READY — 1 gap(s); 1 fact needed from you.');
  });

  it('treats questions and record fields as unsettled, so Check again can close them once answered', () => {
    expect(['GAP', 'NO', 'INFO', 'RECORD', 'PASS', 'N/A', 'YES'].map((status) => isUnsettledFinding(finding(status as RiskCheckFinding['status'], 'x'))))
      .toEqual([true, true, true, true, false, false, false]);
  });
});

describe('the re-check holds the same bar as the full check', () => {
  it('judges against the minimum acceptable and allows INFO and RECORD answers', () => {
    const prompt = buildGapRecheckPrompt(SAMPLE_CONTEXT, SAMPLE_FIELDS, [{ status: 'GAP', field: 'Backout Plan', detail: '', fix: '' }]);

    expect(prompt).toMatch(/PASS when .*Minimum acceptable/i);
    expect(prompt).toContain('INFO |');
    expect(prompt).toContain('RECORD |');
    expect(prompt).not.toMatch(/placeholder as a GAP/i);
  });
});
