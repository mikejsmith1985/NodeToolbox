// aiRounds.test.ts — Proves the wizard's copy-prompt / paste-reply rounds: what the prompts carry and how replies become suggestions.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { buildChecksFixPrompt, buildEnhancePrompt, buildWizardPromptContext, readEnhanceReply, readFixReply } from './aiRounds.ts';
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

describe('the Make-it-better round', () => {
  it('asks for the Release Manager review of the whole change', () => {
    const promptText = buildEnhancePrompt(buildDraft());
    expect(promptText).toContain('Release Manager');
    expect(promptText).toContain('Payments 1.2');
  });

  it('reads the verdict, the gaps and one suggestion per changed field', () => {
    const replyText = [
      'GAP | Justification — too vague — Fix: name the driver',
      'PASS | Short Description — fine',
      'VERDICT: READY FOR APPROVAL',
      '=== REVISED FIELDS ===',
      'SHORT_DESCRIPTION: Payments 1.2',
      'JUSTIFICATION: New justification',
    ].join('\n');
    const reply = readEnhanceReply(replyText, buildDraft());
    expect(reply.isUsable).toBe(true);
    expect(reply.isReady).toBe(true);
    expect(reply.gapLines).toEqual(['Justification — too vague']);
    expect(reply.suggestions).toEqual([{ fieldKey: 'justification', fieldLabel: 'Justification', currentText: 'Old justification', suggestedText: 'New justification' }]);
  });

  it('rejects a reply that is not a review, applying nothing', () => {
    const reply = readEnhanceReply('Sure! Happy to help with anything else.', buildDraft());
    expect(reply.isUsable).toBe(false);
    expect(reply.suggestions).toEqual([]);
    expect(reply.message).toMatch(/does not look like the review/);
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

  it('turns the reply into suggestions', () => {
    expect(readFixReply('BACKOUT_PLAN: 1. Restore the previous build', buildDraft())).toEqual([
      { fieldKey: 'backoutPlan', fieldLabel: 'Backout Plan', currentText: '', suggestedText: '1. Restore the previous build' },
    ]);
  });
});
