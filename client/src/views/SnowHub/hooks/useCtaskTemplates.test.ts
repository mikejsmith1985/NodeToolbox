// useCtaskTemplates.test.ts — Tests for reusable ServiceNow Change Task template storage.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CtaskTemplate } from './useCrgState.ts';
import { useCtaskTemplates } from './useCtaskTemplates.ts';

const CTASK_TEMPLATES_STORAGE_KEY = 'ntbx-ctask-templates';

function createCtaskTemplate(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id:               'ctask-template-001',
    name:             'Deploy Validation',
    createdAt:        '2026-01-01T00:00:00.000Z',
    shortDescription: 'Validate production deployment',
    description:      'Confirm the deployment completed and key smoke tests pass.',
    assignmentGroup:  { sysId: 'grp-001', displayName: 'Platform Team' },
    assignedTo:       { sysId: 'usr-001', displayName: 'Jane Smith' },
    plannedStartDate: '2026-01-01T10:00',
    plannedEndDate:   '2026-01-01T11:00',
    closeNotes:       'Validation complete.',
    ...overrides,
  };
}

function createCtaskTemplateData(template: CtaskTemplate): Omit<CtaskTemplate, 'id' | 'name' | 'createdAt'> {
  return {
    shortDescription: template.shortDescription,
    description:      template.description,
    assignmentGroup:  template.assignmentGroup,
    assignedTo:       template.assignedTo,
    plannedStartDate: template.plannedStartDate,
    plannedEndDate:   template.plannedEndDate,
    closeNotes:       template.closeNotes,
  };
}

describe('useCtaskTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with an empty CTASK template list', () => {
    const { result } = renderHook(() => useCtaskTemplates());

    expect(result.current.templates).toHaveLength(0);
  });

  it('saves a CTASK template and persists it to localStorage', () => {
    const { result } = renderHook(() => useCtaskTemplates());
    const ctaskTemplate = createCtaskTemplate();

    act(() => {
      result.current.saveTemplate('Deployment Validation', createCtaskTemplateData(ctaskTemplate));
    });

    expect(result.current.templates[0].name).toBe('Deployment Validation');
    expect(result.current.templates[0].shortDescription).toBe('Validate production deployment');

    const storedTemplates = JSON.parse(
      localStorage.getItem(CTASK_TEMPLATES_STORAGE_KEY) ?? '[]',
    ) as CtaskTemplate[];
    expect(storedTemplates[0].assignmentGroup.sysId).toBe('grp-001');
  });

  it('updates a CTASK template without changing its identity fields', () => {
    const existingTemplate = createCtaskTemplate();
    localStorage.setItem(CTASK_TEMPLATES_STORAGE_KEY, JSON.stringify([existingTemplate]));
    const { result } = renderHook(() => useCtaskTemplates());
    const updatedTemplate = createCtaskTemplate({ shortDescription: 'Run post-release smoke tests' });

    const unsafeTemplateUpdate = {
      ...createCtaskTemplateData(updatedTemplate),
      id:        'unsafe-id',
      name:      'Unsafe Name',
      createdAt: '2026-02-01T00:00:00.000Z',
    };

    act(() => {
      result.current.updateTemplate(existingTemplate.id, unsafeTemplateUpdate);
    });

    expect(result.current.templates[0].id).toBe(existingTemplate.id);
    expect(result.current.templates[0].name).toBe(existingTemplate.name);
    expect(result.current.templates[0].createdAt).toBe(existingTemplate.createdAt);
    expect(result.current.templates[0].shortDescription).toBe('Run post-release smoke tests');
  });

  it('deletes a CTASK template by ID', () => {
    localStorage.setItem(CTASK_TEMPLATES_STORAGE_KEY, JSON.stringify([createCtaskTemplate()]));
    const { result } = renderHook(() => useCtaskTemplates());

    act(() => {
      result.current.deleteTemplate('ctask-template-001');
    });

    expect(result.current.templates).toHaveLength(0);
  });
});
