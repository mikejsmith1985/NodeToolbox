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

  it('reads every finding from a review whose line breaks were lost in copying (GH #395)', () => {
    const flattened = 'PASS | Short Description — Clear. GAP | Blast Radius — Missing. — Fix: Add consumers. '
      + 'N/A | Irreversibility Point — Nothing deleted. NO | Can the team detect failure quickly? — No thresholds. '
      + 'VERDICT: NOT READY — 1 gap(s).';

    const review = parseRiskCheckReview(flattened);

    expect(review.findings.map((finding) => finding.status)).toEqual(['PASS', 'GAP', 'N/A', 'NO']);
    expect(review.findings[1]).toEqual({ status: 'GAP', field: 'Blast Radius', detail: 'Missing.', fix: 'Add consumers.' });
    expect(review.verdict).toBe('NOT READY — 1 gap(s).');
  });

  it('recognises a ready verdict', () => {
    const review = parseRiskCheckReview('PASS | Risk — Rated with rationale.\nVERDICT: READY FOR APPROVAL');

    expect(review.isReady).toBe(true);
  });
});

describe('parseRiskCheckReview with a Google AI Mode reply (GH #499)', () => {
  const MARKDOWN_TABLE_REPLY = [
    'Here is the Release Manager review of your change, judged against the Formula Card.',
    '',
    'RISK_CHECK_TABLE:',
    '| Item | Answer | Finding | Fix |',
    '|:---|:---:|---|---|',
    '| **Short Description** | ✅ PASS | Domain, action and environment are clear. | — |',
    '| Blast Radius | GAP | No downstream consumers named. | List the consumers in RISK_AND_IMPACT. |',
    '| Validation Owner | Needs info | Who validates in production? | ___ |',
    '| Irreversibility Point | N/A | Nothing is deleted. | ___ |',
    '| Is success objective? | No | Success is not measurable. | Add pass/fail criteria to TEST_PLAN. |',
    '| Backout Trigger | ___ | ___ | ___ |',
    '',
    'If you provide the validation owner, I can re-check the change.',
  ].join('\n');

  it('reads a markdown table, its columns found by header — the intro and closing offer are never read as findings', () => {
    const review = parseRiskCheckReview(MARKDOWN_TABLE_REPLY);

    expect(review.findings).toEqual([
      { status: 'PASS', field: 'Short Description', detail: 'Domain, action and environment are clear.', fix: '' },
      { status: 'GAP', field: 'Blast Radius', detail: 'No downstream consumers named.', fix: 'List the consumers in RISK_AND_IMPACT.' },
      { status: 'INFO', field: 'Validation Owner', detail: 'Who validates in production?', fix: '' },
      { status: 'N/A', field: 'Irreversibility Point', detail: 'Nothing is deleted.', fix: '' },
      { status: 'NO', field: 'Is success objective?', detail: 'Success is not measurable.', fix: 'Add pass/fail criteria to TEST_PLAN.' },
    ]);
  });

  it('counts the verdict itself, since a table carries no VERDICT line', () => {
    const review = parseRiskCheckReview(MARKDOWN_TABLE_REPLY);

    expect(review.verdict).toBe('NOT READY — 2 gap(s); 1 fact needed from you.');
    expect(review.isReady).toBe(false);
  });

  it('reads a tab-separated table pasted from the web page, with its columns in another order', () => {
    const tabReply = ['Answer\tItem\tFinding', 'PASS\tShort Description\tClear.', 'PASS\tRisk\tRated.'].join('\n');

    const review = parseRiskCheckReview(tabReply);

    expect(review.findings.map((finding) => `${finding.status} ${finding.field}`)).toEqual(['PASS Short Description', 'PASS Risk']);
    expect(review.isReady).toBe(true);
  });

  it('lets a follow-up\'s row replace the first reply\'s row for the same item', () => {
    const firstReply = 'Item | Answer | Finding | Fix\nBlast Radius | GAP | Missing. | Add it.';
    const followUpReply = 'Item | Answer | Finding | Fix\nBlast Radius | PASS | Now listed. | ___';

    expect(parseRiskCheckReview(`${firstReply}\n${followUpReply}`).findings).toEqual([
      { status: 'PASS', field: 'Blast Radius', detail: 'Now listed.', fix: '' },
    ]);
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

describe('facts only the owner has, and record fields', () => {
  it('reads NEEDS INFO and RECORD lines as their own statuses', () => {
    const review = parseRiskCheckReview([
      'INFO | Support Coverage — Who is on call during the window?',
      'NEEDS INFO | Test Results — What did the REL smoke test show?',
      'RECORD | Configuration Item — Set the CI to the service being changed.',
    ].join('\n'));

    expect(review.findings.map((finding) => [finding.status, finding.field])).toEqual([
      ['INFO', 'Support Coverage'],
      ['INFO', 'Test Results'],
      ['RECORD', 'Configuration Item'],
    ]);
  });
});
