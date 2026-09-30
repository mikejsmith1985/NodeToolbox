// riskCheckReview.test.ts — Reading a pasted risk-check review into findings a person can scan (GH #395).

import { describe, expect, it } from 'vitest';

import { countConfirmPlaceholders, parseRiskCheckReview } from './riskCheckReview.ts';

const SAMPLE_REVIEW = [
  'PASS | Short Description — Domain, action, object and environment are clear.',
  '- GAP | Configuration Item — Description does not name the CI. — Fix: Add to DESCRIPTION: "CI: DMOM Enrollment".',
  '**GAP | Dependencies** — Statuses unresolved. — Fix: Replace the [CONFIRM:] placeholders in RISK_AND_IMPACT.',
  'N/A | Irreversibility Point — Nothing is deleted.',
  'YES | Can anyone understand exactly what is changing?',
  'NO | Can the team detect failure quickly? — No thresholds.',
  'VERDICT: NOT READY — 2 gap(s).',
  'Overall the change is close.',
].join('\n');

describe('parseRiskCheckReview', () => {
  it('reads each verdict line into status, field, problem and fix', () => {
    const review = parseRiskCheckReview(SAMPLE_REVIEW);

    expect(review.findings).toContainEqual({
      status: 'GAP',
      field: 'Configuration Item',
      detail: 'Description does not name the CI.',
      fix: 'Add to DESCRIPTION: "CI: DMOM Enrollment".',
    });
    expect(review.findings).toContainEqual({
      status: 'PASS',
      field: 'Short Description',
      detail: 'Domain, action, object and environment are clear.',
      fix: '',
    });
  });

  it('tolerates bullets and bold markup an assistant wraps lines in', () => {
    const review = parseRiskCheckReview(SAMPLE_REVIEW);

    expect(review.findings.find((finding) => finding.field === 'Dependencies')).toEqual(expect.objectContaining({
      status: 'GAP',
      fix: 'Replace the [CONFIRM:] placeholders in RISK_AND_IMPACT.',
    }));
  });

  it('keeps the quality-gate answers and the verdict', () => {
    const review = parseRiskCheckReview(SAMPLE_REVIEW);

    expect(review.findings.filter((finding) => finding.status === 'YES' || finding.status === 'NO')).toHaveLength(2);
    expect(review.verdict).toBe('NOT READY — 2 gap(s).');
    expect(review.isReady).toBe(false);
  });

  it('keeps any other lines as notes rather than dropping them', () => {
    expect(parseRiskCheckReview(SAMPLE_REVIEW).unparsedLines).toEqual(['Overall the change is close.']);
  });

  it('recognises a ready verdict', () => {
    const review = parseRiskCheckReview('PASS | Risk — Rated with rationale.\nVERDICT: READY FOR APPROVAL');

    expect(review.isReady).toBe(true);
  });
});

describe('countConfirmPlaceholders', () => {
  it('counts the [CONFIRM: …] placeholders still left in each field, skipping fields with none', () => {
    const counts = countConfirmPlaceholders({
      shortDescription: 'Enrollment | Deploy | REL',
      description: 'Used by [CONFIRM: number of users] users.',
      justification: '',
      riskImpact: '[CONFIRM: package status] and [CONFIRM: access validated]',
      implementationPlan: '',
      testPlan: '',
      backoutPlan: '',
    });

    expect(counts).toEqual([
      { fieldKey: 'description', fieldLabel: 'Description', placeholderCount: 1 },
      { fieldKey: 'riskImpact', fieldLabel: 'Risk & Impact', placeholderCount: 2 },
    ]);
  });
});
