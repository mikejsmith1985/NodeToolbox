// useTemplateLibrary.test.ts — Proves the Wizard saves, replaces and imports templates into Toolbox's own template stores.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { decodeTemplateShare, encodeTemplateShareCode } from './templateShare.ts';
import { buildTaskTemplateData } from './templateSave.ts';
import { useTemplateLibrary, type TemplateDraft } from './useTemplateLibrary.ts';

const BLANK = { sysId: '', displayName: '' };
const ENVIRONMENT = { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: BLANK, impactedPersonsAware: '', snowEnvironmentValue: '' };

function buildTask(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: 'staged-1', name: 'CTASK1', createdAt: '', shortDescription: 'Business Checkout', description: '', assignmentGroup: BLANK,
    assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '', ...overrides,
  };
}

function buildDraft(changeTasks: CtaskTemplate[], backoutPlan = '1. Roll back'): TemplateDraft {
  return {
    shortDescriptionConfig: { application: '', team: '', changeDetailsOverride: '' },
    chgBasicInfo: {
      category: 'software', changeType: 'normal', environment: '', requestedBy: BLANK, configItem: BLANK, assignmentGroup: BLANK, assignedTo: BLANK,
      changeManager: BLANK, tester: BLANK, serviceManager: BLANK, isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '',
    },
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan, testPlan: '' },
    customSnowFields: {}, relEnvironment: ENVIRONMENT, prdEnvironment: ENVIRONMENT, pfixEnvironment: ENVIRONMENT,
    ctaskTemplateIds: [], reconcileAutoCtasks: false, changeTasks,
  } as TemplateDraft;
}

describe('useTemplateLibrary', () => {
  beforeEach(() => localStorage.clear());

  it('saves the draft with its staged tasks as linked task templates', () => {
    const { result } = renderHook(() => useTemplateLibrary());
    act(() => result.current.saveDraftAsTemplate('Monthly', buildDraft([buildTask()])));
    const [savedTemplate] = result.current.templates;
    expect(savedTemplate.name).toBe('Monthly');
    expect(result.current.listLinkedTasks(savedTemplate).map((task) => task.name)).toEqual(['Business Checkout']);
    expect(result.current.findTemplateByName('monthly')?.id).toBe(savedTemplate.id);
  });

  it('replaces an existing template in place instead of adding a second one', () => {
    const { result } = renderHook(() => useTemplateLibrary());
    act(() => result.current.saveDraftAsTemplate('Monthly', buildDraft([])));
    const templateId = result.current.templates[0].id;
    act(() => result.current.saveDraftAsTemplate('Monthly', buildDraft([], '2. New backout'), templateId));
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].chgPlanningContent.backoutPlan).toBe('2. New backout');
  });

  it('imports a shared template as a copy with its own ids, and deletes it again', () => {
    const { result } = renderHook(() => useTemplateLibrary());
    act(() => result.current.saveDraftAsTemplate('Monthly', buildDraft([buildTask()])));
    const original = result.current.templates[0];
    const decoded = decodeTemplateShare(encodeTemplateShareCode(original, result.current.listLinkedTasks(original)));
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    act(() => { result.current.importShared(decoded.payload); });
    const imported = result.current.templates[0];
    expect(imported.name).toBe('Monthly (shared)');
    expect(imported.id).not.toBe(original.id);
    expect(imported.ctaskTemplateIds).not.toEqual(original.ctaskTemplateIds);
    expect(result.current.listLinkedTasks(imported)).toHaveLength(1);
    act(() => result.current.deleteTemplate(imported.id));
    expect(result.current.templates.map((template) => template.name)).toEqual(['Monthly']);
  });

  it('saves, imports (renaming clashes) and deletes task templates', () => {
    const { result } = renderHook(() => useTemplateLibrary());
    act(() => { result.current.saveCtaskTemplate('Smoke test', buildTaskTemplateData(buildTask({ shortDescription: 'Smoke test' }))); });
    act(() => { result.current.importSharedTasks([buildTask({ name: 'Smoke test' }), buildTask({ name: 'Deploy' })]); });
    expect(result.current.ctaskTemplates.map((task) => task.name).sort()).toEqual(['Deploy', 'Smoke test', 'Smoke test (shared)']);
    const deployId = result.current.ctaskTemplates.find((task) => task.name === 'Deploy')?.id ?? '';
    act(() => result.current.deleteCtaskTemplate(deployId));
    expect(result.current.ctaskTemplates.map((task) => task.name)).not.toContain('Deploy');
  });
});
