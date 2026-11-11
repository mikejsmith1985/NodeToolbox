// reviewDiscussionPrompt.test.ts — Proves the discussion prompt carries the change, every verdict and the rules, and
// says plainly what could not be read instead of inventing it.

import { describe, expect, it } from 'vitest';

import { listReadinessRuleGuide } from '../../views/SnowHub/guided/changeReadinessGuide.ts';
import type { ChangeReviewResult } from './changeReview.ts';
import { buildCoachingNoteFollowUp, buildReviewDiscussionPrompt, readAssistantCoachingNote } from './reviewDiscussionPrompt.ts';

const TEXT_FIELDS = {
  shortDescription: 'Login fix', description: 'Fixes login.', justification: '', riskImpact: 'Low.',
  implementationPlan: '1. Deploy v2', testPlan: 'Smoke test login', backoutPlan: 'Revert',
};

function buildReview(overrides: Partial<ChangeReviewResult['facts']> = {}): ChangeReviewResult {
  return {
    changeNumber: 'CHG0012345',
    isChangeFound: true,
    items: [
      { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Smith, Jane.', action: null },
      { id: 'testEvidence', label: 'Test evidence', state: 'needsAction', reason: 'Nothing is attached.', action: null },
    ],
    coachingChange: { number: 'CHG0012345', creatorName: 'Smith, Jane', shortDescription: 'Login fix' },
    requesterEmail: '',
    facts: {
      change: { changeNumber: 'CHG0012345', stateLabel: 'Assess', ownerName: 'Smith, Jane', configItemName: 'Login Service' },
      textFields: TEXT_FIELDS,
      plannedWindow: { plannedStartUtc: '2026-11-07T01:00:00Z', plannedEndUtc: '2026-11-07T03:00:00Z' },
      isProduction: true,
      ...overrides,
    },
  };
}

describe('buildReviewDiscussionPrompt', () => {
  it('carries the record, the text, every verdict and the rules, then how to discuss it', () => {
    const promptText = buildReviewDiscussionPrompt(buildReview(), listReadinessRuleGuide(new Set(['riskCheck', 'prbs'])));
    expect(promptText).toContain('Change: CHG0012345');
    expect(promptText).toContain('Configuration item: Login Service');
    expect(promptText).toContain('Environment: Production');
    expect(promptText).toContain('Backout Plan:\nRevert');
    expect(promptText).toContain('Justification:\n(empty)');
    expect(promptText).toContain('- Test evidence: NEEDS ACTION — Nothing is attached.');
    expect(promptText).toContain('- Change owner: PASSED — Owned by Smith, Jane.');
    expect(promptText).toContain('Approved implementation window:');
    expect(promptText).toMatch(/ask me one question at a time/);
    expect(promptText.indexOf('THE CHANGE TEXT')).toBeLessThan(promptText.indexOf('WHAT THE WIZARD FOUND'));
  });

  it('says what could not be read instead of guessing', () => {
    const promptText = buildReviewDiscussionPrompt(buildReview({ textFields: null, plannedWindow: null, isProduction: null }), []);
    expect(promptText).toContain('Description: (could not be read)');
    expect(promptText).toContain('Planned window: (could not be read)');
    expect(promptText).toContain('Environment: (could not be read)');
  });
});

describe('the coaching note round trip', () => {
  it('tells the assistant how to hand back the agreed note, addressed to the creator', () => {
    const promptText = buildReviewDiscussionPrompt(buildReview(), []);
    expect(promptText).toContain('When I say "write the note", write a coaching note to Smith, Jane, who raised CHG0012345');
    expect(promptText).toContain('between a line "COACHING NOTE START" and a line "COACHING NOTE END"');
  });

  it('lifts the note out of a chatty reply, ignoring bold markers and code fences', () => {
    const replyText = [
      'Here is the note we agreed:',
      '**COACHING NOTE START**',
      '```',
      'Hi Jane,',
      '1. Attach the test evidence.',
      '```',
      '**COACHING NOTE END**',
      'Anything else?',
    ].join('\n');
    expect(readAssistantCoachingNote(replyText)).toBe('Hi Jane,\n1. Attach the test evidence.');
  });

  it('finds no note in a reply without both markers, or with nothing between them', () => {
    expect(readAssistantCoachingNote('Which environment is this for?')).toBeNull();
    expect(readAssistantCoachingNote('COACHING NOTE START\nHi Jane,')).toBeNull();
    expect(readAssistantCoachingNote('COACHING NOTE START\n\nCOACHING NOTE END')).toBeNull();
  });
});

describe('reading a note from Google AI Mode (GH #499)', () => {
  it('reads a note written under a heading, without the intro or the closing offer', () => {
    const replyText = [
      'Here is a coaching note based on what we agreed.',
      '',
      '## Coaching Note for Jane',
      'Hi Jane,',
      '1. Attach the test evidence.',
      '2. Name the validation owner.',
      '',
      'If you would like, I can make it shorter.',
    ].join('\n');

    expect(readAssistantCoachingNote(replyText)).toBe('Hi Jane,\n1. Attach the test evidence.\n2. Name the validation owner.');
  });

  it('reads a note that starts straight at its greeting', () => {
    expect(readAssistantCoachingNote('Sure.\n\nHello Jane,\n1. Link the outage.\n\nWould you like me to add more?')).toBe('Hello Jane,\n1. Link the outage.');
  });

  it('never takes a greeting with no points — the assistant talking — as the note', () => {
    expect(readAssistantCoachingNote('Hi! Before I write it, which environment is this for?')).toBeNull();
  });

  it('offers a follow-up asking for the note between the markers', () => {
    expect(buildCoachingNoteFollowUp()).toContain('between a line "COACHING NOTE START" and a line "COACHING NOTE END"');
  });
});
