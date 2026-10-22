// aiDraft.test.ts — Proves the "Let AI write it" round asks only for the change's texts and turns a pasted reply into
// text suggestions, never touching a pick-from-a-list value.

import { describe, expect, it, vi } from 'vitest';

import { buildAiDraftPrompt, readAiDraftReply } from './aiDraft.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';

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
  it('gives the Jira details once, and fits a large change inside the chat box limit (GH #475)', () => {
    const longIssues = Array.from({ length: 6 }, (_unused, issueIndex) => ({
      key: `BIG-${issueIndex + 1}`, fields: { summary: `Big ${issueIndex + 1}`, description: 'd'.repeat(30_000), status: { name: 'Done' }, issuetype: { name: 'Story' } },
    }));
    const promptText = buildAiDraftPrompt(buildDraft({ fetchedIssues: longIssues, selectedIssueKeys: new Set(longIssues.map((issue) => issue.key)) } as Partial<CrgDraftState>));
    expect(promptText.length).toBeLessThanOrEqual(120_000);
    expect(promptText.split('[BIG-1] Big 1').length - 1).toBe(2);
    expect(promptText).not.toContain('Jira work this change delivers');
    expect(promptText).toContain('the rest is on BIG-6 in Jira]');
    expect(promptText).toContain('BACKOUT_PLAN:');
  });

  it('asks for the seven texts from the chosen Jira work, giving the picks only as facts', () => {
    const promptText = buildAiDraftPrompt(buildDraft());
    expect(promptText).toContain('SHORT_DESCRIPTION:');
    expect(promptText).toContain('BACKOUT_PLAN:');
    expect(promptText).toContain('ABC-1');
    expect(promptText).toContain('Software');
    expect(promptText).not.toContain('PICK ');
  });

  it('gives the task timeline and the evidence on each issue, and says how the plans must use them', () => {
    const timedTask = {
      id: 'c1', name: '', createdAt: '', shortDescription: 'Deploy', description: 'Run job 12', assignmentGroup: { sysId: '', displayName: 'SCM' },
      assignedTo: { sysId: '', displayName: 'Pat' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'implementation',
      durationEstimates: { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' },
    };
    const draft = buildDraft({
      fetchedIssues: [...buildDraft().fetchedIssues, { key: 'ABC-2', fields: { summary: 'Fix logout', status: { name: 'Done' }, issuetype: { name: 'Story' } } }],
      selectedIssueKeys: new Set(['ABC-1', 'ABC-2']),
      prdEnvironment: { isEnabled: true, plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-25T01:00', configItem: { displayName: '' } },
      changeTasks: [timedTask],
    } as unknown as Partial<CrgDraftState>);
    const evidence = [{ issueKey: 'ABC-1', issueSummary: '', attachment: { filename: 'login-results.xlsx' } }] as unknown as JiraEvidenceAttachment[];
    const promptText = buildAiDraftPrompt(draft, evidence);
    expect(promptText).toContain('PRD: 2026-10-24T22:00 → 2026-10-25T01:00 (window: 3 hours)');
    expect(promptText).toContain('1. Deploy: 22:00 → 22:45 (implementation 30 minutes, validation 15 minutes, backout 20 minutes)');
    expect(promptText).toContain('Estimated durations (the CTASK estimates added up): implementation 30 min, validation 15 min, backout 20 min');
    expect(promptText).toContain('ABC-1: login-results.xlsx');
    expect(promptText).toContain('ABC-2: no files — no test evidence for this issue');
    expect(promptText).toContain('Never write "not estimated", "TBD" or "unknown" for a duration');
    expect(promptText).toContain('The Test Plan must name every Jira issue key above with the evidence file(s)');
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
