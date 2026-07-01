// useCreateFromSubmission.test.ts — Covers the happy path (matched reporter, ledger recorded before
// success), missing-required-field blocking, create failure (no ledger write), fallback reporter,
// and bulk create skipping non-new rows.

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIssue, searchUsers } from '../../../services/jiraApi.ts';
import { useCreateFromSubmission } from './useCreateFromSubmission.ts';
import type { FieldDescriptor } from '../../JiraTemplateMaker/lib/templateTypes.ts';
import type { IntakeConfig, QueueEntry } from '../lib/intakeTypes.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ createIssue: vi.fn(), searchUsers: vi.fn() }));
const createIssueMock = vi.mocked(createIssue);
const searchUsersMock = vi.mocked(searchUsers);

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT', projectId: '1', issueTypeId: '10001', issueTypeName: 'Story',
  fieldMappings: [
    { coreField: 'summary', jiraFieldId: 'summary', jiraFieldType: 'text', transform: 'raw' },
    { coreField: 'priority', jiraFieldId: 'priority', jiraFieldType: 'choice', transform: 'choiceByName' },
  ],
  autoCreateOnImport: true, updatedAt: '', updatedBy: '',
};

function newEntry(overrides: Partial<QueueEntry['submission']> = {}): QueueEntry {
  return {
    submission: {
      id: 's1', submittedAt: '2026-07-01T10:00:00Z', status: 'New',
      submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
      fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High' },
      extras: {}, rowIndex: 0, parseErrors: [], ...overrides,
    },
    state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null,
  };
}

const SUMMARY_REQUIRED: FieldDescriptor[] = [
  { fieldId: 'summary', name: 'Summary', required: true, internalType: 'text', isSupported: true, hasDefault: false },
];

afterEach(() => { vi.clearAllMocks(); });

describe('useCreateFromSubmission', () => {
  it('creates an issue with a matched reporter and records the ledger before returning success', async () => {
    searchUsersMock.mockResolvedValue([{ name: 'msmith', emailAddress: 'm@corp.com', displayName: 'Michael Smith', accountId: '', avatarUrls: {} }]);
    createIssueMock.mockResolvedValue({ id: '1', key: 'ENFCT-100', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: SUMMARY_REQUIRED, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    const payload = createIssueMock.mock.calls[0][0];
    expect(payload.fields.summary).toBe('Do it');
    expect(payload.fields.priority).toEqual({ name: 'High' });
    expect(payload.fields.reporter).toEqual({ name: 'msmith' });
    expect(recordProcessed).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', jiraKey: 'ENFCT-100', reporterOutcome: 'matched' }));
    expect(updated.state).toBe('imported');
    expect(updated.jiraKey).toBe('ENFCT-100');
  });

  it('blocks creation when a required field is missing and does not call Jira', async () => {
    const recordProcessed = vi.fn();
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: SUMMARY_REQUIRED, recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry({ fields: { summary: '', description: '', acceptanceCriteria: '', issueType: '', priority: '' } }));

    expect(updated.state).toBe('invalid');
    expect(updated.blockingReasons).toContain('Missing required field: Summary');
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(recordProcessed).not.toHaveBeenCalled();
  });

  it('flags a submission whose mapped choice value is not an available Jira option (drift)', async () => {
    const recordProcessed = vi.fn();
    const descriptors: FieldDescriptor[] = [
      { fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice', isSupported: true,
        allowedValues: [{ id: '1', label: 'High' }, { id: '2', label: 'Medium' }], hasDefault: false },
    ];
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: descriptors, recordProcessed }));

    // The entry's priority is "High" (allowed); switch to an unknown option to trigger drift.
    const drifted = newEntry({ fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'Ultra' } });
    const updated = await result.current.createFromSubmission(drifted);

    expect(updated.state).toBe('invalid');
    expect(updated.blockingReasons[0]).toContain('is not an available option');
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('marks the entry failed and writes no ledger entry when create throws', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockRejectedValue(new Error('Jira POST failed: 400 — boom'));
    const recordProcessed = vi.fn();
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: [], recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    expect(updated.state).toBe('failed');
    expect(updated.blockingReasons[0]).toContain('boom');
    expect(recordProcessed).not.toHaveBeenCalled();
  });

  it('creates with the fallback reporter (no reporter field) when the email does not match', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockResolvedValue({ id: '2', key: 'ENFCT-101', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: [], recordProcessed }));

    const updated = await result.current.createFromSubmission(newEntry());

    expect(createIssueMock.mock.calls[0][0].fields.reporter).toBeUndefined();
    expect(updated.reporterOutcome).toBe('fallback');
    expect(updated.state).toBe('imported');
  });

  it('prepends the submitter origin note to the description on the fallback path', async () => {
    searchUsersMock.mockResolvedValue([]); // no match → fallback
    createIssueMock.mockResolvedValue({ id: '4', key: 'ENFCT-103', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const configWithDescription: IntakeConfig = {
      ...CONFIG,
      fieldMappings: [
        ...CONFIG.fieldMappings,
        { coreField: 'description', jiraFieldId: 'description', jiraFieldType: 'text', transform: 'wikiMarkup' },
      ],
    };
    const { result } = renderHook(() => useCreateFromSubmission({ config: configWithDescription, fieldDescriptors: [], recordProcessed }));

    const entryWithDescription = newEntry({
      fields: { summary: 'Do it', description: 'Original details', acceptanceCriteria: '', issueType: 'Story', priority: 'High' },
    });
    await result.current.createFromSubmission(entryWithDescription);

    const sentDescription = createIssueMock.mock.calls[0][0].fields.description as string;
    expect(sentDescription).toContain('Submitted via Teams by *Michael Smith* (m@corp.com)');
    expect(sentDescription).toContain('Original details');
    // The origin note comes first, before the original content.
    expect(sentDescription.indexOf('Submitted via Teams')).toBeLessThan(sentDescription.indexOf('Original details'));
  });

  it('records the origin note as the description when no description was provided', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockResolvedValue({ id: '5', key: 'ENFCT-104', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const configWithDescription: IntakeConfig = {
      ...CONFIG,
      fieldMappings: [
        ...CONFIG.fieldMappings,
        { coreField: 'description', jiraFieldId: 'description', jiraFieldType: 'text', transform: 'wikiMarkup' },
      ],
    };
    const { result } = renderHook(() => useCreateFromSubmission({ config: configWithDescription, fieldDescriptors: [], recordProcessed }));

    await result.current.createFromSubmission(newEntry());

    expect(createIssueMock.mock.calls[0][0].fields.description).toContain('Submitted via Teams by *Michael Smith*');
  });

  it('createAllNew creates only new entries and passes through others', async () => {
    searchUsersMock.mockResolvedValue([]);
    createIssueMock.mockResolvedValue({ id: '3', key: 'ENFCT-102', self: 'x' });
    const recordProcessed = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateFromSubmission({ config: CONFIG, fieldDescriptors: [], recordProcessed }));

    const alreadyImported: QueueEntry = { ...newEntry({ id: 's2' }), state: 'imported', jiraKey: 'ENFCT-1' };
    const results = await result.current.createAllNew([newEntry(), alreadyImported]);

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    expect(results[0].state).toBe('imported');
    expect(results[1].jiraKey).toBe('ENFCT-1');
  });
});
