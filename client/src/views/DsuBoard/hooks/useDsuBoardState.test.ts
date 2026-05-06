// useDsuBoardState.test.ts — Unit tests for the DSU Board state management hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
}));

import { useDsuBoardState } from './useDsuBoardState.ts';

const MOCK_ISSUE = {
  id: 'TBX-1', key: 'TBX-1',
  fields: {
    summary: 'Test issue',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: null, assignee: null, reporter: null,
    issuetype: { name: 'Story', iconUrl: '' },
    created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
    description: null,
  },
};

describe('useDsuBoardState', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('initialises with 8 sections and empty projectKey', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.sections).toHaveLength(8);
    expect(result.current.state.projectKey).toBe('');
  });

  it('sets projectKey when setProjectKey is called', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    expect(result.current.state.projectKey).toBe('TBX');
  });

  it('sets staleDays when setStaleDays is called', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setStaleDays(7); });
    expect(result.current.state.staleDays).toBe(7);
  });

  it('toggles section collapse state', () => {
    const { result } = renderHook(() => useDsuBoardState());
    const sectionKey = result.current.state.sections[0].key;
    const initialCollapsed = result.current.state.sections[0].isCollapsed;
    act(() => { result.current.actions.toggleSectionCollapse(sectionKey); });
    expect(result.current.state.sections[0].isCollapsed).toBe(!initialCollapsed);
  });

  it('loads issues for each section when loadBoard resolves', async () => {
    mockJiraGet.mockResolvedValue({ issues: [MOCK_ISSUE] });
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });
    const sectionsWithIssues = result.current.state.sections.filter(
      (section) => section.issues.length > 0,
    );
    expect(sectionsWithIssues.length).toBeGreaterThan(0);
  });

  it('sets section loadError when a section fetch rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('JQL error'));
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });
    const sectionsWithErrors = result.current.state.sections.filter(
      (section) => section.loadError !== null && section.key !== 'roster-snow',
    );
    expect(sectionsWithErrors.length).toBeGreaterThan(0);
  });

  it('toggleFilter adds and removes assignee from activeFilters', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.toggleFilter('Alice'); });
    expect(result.current.state.activeFilters).toContain('Alice');
    act(() => { result.current.actions.toggleFilter('Alice'); });
    expect(result.current.state.activeFilters).not.toContain('Alice');
  });
});
