// aiDraft.test.ts — Proves the "Let AI write it" round asks only for the change's texts and turns a pasted reply into
// text suggestions, never touching a pick-from-a-list value.

import { describe, expect, it, vi } from 'vitest';

import { buildAiDraftPrompt, readAiDraftReply } from './aiDraft.ts';
import type { CrgDraftState } from './changeDraft.ts';

/** A draft with one selected issue, its picks already made, and nothing written yet. */
function buildDraft(overrides: Partial<CrgDraftState> = {}): CrgDraftState {
  const issue = { key: 'ABC-1', fields: { summary: 'Fix login', status: { name: 'Done' }, issuetype: { name: 'Story' } } };
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  return {
    fetchedIssues: [issue], selectedIssueKeys: new Set(['ABC-1']),
    generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
    chgPlanningAssessment: { impact: '3', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
    chgBasicInfo: { category: 'Software', changeType: 'Normal', isExpedited: false, configItem: { displayName: 'Portal' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
    relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment,
    changeTasks: [],
    ...overrides,
  } as unknown as CrgDraftState;
}

const FULL_REPLY = [
  'SHORT_DESCRIPTION: Portal | deploy | login fix | 1.2 | PRD',
  'DESCRIPTION: Fixes login.',
  'IMPLEMENTATION_PLAN: 1. Deploy',
  'BACKOUT_PLAN: 1. Redeploy previous',
].join('\n');

describe('buildAiDraftPrompt', () => {
  it('asks for the seven texts from the chosen Jira work, giving the picks only as facts', () => {
    const promptText = buildAiDraftPrompt(buildDraft());
    expect(promptText).toContain('SHORT_DESCRIPTION:');
    expect(promptText).toContain('BACKOUT_PLAN:');
    expect(promptText).toContain('ABC-1');
    expect(promptText).toContain('Software');
    expect(promptText).not.toContain('PICK ');
  });
});

describe('readAiDraftReply', () => {
  it('turns each text in the reply into a suggestion', () => {
    const draftReply = readAiDraftReply(FULL_REPLY, buildDraft());
    expect(draftReply.isUsable).toBe(true);
    expect(draftReply.suggestions.map((suggestion) => suggestion.fieldLabel)).toEqual([
      'Short Description', 'Description', 'Implementation Plan', 'Backout Plan',
    ]);
  });

  it('writes accepted texts through the draft\'s own setters and nothing else', () => {
    const writers = { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn() };
    readAiDraftReply(FULL_REPLY, buildDraft()).suggestions.forEach((suggestion) => suggestion.apply(writers));
    expect(writers.updateGeneratedField).toHaveBeenCalledWith('shortDescription', 'Portal | deploy | login fix | 1.2 | PRD');
    expect(writers.setChgPlanningContent).toHaveBeenCalledWith({ implementationPlan: '1. Deploy' });
  });

  it('reads all three plans from a reply that holds only the plans', () => {
    const plansOnlyReply = 'IMPLEMENTATION_PLAN: 1. Deploy\nTEST_PLAN: 1. Smoke test\nBACKOUT_PLAN: 1. Roll back';
    const draftReply = readAiDraftReply(plansOnlyReply, buildDraft());
    expect(draftReply.suggestions.map((suggestion) => suggestion.suggestedText)).toEqual(['1. Deploy', '1. Smoke test', '1. Roll back']);
  });

  it('skips anything that already says the same thing', () => {
    const draft = buildDraft({ generatedDescription: 'Fixes login.' } as Partial<CrgDraftState>);
    expect(readAiDraftReply(FULL_REPLY, draft).suggestions.map((suggestion) => suggestion.fieldLabel)).not.toContain('Description');
  });

  it('says plainly when the paste is not the reply', () => {
    const draftReply = readAiDraftReply('Sure! Here is a poem.', buildDraft());
    expect(draftReply.isUsable).toBe(false);
    expect(draftReply.message).toContain('does not look like');
  });
});
