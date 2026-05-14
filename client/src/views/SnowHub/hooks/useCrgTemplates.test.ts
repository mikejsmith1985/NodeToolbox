// useCrgTemplates.test.ts — Tests for the CHG template save/load hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrgTemplate } from './useCrgState.ts';
import { useCrgTemplates } from './useCrgTemplates.ts';

// ── localStorage mock ──
// We can't use real localStorage in jsdom reliably across tests, so we use
// vi.spyOn to intercept reads and writes.
const LOCAL_STORAGE_KEY = 'ntbx-crg-templates';

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
    ...overrides,
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
      result.current.saveTemplate('Release Template', {
        chgBasicInfo:          template.chgBasicInfo,
        chgPlanningAssessment: template.chgPlanningAssessment,
        chgPlanningContent:    template.chgPlanningContent,
      });
    });

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].name).toBe('Release Template');
  });

  it('persists templates to localStorage after saving', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('Persisted Template', {
        chgBasicInfo:          template.chgBasicInfo,
        chgPlanningAssessment: template.chgPlanningAssessment,
        chgPlanningContent:    template.chgPlanningContent,
      });
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]') as CrgTemplate[];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted Template');
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
      result.current.saveTemplate('First', {
        chgBasicInfo:          template.chgBasicInfo,
        chgPlanningAssessment: template.chgPlanningAssessment,
        chgPlanningContent:    template.chgPlanningContent,
      });
    });
    act(() => {
      result.current.saveTemplate('Second', {
        chgBasicInfo:          template.chgBasicInfo,
        chgPlanningAssessment: template.chgPlanningAssessment,
        chgPlanningContent:    template.chgPlanningContent,
      });
    });

    expect(result.current.templates[0].name).toBe('Second');
    expect(result.current.templates[1].name).toBe('First');
  });

  it('uses "Unnamed Template" when an empty name is provided', () => {
    const { result } = renderHook(() => useCrgTemplates());
    const template = makeMinimalTemplate();

    act(() => {
      result.current.saveTemplate('   ', {
        chgBasicInfo:          template.chgBasicInfo,
        chgPlanningAssessment: template.chgPlanningAssessment,
        chgPlanningContent:    template.chgPlanningContent,
      });
    });

    expect(result.current.templates[0].name).toBe('Unnamed Template');
  });
});
