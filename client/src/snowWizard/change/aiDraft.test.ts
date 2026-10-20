// aiDraft.test.ts — Proves the "Let AI write it" round asks for every field the user would otherwise type or pick, and
// that a pasted reply becomes suggestions that only ever use ServiceNow's own list values.

import { describe, expect, it, vi } from 'vitest';

import type { SnowChoiceOptionMap } from '../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { buildAiDraftPrompt, readAiDraftReply } from './aiDraft.ts';
import type { CrgDraftState } from './changeDraft.ts';

const CHOICE_OPTIONS: SnowChoiceOptionMap = {
  category: [{ value: 'software', label: 'Software' }, { value: 'hardware', label: 'Hardware' }],
  type: [{ value: 'normal', label: 'Normal' }],
  impact: [{ value: '3', label: '3 - Low' }, { value: '2', label: '2 - Medium' }],
};

/** A draft with one selected issue and nothing written yet. */
function buildDraft(overrides: Partial<CrgDraftState> = {}): CrgDraftState {
  const issue = { key: 'ABC-1', fields: { summary: 'Fix login', status: { name: 'Done' }, issuetype: { name: 'Story' } } };
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  return {
    fetchedIssues: [issue], selectedIssueKeys: new Set(['ABC-1']),
    generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
    chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
    chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
    relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment,
    changeTasks: [],
    ...overrides,
  } as unknown as CrgDraftState;
}

const FULL_REPLY = [
  'PICK category: Software',
  'PICK impact: 3 - Low',
  'PICK type: Emergency',
  'SHORT_DESCRIPTION: Portal | deploy | login fix | 1.2 | PRD',
  'DESCRIPTION: Fixes login.',
  'IMPLEMENTATION_PLAN: 1. Deploy',
  'BACKOUT_PLAN: 1. Redeploy previous',
].join('\n');

describe('buildAiDraftPrompt', () => {
  it('asks for the seven texts and a pick for every list ServiceNow gave, listing only its values', () => {
    const promptText = buildAiDraftPrompt(buildDraft(), CHOICE_OPTIONS);
    expect(promptText).toContain('SHORT_DESCRIPTION:');
    expect(promptText).toContain('BACKOUT_PLAN:');
    expect(promptText).toContain('ABC-1');
    expect(promptText).toContain('PICK category: one of Software | Hardware');
    expect(promptText).toContain('PICK impact: one of 3 - Low | 2 - Medium');
    expect(promptText).not.toContain('PICK u_change_tested');
  });
});

describe('readAiDraftReply', () => {
  it('turns the texts and the listed picks into suggestions, and rejects a pick not on the list', () => {
    const draftReply = readAiDraftReply(FULL_REPLY, buildDraft(), CHOICE_OPTIONS);
    expect(draftReply.isUsable).toBe(true);
    expect(draftReply.suggestions.map((suggestion) => suggestion.fieldLabel)).toEqual(expect.arrayContaining([
      'Category', 'How many people does it affect?', 'Short Description', 'Description', 'Implementation Plan', 'Backout Plan',
    ]));
    expect(draftReply.suggestions.find((suggestion) => suggestion.fieldLabel === 'Backout Plan')?.suggestedText).toBe('1. Redeploy previous');
    expect(draftReply.rejectedPicks).toEqual(['Change type: “Emergency” is not on ServiceNow\'s list, so it was left for you.']);
  });

  it('writes each accepted suggestion through the draft\'s own setters, using the list value', () => {
    const writers = { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn(), setChgBasicInfo: vi.fn(), setChgPlanningAssessment: vi.fn() };
    const draftReply = readAiDraftReply(FULL_REPLY, buildDraft(), CHOICE_OPTIONS);
    draftReply.suggestions.forEach((suggestion) => suggestion.apply(writers));
    expect(writers.setChgBasicInfo).toHaveBeenCalledWith({ category: 'software' });
    expect(writers.setChgPlanningAssessment).toHaveBeenCalledWith({ impact: '3' });
    expect(writers.updateGeneratedField).toHaveBeenCalledWith('shortDescription', 'Portal | deploy | login fix | 1.2 | PRD');
    expect(writers.setChgPlanningContent).toHaveBeenCalledWith({ implementationPlan: '1. Deploy' });
  });

  it('reads all three plans from a reply that holds only the plans', () => {
    const plansOnlyReply = 'IMPLEMENTATION_PLAN: 1. Deploy\nTEST_PLAN: 1. Smoke test\nBACKOUT_PLAN: 1. Roll back';
    const draftReply = readAiDraftReply(plansOnlyReply, buildDraft(), CHOICE_OPTIONS);
    expect(draftReply.suggestions.map((suggestion) => suggestion.suggestedText)).toEqual(['1. Deploy', '1. Smoke test', '1. Roll back']);
  });

  it('skips anything that already says the same thing', () => {
    const draft = buildDraft({ generatedDescription: 'Fixes login.' } as Partial<CrgDraftState>);
    const draftReply = readAiDraftReply(FULL_REPLY, draft, CHOICE_OPTIONS);
    expect(draftReply.suggestions.map((suggestion) => suggestion.fieldLabel)).not.toContain('Description');
  });

  it('says plainly when the paste is not the reply', () => {
    const draftReply = readAiDraftReply('Sure! Here is a poem.', buildDraft(), CHOICE_OPTIONS);
    expect(draftReply.isUsable).toBe(false);
    expect(draftReply.message).toContain('does not look like');
  });
});
