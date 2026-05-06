// useDevWorkspaceState.test.ts — Unit tests for the Dev Workspace state hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPost } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
}));

import { useDevWorkspaceState } from './useDevWorkspaceState.ts';

describe('useDevWorkspaceState', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initialises with activeTab=time and empty timers', () => {
    const { result } = renderHook(() => useDevWorkspaceState());
    expect(result.current.state.activeTab).toBe('time');
    expect(result.current.state.issueTimers).toEqual([]);
  });

  it('sets activeTab when setActiveTab is called', () => {
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setActiveTab('gitsync'); });
    expect(result.current.state.activeTab).toBe('gitsync');
  });

  it('adds an IssueTimer when searchAndAddIssue resolves', async () => {
    mockJiraGet.mockResolvedValue({ key: 'TBX-42', fields: { summary: 'Fix the widget' } });
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('TBX-42'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    expect(result.current.state.issueTimers).toHaveLength(1);
    expect(result.current.state.issueTimers[0].issueKey).toBe('TBX-42');
  });

  it('does not add a duplicate timer for an already-tracked issue', async () => {
    mockJiraGet.mockResolvedValue({ key: 'TBX-42', fields: { summary: 'Fix the widget' } });
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('TBX-42'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    expect(result.current.state.issueTimers).toHaveLength(1);
  });

  it('starts a timer and marks it as running', async () => {
    mockJiraGet.mockResolvedValue({ key: 'TBX-10', fields: { summary: 'Write tests' } });
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('TBX-10'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    act(() => { result.current.actions.startTimer('TBX-10'); });
    const timer = result.current.state.issueTimers.find((t) => t.issueKey === 'TBX-10');
    expect(timer?.isRunning).toBe(true);
    expect(timer?.sessionStartedAt).not.toBeNull();
  });

  it('stops a running timer and creates a WorkLogEntry', async () => {
    mockJiraGet.mockResolvedValue({ key: 'TBX-5', fields: { summary: 'Build the rocket' } });
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('TBX-5'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    act(() => { result.current.actions.startTimer('TBX-5'); });
    act(() => { result.current.actions.stopTimer('TBX-5'); });
    const timer = result.current.state.issueTimers.find((t) => t.issueKey === 'TBX-5');
    expect(timer?.isRunning).toBe(false);
    expect(result.current.state.workLogEntries).toHaveLength(1);
    expect(result.current.state.workLogEntries[0].issueKey).toBe('TBX-5');
  });

  it('tickAllRunningTimers increments elapsedSeconds for running timers only', async () => {
    mockJiraGet.mockResolvedValue({ key: 'TBX-99', fields: { summary: 'Running issue' } });
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('TBX-99'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    act(() => { result.current.actions.startTimer('TBX-99'); });
    const elapsedBefore = result.current.state.issueTimers[0].elapsedSeconds;
    act(() => { result.current.actions.tickAllRunningTimers(); });
    expect(result.current.state.issueTimers[0].elapsedSeconds).toBe(elapsedBefore + 1);
  });

  it('sets issueSearchError when searchAndAddIssue rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useDevWorkspaceState());
    act(() => { result.current.actions.setIssueSearchKey('BAD-999'); });
    await act(async () => { await result.current.actions.searchAndAddIssue(); });
    expect(result.current.state.issueSearchError).toBeTruthy();
    expect(result.current.state.issueTimers).toHaveLength(0);
  });
});
