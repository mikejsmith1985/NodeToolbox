// aiRounds.test.ts — Proves the wizard's copy-prompt / paste-reply rounds: what the prompts carry and how replies become suggestions.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { buildChecksFixPrompt, buildMultiChangeNote, buildWizardPromptContext } from './aiRounds.ts';
import type { CrgDraftState } from './changeDraft.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

function buildDraft(): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:ai-test' })).result.current.state;
  return {
    ...draft,
    generatedShortDescription: 'Payments 1.2',
    generatedJustification: 'Old justification',
    chgBasicInfo: { ...draft.chgBasicInfo, category: 'software', assignedTo: { sysId: 'u1', displayName: 'Pat Owner' } },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, plannedStartDate: '2026-11-02T19:00', plannedEndDate: '2026-11-02T21:00' },
  };
}

describe('buildWizardPromptContext', () => {
  it('describes the record facts in plain lines, only for the environments switched on', () => {
    const context = buildWizardPromptContext(buildDraft());
    expect(context.changeOwnerLabel).toBe('Pat Owner');
    expect(context.categoryLabel).toBe('software');
    expect(context.environmentLines).toEqual(['PRD: 2026-11-02T19:00 → 2026-11-02T21:00']);
  });
});

describe('one set of texts for a REL and a PRD change (GH #468)', () => {
  function buildTwoChangeDraft(): CrgDraftState {
    const draft = buildDraft();
    return {
      ...draft,
      chgBasicInfo: { ...draft.chgBasicInfo, configItem: { sysId: 'ci-prd', displayName: 'EAM - Production' } },
      relEnvironment: { ...draft.relEnvironment, isEnabled: true, plannedStartDate: '2026-10-22T19:00', plannedEndDate: '2026-10-22T21:00', configItem: { sysId: 'ci-rel', displayName: 'EAM - Release' } },
    };
  }

  it('names each change\'s own configuration item instead of one for both', () => {
    const context = buildWizardPromptContext(buildTwoChangeDraft());
    expect(context.configItemLabel).toBe('one per change — see Environments');
    expect(context.environmentLines[0]).toBe('REL: 2026-10-22T19:00 → 2026-10-22T21:00 (configuration item: EAM - Release)');
  });

  it('tells the AI the texts serve both changes, so it never asks which one it is writing for', () => {
    const noteText = buildMultiChangeNote(buildTwoChangeDraft()).join(' ');
    expect(noteText).toContain('2 separate change records');
    expect(noteText).toContain('Do not ask which change this is');
    expect(noteText).toContain('REL: … / PRD: …');
    expect(buildMultiChangeNote(buildDraft())).toEqual([]);
  });

  it('carries the note in the fix round too', () => {
    const textGap: ReadinessItem = {
      id: 'formulaBackout', label: 'Formula Card 7', state: 'needsAction', reason: 'Backout Plan is empty.',
      action: { kind: 'openStep', stepId: 'changeText', label: 'Write the Backout Plan', focusField: 'backoutPlan' },
    };
    expect(buildChecksFixPrompt(buildTwoChangeDraft(), [textGap])).toContain('Do not ask which change this is');
  });
});

describe('the checks fix round', () => {
  const textGap: ReadinessItem = {
    id: 'formulaBackout', label: 'Formula Card 7', state: 'needsAction', reason: 'Backout Plan is empty.',
    action: { kind: 'openStep', stepId: 'changeText', label: 'Write the Backout Plan', focusField: 'backoutPlan' },
  };

  it('asks for only the fields the failing checks name', () => {
    const promptText = buildChecksFixPrompt(buildDraft(), [textGap]);
    expect(promptText).toContain('Backout Plan is empty.');
    expect(promptText).toContain('BACKOUT_PLAN:');
  });

  it('offers no round when no failing check is about the writing', () => {
    const ownerGap: ReadinessItem = { ...textGap, id: 'owner', action: { kind: 'openStep', stepId: 'changeDetails', label: 'Choose an owner' } };
    expect(buildChecksFixPrompt(buildDraft(), [ownerGap])).toBeNull();
  });
});
