// reviewLoop.test.ts — Proves the review → fix → review-again loop: rounds, history, decisions, and where each gap is fixed.

import { describe, expect, it } from 'vitest';

import type { RiskCheckFinding } from '../../views/SnowHub/chgFormula/riskCheckReview.ts';
import type { FieldSuggestion } from './aiRounds.ts';
import {
  countThingsToFix,
  createReviewLoop,
  readFixRoundFindings,
  recordFixSuggestions,
  recordReviewRound,
  recordSuggestionDecision,
  resolveFindingStepId,
  startFixRound,
  startNextReview,
} from './reviewLoop.ts';

const JUSTIFICATION_GAP: RiskCheckFinding = { status: 'GAP', field: 'Justification', detail: 'too vague', fix: '' };
const OWNER_QUESTION: RiskCheckFinding = { status: 'INFO', field: 'Validation Owner', detail: 'who checks it?', fix: '' };
const CONFIG_ITEM_RECORD: RiskCheckFinding = { status: 'RECORD', field: 'Configuration Item', detail: 'not set', fix: '' };
const SUGGESTION: FieldSuggestion = { fieldKey: 'justification', fieldLabel: 'Justification', currentText: 'Old', suggestedText: 'New' };

describe('the review loop', () => {
  it('starts on round 1, waiting for a review, with no history', () => {
    expect(createReviewLoop()).toEqual({ roundNumber: 1, stage: 'review', latestReview: null, suggestions: [], decisions: {}, history: [] });
  });

  it('records a review: its verdict, what is left to fix, its suggestions, and one history line', () => {
    const loop = recordReviewRound(createReviewLoop(), { isReady: false, openFindings: [JUSTIFICATION_GAP, CONFIG_ITEM_RECORD], suggestions: [SUGGESTION] });
    expect(loop.latestReview).toEqual({ isReady: false, openFindings: [JUSTIFICATION_GAP, CONFIG_ITEM_RECORD] });
    expect(loop.suggestions).toEqual([SUGGESTION]);
    expect(loop.history).toEqual([{ roundNumber: 1, isReady: false, thingsToFixCount: 2 }]);
  });

  it('starts the next round when another review is pasted, so the count always moves on (owner bug: stuck on Round 1)', () => {
    const firstRead = recordReviewRound(createReviewLoop(), { isReady: false, openFindings: [JUSTIFICATION_GAP], suggestions: [] });
    const secondRead = recordReviewRound(firstRead, { isReady: true, openFindings: [], suggestions: [] });
    expect(secondRead.roundNumber).toBe(2);
    expect(secondRead.history).toEqual([
      { roundNumber: 1, isReady: false, thingsToFixCount: 1 },
      { roundNumber: 2, isReady: true, thingsToFixCount: 0 },
    ]);
  });

  it('moves to a fix round for the same gaps, and its reply replaces the suggestions with fresh decisions', () => {
    const reviewed = recordSuggestionDecision(
      recordReviewRound(createReviewLoop(), { isReady: false, openFindings: [JUSTIFICATION_GAP], suggestions: [SUGGESTION] }), 'justification', 'declined');
    const fixing = startFixRound(reviewed);
    expect(fixing.stage).toBe('fix');
    expect(fixing.latestReview?.openFindings).toEqual([JUSTIFICATION_GAP]);
    const fixed = recordFixSuggestions(fixing, [{ ...SUGGESTION, suggestedText: 'Newer' }]);
    expect(fixed.suggestions[0].suggestedText).toBe('Newer');
    expect(fixed.decisions).toEqual({});
  });

  it('starts the next round fresh, keeping the history', () => {
    const reviewed = recordReviewRound(createReviewLoop(), { isReady: false, openFindings: [JUSTIFICATION_GAP], suggestions: [SUGGESTION] });
    const nextRound = startNextReview(startFixRound(reviewed));
    expect(nextRound).toMatchObject({ roundNumber: 2, stage: 'review', latestReview: null, suggestions: [], decisions: {} });
    expect(nextRound.history).toHaveLength(1);
  });

  it('remembers each Accept or Decline by field', () => {
    expect(recordSuggestionDecision(createReviewLoop(), 'testPlan', 'accepted').decisions).toEqual({ testPlan: 'accepted' });
  });
});

describe('what each finding needs', () => {
  it('sends text gaps and questions to the fix round, never record fields', () => {
    expect(readFixRoundFindings([JUSTIFICATION_GAP, OWNER_QUESTION, CONFIG_ITEM_RECORD])).toEqual([JUSTIFICATION_GAP, OWNER_QUESTION]);
  });

  it('counts everything still to fix', () => {
    expect(countThingsToFix([JUSTIFICATION_GAP, OWNER_QUESTION, CONFIG_ITEM_RECORD])).toBe(3);
  });

  it('sends a record field to the step that holds it', () => {
    expect(resolveFindingStepId(CONFIG_ITEM_RECORD)).toBe('details');
    expect(resolveFindingStepId({ ...CONFIG_ITEM_RECORD, field: 'Planned Start' })).toBe('environments');
    expect(resolveFindingStepId({ ...CONFIG_ITEM_RECORD, field: 'Change Owner' })).toBe('details');
    expect(resolveFindingStepId({ ...CONFIG_ITEM_RECORD, field: 'Change tasks' })).toBe('tasks');
    expect(resolveFindingStepId({ ...CONFIG_ITEM_RECORD, field: 'Test evidence attachment' })).toBe('evidence');
    expect(resolveFindingStepId({ ...CONFIG_ITEM_RECORD, field: 'Something unusual' })).toBe('details');
  });

  it('sends a gap no rewrite can close to its step, and leaves rewritable gaps and questions to the fix round', () => {
    expect(resolveFindingStepId({ ...JUSTIFICATION_GAP, field: 'Maintenance window dates' })).toBe('environments');
    expect(resolveFindingStepId(JUSTIFICATION_GAP)).toBeNull();
    expect(resolveFindingStepId(OWNER_QUESTION)).toBeNull();
  });
});
