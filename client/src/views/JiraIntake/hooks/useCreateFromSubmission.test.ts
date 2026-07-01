// useCreateFromSubmission.test.ts — Covers the happy path (matched reporter, ledger recorded before
// success), missing-issue-type blocking, no-project guard, create failure (no ledger write),
// fallback reporter + origin note, and bulk create skipping non-new rows.

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIssue, searchUsers } from '../../../services/jiraApi.ts';
import { useCreateFromSubmission } from './useCreateFromSubmission.ts';
import type { IntakeConfig, QueueEntry } from '../lib/intakeTypes.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ createIssue: vi.fn(), searchUsers: vi.fn() }));
const createIssueMock = vi.mocked(createIssue);
const searchUsersMock = vi.mocked(searchUsers);

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT',
  projectMappings: [{ projectName: 'Cleanup Crew', projectKey: 'ENCUC' }],
  acceptanceCriteriaFieldId: 'customfield_10200',
  autoCreateOnImport: true,
  updatedAt: '', updatedBy: '',
};

function newEntry(overrides: Partial<QueueEntry['submission']> = {}): QueueEntry {
  return {
    submission: {
      id: 's1', submittedAt: '2026-07-01T10:00:00Z', status: 'New',
      submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
      fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High', project: '' },
      extras: {}, rowIndex: 0, parseErrors: [], ...overrides,
    },
    state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null,
  };
}

afterEach(() => { vi.clearAllMocks(); });

describe('useCreateFromSubmission', () => {
  it('creates with row-driven issue type + priority, matched reporter, and records the ledger', async () => {
    searchUsersMock.mockResolvedValue([{ name: 'msmith', emailAddress: 'm@corp.com', displayName: 'Michael Smith', accountId: '', avatarUrls: {} }]);
    createIssueMock.mockResolvedValue({ id: '1', key: 'ENFCT-100', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    const payload = createIssueMock.mock.calls[0][0];
    expect(payload.fields.project).toEqual({ key: 'ENFCT' });
    expect(payload.fields.issuetype).toEqual({ name: 'Story' });
    expect(payload.fields.priority).toEqual({ name: 'High' });
    expect(payload.fields.reporter).toEqual({ name: 'msmith' });
    expect(recordProcessed).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', jiraKey: 'ENFCT-100', reporterOutcome: 'matched' }));
    expect(updated.state).toBe('imported');
    expect(updated.jiraKey).toBe('ENFCT-100');
  });

  it('blocks a row with no issue type and does not call Jira', async () => {
    const recordProcessed = vi.fn();
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry({
      fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: '', priority: '', project: '' },
    }));

    expect(updated.state).toBe('invalid');
    expect(updated.blockingReasons).toContain('Missing issue type');
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('routes to the mapped project when the row carries a project name', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockResolvedValue({ id: '9', key: 'ENCUC-1', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    await result.current.createFromSubmission(newEntry({
      fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: '', project: 'Cleanup Crew' },
    }));

    expect(createIssueMock.mock.calls[0][0].fields.project).toEqual({ key: 'ENCUC' });
  });

  it('flags an unmapped project name as invalid without calling Jira', async () => {
    const recordProcessed = vi.fn();
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry({
      fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: '', project: 'Unknown Squad' },
    }));

    expect(updated.state).toBe('invalid');
    expect(updated.blockingReasons[0]).toContain('Unknown Squad');
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('fails clearly when a row has no project and no default project is configured', async () => {
    const recordProcessed = vi.fn();
    const noProject: IntakeConfig = { ...CONFIG, projectKey: '' };
    const { result } = renderHook(() => useCreateFromSubmission({ config: noProject, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    expect(updated.state).toBe('failed');
    expect(updated.blockingReasons[0]).toContain('default target project');
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('marks the entry failed and writes no ledger entry when create throws', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockRejectedValue(new Error('Jira POST failed: 400 — boom'));
    const recordProcessed = vi.fn();
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    expect(updated.state).toBe('failed');
    expect(updated.blockingReasons[0]).toContain('boom');
    expect(recordProcessed).not.toHaveBeenCalled();
  });

  it('creates with the fallback reporter and prepends the origin note to the description', async () => {
    searchUsersMock.mockResolvedValue([]); // no match → fallback
    createIssueMock.mockResolvedValue({ id: '2', key: 'ENFCT-101', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry({
      fields: { summary: 'Do it', description: 'Original details', acceptanceCriteria: '', issueType: 'Story', priority: '', project: '' },
    }));

    const sentDescription = createIssueMock.mock.calls[0][0].fields.description as string;
    expect(createIssueMock.mock.calls[0][0].fields.reporter).toBeUndefined();
    expect(sentDescription).toContain('Submitted via Teams by *Michael Smith* (m@corp.com)');
    expect(sentDescription).toContain('Original details');
    expect(updated.reporterOutcome).toBe('fallback');
    expect(updated.state).toBe('imported');
  });

  it('createAllNew creates only new entries and passes through others', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockResolvedValue({ id: '3', key: 'ENFCT-102', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, recordProcessed }));

    const alreadyImported: QueueEntry = { ...newEntry({ id: 's2' }), state: 'imported', jiraKey: 'ENFCT-1' };
    const results = await result.current.createAllNew([newEntry(), alreadyImported]);

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    expect(results[0].state).toBe('imported');
    expect(results[1].jiraKey).toBe('ENFCT-1');
  });
});
