// useCrgTemplates.test.ts — Tests for the CHG template save/load hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrgTemplate } from './useCrgState.ts';
import { useCrgTemplates } from './useCrgTemplates.ts';

// ── localStorage mock ──
// We can't use real localStorage in jsdom reliably across tests, so we use
// vi.spyOn to intercept reads and writes.
const LOCAL_STORAGE_KEY = 'ntbx-crg-templates';
const DEFAULT_TEMPLATE_STORAGE_KEY = 'ntbx-crg-default-template-id';
const EMPTY_SNOW_REFERENCE = { sysId: '', displayName: '' };

function makeMinimalTemplate(overrides: Partial<CrgTemplate> = {}): CrgTemplate {
  return {
    id:        'tpl-001',
    name:      'My Template',
    createdAt: '2026-01-01T00:00:00.000Z',
    chgBasicInfo: {
      category: 'Software', changeType: 'Normal', environment: 'Production',
      requestedBy:     { sysId: '', displayName: '' },
      configItem:      { sysId: '', displayName: '' },
      assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
      assignedTo:      { sysId: '', displayName: '' },
      changeManager:   { sysId: '', displayName: '' },
      tester:          { sysId: '', displayName: '' },
      serviceManager:  { sysId: '', displayName: '' },
      isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '3 - Low', systemAvailabilityImplication: 'No Impact',
      hasBeenTested: 'Yes', impactedPersonsAware: 'Yes',
      hasBeenPerformedPreviously: 'Yes', successProbability: '100%', canBeBackedOut: 'Yes',
    },
    chgPlanningContent: {
      implementationPlan: 'Deploy via pipeline.', backoutPlan: 'Revert tag.', testPlan: 'Smoke test.',
    },
    relEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00', configItem: { ...EMPTY_SNOW_REFERENCE }, impactedPersonsAware: '' },
    prdEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-02T10:00', plannedEndDate: '2026-01-02T11:00', configItem: { ...EMPTY_SNOW_REFERENCE }, impactedPersonsAware: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...EMPTY_SNOW_REFERENCE }, impactedPersonsAware: '' },
    ...overrides,
  };
}

function makeTemplateData(template: CrgTemplate): Omit<CrgTemplate, 'id' | 'name' | 'createdAt'> {
  return {
    chgBasicInfo:          template.chgBasicInfo,
    chgPlanningAssessment: template.chgPlanningAssessment,
    chgPlanningContent:    template.chgPlanningContent,
    relEnvironment:        template.relEnvironment,
    prdEnvironment:        template.prdEnvironment,
    pfixEnvironment:       template.pfixEnvironment,
  };
}

describe('useCrgTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty template list when no templates are saved', () => {
    const { result } = renderHook(() => useCrgTemplates());

    expect(result.current.templates).toHaveLength(0);
  });

  it('saves a new template and returns it in the list', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('Release Template', makeTemplateData(template));
    });

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].name).toBe('Release Template');
    expect(result.current.templates[0].prdEnvironment?.isEnabled).toBe(true);
  });

  it('persists templates to localStorage after saving', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('Persisted Template', makeTemplateData(template));
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]') as CrgTemplate[];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted Template');
    expect(stored[0].relEnvironment?.plannedStartDate).toBe('2026-01-01T10:00');
  });

  it('updates an existing template while preserving its identity', () => {
    const existingTemplate = makeMinimalTemplate({ id: 'tpl-update', name: 'Release Template' });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([existingTemplate]));

    const { result } = renderHook(() => useCrgTemplates());
    const updatedTemplate = makeMinimalTemplate({
      chgBasicInfo: {
        ...existingTemplate.chgBasicInfo,
        category:    'Hardware',
        environment: 'pfix',
      },
      pfixEnvironment: { isEnabled: true, plannedStartDate: '2026-01-03T10:00', plannedEndDate: '2026-01-03T11:00', configItem: { ...EMPTY_SNOW_REFERENCE }, impactedPersonsAware: '' },
    });

    const unsafeTemplateUpdate = {
      ...makeTemplateData(updatedTemplate),
      id:        'tpl-hijack',
      name:      'Changed Name',
      createdAt: '2026-02-01T00:00:00.000Z',
    };

    act(() => {
      result.current.updateTemplate('tpl-update', unsafeTemplateUpdate);
    });

    expect(result.current.templates[0].id).toBe('tpl-update');
    expect(result.current.templates[0].name).toBe('Release Template');
    expect(result.current.templates[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.current.templates[0].chgBasicInfo.category).toBe('Hardware');
    expect(result.current.templates[0].pfixEnvironment?.isEnabled).toBe(true);
  });

  it('loads saved templates from localStorage on mount', () => {
    const existingTemplate = makeMinimalTemplate({ name: 'Pre-existing' });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([existingTemplate]));

    const { result } = renderHook(() => useCrgTemplates());

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].name).toBe('Pre-existing');
  });

  it('deletes a template by ID', () => {
    const existingTemplate = makeMinimalTemplate({ id: 'tpl-del' });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([existingTemplate]));

    const { result } = renderHook(() => useCrgTemplates());

    act(() => {
      result.current.deleteTemplate('tpl-del');
    });

    expect(result.current.templates).toHaveLength(0);
  });

  it('returns an empty list gracefully if localStorage contains malformed JSON', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, 'not valid json {{{');

    const { result } = renderHook(() => useCrgTemplates());

    expect(result.current.templates).toHaveLength(0);
  });

  it('places the newest template first in the list', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('First', makeTemplateData(template));
    });
    act(() => {
      result.current.saveTemplate('Second', makeTemplateData(template));
    });

    expect(result.current.templates[0].name).toBe('Second');
    expect(result.current.templates[1].name).toBe('First');
  });

  it('persists and restores the default template selection', () => {
    const existingTemplate = makeMinimalTemplate({ id: 'tpl-default' });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([existingTemplate]));

    const { result } = renderHook(() => useCrgTemplates());

    act(() => {
      result.current.setDefaultTemplateId('tpl-default');
    });

    expect(result.current.defaultTemplateId).toBe('tpl-default');
    expect(localStorage.getItem(DEFAULT_TEMPLATE_STORAGE_KEY)).toBe('tpl-default');

    const { result: remountedResult } = renderHook(() => useCrgTemplates());
    expect(remountedResult.current.defaultTemplateId).toBe('tpl-default');
  });

  it('clears the default template when that template is deleted', () => {
    const existingTemplate = makeMinimalTemplate({ id: 'tpl-default' });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([existingTemplate]));

    const { result } = renderHook(() => useCrgTemplates());

    act(() => {
      result.current.setDefaultTemplateId('tpl-default');
    });
    act(() => {
      result.current.deleteTemplate('tpl-default');
    });

    expect(result.current.defaultTemplateId).toBeNull();
    expect(localStorage.getItem(DEFAULT_TEMPLATE_STORAGE_KEY)).toBeNull();
  });

  it('uses "Unnamed Template" when an empty name is provided', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('   ', makeTemplateData(template));
    });

    expect(result.current.templates[0].name).toBe('Unnamed Template');
  });
});
