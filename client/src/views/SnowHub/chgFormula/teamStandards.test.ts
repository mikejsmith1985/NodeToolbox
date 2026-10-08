// teamStandards.test.ts — The team's standing answers settle their card fields, whatever the review says (GH #415).

import { describe, expect, it } from 'vitest';

import { parseRiskCheckReview } from './riskCheckReview.ts';
import { buildTeamStandardLines, describeDurationFacts } from './chgPromptContext.ts';
import { applyTeamStandards } from './teamStandards.ts';
import { DEFAULT_TEAM_STANDARDS } from './teamStandardsStore.ts';

const ESTIMATES = { implementationMinutes: '30', validationMinutes: '20', backoutMinutes: '25' };
const NO_ESTIMATES = { implementationMinutes: '', validationMinutes: '', backoutMinutes: '' };

/** The status the settled review gives one field. */
function readStatus(reviewText: string, fieldName: string): string | undefined {
  return parseRiskCheckReview(reviewText).findings.find((finding) => finding.field === fieldName)?.status;
}

describe('applyTeamStandards', () => {
  it('settles the bridge, test results and escalation path from the team\'s standing answers', () => {
    const reviewText = [
      'INFO | Bridge or Command Center — What bridge will be used?',
      'INFO | Test Results — What are the REL results?',
      'GAP | Escalation Path — No contacts. — Fix: Name them.',
      'VERDICT: NOT READY — 1 gap(s).',
    ].join('\n');

    const settledText = applyTeamStandards(reviewText, NO_ESTIMATES);

    expect(readStatus(settledText, 'Bridge or Command Center')).toBe('PASS');
    expect(readStatus(settledText, 'Test Results')).toBe('PASS');
    expect(readStatus(settledText, 'Escalation Path')).toBe('PASS');
    expect(settledText).toMatch(/CI Director/);
    expect(parseRiskCheckReview(settledText).isReady).toBe(true);
  });

  it('settles every duration and the recovery time from the CTASK estimates', () => {
    const reviewText = [
      'INFO | Implementation Duration — How long?',
      'INFO | Validation Duration — How long?',
      'GAP | Backout Duration — Not stated. — Fix: State it.',
      'INFO | Recovery Time — How long to restore?',
      'VERDICT: NOT READY — 1 gap(s).',
    ].join('\n');

    const settledText = applyTeamStandards(reviewText, ESTIMATES);

    expect(settledText).toContain('PASS | Implementation Duration — 30 min');
    expect(settledText).toContain('PASS | Validation Duration — 20 min');
    expect(settledText).toContain('PASS | Backout Duration — 25 min');
    expect(settledText).toContain('PASS | Recovery Time — 25 min');
    expect(settledText).toContain('VERDICT: READY FOR APPROVAL');
  });

  it('leaves a duration to the review when its phase has no estimate', () => {
    const reviewText = 'INFO | Validation Duration — How long?\nVERDICT: NOT READY — no text gaps.';

    expect(readStatus(applyTeamStandards(reviewText, NO_ESTIMATES), 'Validation Duration')).toBe('INFO');
  });

  it('keeps every other finding, and returns the review untouched when nothing is settled', () => {
    const reviewText = 'GAP | Backout Trigger — No trigger. — Fix: Add one.\nVERDICT: NOT READY — 1 gap(s).';

    expect(applyTeamStandards(reviewText, ESTIMATES)).toBe(reviewText);
  });
});

describe('the standards as prompt facts', () => {
  it('states each standing answer and that durations and recovery time are calculated, never asked', () => {
    const standardsText = buildTeamStandardLines(DEFAULT_TEAM_STANDARDS).join('\n');

    expect(standardsText).toMatch(/bridge[\s\S]*after the change is approved/i);
    expect(standardsText).toMatch(/test evidence is always attached/i);
    expect(standardsText).toMatch(/CI Director/);
    expect(standardsText).toMatch(/calculate[\s\S]*never ask/i);
  });

  it('gives the CTASK estimates as the change\'s durations, or nothing when there are none', () => {
    expect(describeDurationFacts(ESTIMATES)).toBe(
      'Estimated durations (the CTASK estimates added up): implementation 30 min, validation 20 min, backout 25 min; '
        + 'recovery time 25 min.',
    );
    expect(describeDurationFacts(NO_ESTIMATES)).toBe('');
  });
});

describe('edited standards (Admin Hub)', () => {
  it('settles a field with the edited answer, and leaves a removed standard to the review', () => {
    const editedStandards = [{ fieldName: 'Escalation Path', answer: 'Start with the on-call lead.' }];
    const reviewText = [
      'INFO | Escalation Path — Who escalates?',
      'INFO | Bridge or Command Center — What bridge?',
      'VERDICT: NOT READY — no text gaps.',
    ].join('\n');

    const settledText = applyTeamStandards(reviewText, NO_ESTIMATES, editedStandards);

    expect(settledText).toContain('PASS | Escalation Path — Start with the on-call lead. (team standard)');
    expect(readStatus(settledText, 'Bridge or Command Center')).toBe('INFO');
  });

  it('states the edited answers to the assistant', () => {
    const standardsText = buildTeamStandardLines([{ fieldName: 'Bridge or Command Center', answer: 'Teams call at 8 PM.' }]).join('\n');

    expect(standardsText).toContain('- Bridge or Command Center: Teams call at 8 PM.');
    expect(standardsText).not.toContain('CI Director');
  });
});

describe('the change owner (GH #415)', () => {
  it('passes Change Owner when the change has an Assigned to — the owner is that person', () => {
    const reviewText = 'RECORD | Change Owner — Set the Assigned To field to the accountable owner.\nVERDICT: NOT READY — no text gaps.';

    const settledText = applyTeamStandards(reviewText, NO_ESTIMATES, DEFAULT_TEAM_STANDARDS, 'Smith, Mike');

    expect(settledText).toContain('PASS | Change Owner — Smith, Mike (the change\'s Assigned to)');
    expect(readStatus(applyTeamStandards(reviewText, NO_ESTIMATES, DEFAULT_TEAM_STANDARDS, ''), 'Change Owner')).toBe('RECORD');
  });
});
