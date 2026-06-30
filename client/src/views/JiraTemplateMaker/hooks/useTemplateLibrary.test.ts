// useTemplateLibrary.test.ts — Unit tests for the shared template library hook (T014/T021/T022).

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadJiraTemplates,
  mergeJiraTemplateStores,
  saveJiraTemplates,
} from '../../../services/confluenceApi.ts';
import { getMyself } from '../../../services/jiraApi.ts';
import { JIRA_TEMPLATE_STORE_SCHEMA_VERSION } from '../lib/templateTypes.ts';
import type { TemplateDraft } from './useTemplateLibrary.ts';
import { useTemplateLibrary } from './useTemplateLibrary.ts';

vi.mock('../../../services/confluenceApi.ts', () => ({
  loadJiraTemplates: vi.fn(),
  saveJiraTemplates: vi.fn(),
  mergeJiraTemplateStores: vi.fn(),
}));
vi.mock('../../../services/jiraApi.ts', () => ({ getMyself: vi.fn() }));

const loadMock = vi.mocked(loadJiraTemplates);
const saveMock = vi.mocked(saveJiraTemplates);
const mergeMock = vi.mocked(mergeJiraTemplateStores);
const myselfMock = vi.mocked(getMyself);

const EMPTY_STORE = { schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION, updatedAt: '', templates: [] };

const DRAFT: TemplateDraft = {
  name: 'Weekly Ops', projectKey: 'ABC', projectId: '10000',
  issueTypeId: '1', issueTypeName: 'Task', fields: [],
};

describe('useTemplateLibrary', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('records the current Jira user as the template author on save', async () => {
    loadMock.mockResolvedValue(EMPTY_STORE as never);
    myselfMock.mockResolvedValue({ displayName: 'Jane Doe' } as never);
    // Merge passes the working store through untouched.
    mergeMock.mockImplementation((_base, _remote, working) => ({ merged: working, conflicts: [] }));
    saveMock.mockImplementation(async (_db, store) => store as never);

    const { result } = renderHook(() => useTemplateLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { ok: boolean; conflicts: string[] } | undefined;
    await act(async () => { outcome = await result.current.saveTemplate(DRAFT); });

    expect(outcome?.ok).toBe(true);
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].authorName).toBe('Jane Doe');
    expect(result.current.templates[0].name).toBe('Weekly Ops');
  });

  it('falls back to "unknown" author without blocking the save when myself lookup fails', async () => {
    loadMock.mockResolvedValue(EMPTY_STORE as never);
    myselfMock.mockRejectedValue(new Error('no session'));
    mergeMock.mockImplementation((_base, _remote, working) => ({ merged: working, conflicts: [] }));
    saveMock.mockImplementation(async (_db, store) => store as never);

    const { result } = renderHook(() => useTemplateLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.saveTemplate(DRAFT); });

    expect(result.current.templates[0].authorName).toBe('unknown');
  });

  it('does not persist when the merge reports a conflict', async () => {
    loadMock.mockResolvedValue(EMPTY_STORE as never);
    myselfMock.mockResolvedValue({ displayName: 'Jane' } as never);
    mergeMock.mockReturnValue({ merged: EMPTY_STORE as never, conflicts: ['tpl-x'] });

    const { result } = renderHook(() => useTemplateLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { ok: boolean; conflicts: string[] } | undefined;
    await act(async () => { outcome = await result.current.saveTemplate(DRAFT); });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.conflicts).toEqual(['tpl-x']);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
