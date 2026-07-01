// useIntakeConfig.test.ts — Verifies load (empty + populated), save (preserves ledger, stamps
// author), record-processed (appends + persists), and the load-error path. Confluence + Jira I/O
// is mocked.

import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchConfluenceDatabasePropertyByKey,
  upsertConfluenceDatabaseProperty,
} from '../../../services/confluenceApi.ts';
import { getMyself } from '../../../services/jiraApi.ts';
import { useIntakeConfig } from './useIntakeConfig.ts';
import type { IntakeConfig, JiraIntakeStore } from '../lib/intakeTypes.ts';

vi.mock('../../../services/confluenceApi.ts', () => ({
  fetchConfluenceDatabasePropertyByKey: vi.fn(),
  upsertConfluenceDatabaseProperty: vi.fn(),
}));
vi.mock('../../../services/jiraApi.ts', () => ({ getMyself: vi.fn() }));

const fetchPropertyMock = vi.mocked(fetchConfluenceDatabasePropertyByKey);
const upsertPropertyMock = vi.mocked(upsertConfluenceDatabaseProperty);
const getMyselfMock = vi.mocked(getMyself);

const SAMPLE_CONFIG: IntakeConfig = {
  projectKey: 'ENFCT',
  projectId: '10000',
  issueTypeId: '10001',
  issueTypeName: 'Story',
  fieldMappings: [{ coreField: 'summary', jiraFieldId: 'summary', jiraFieldType: 'text', transform: 'raw' }],
  autoCreateOnImport: true,
  updatedAt: '',
  updatedBy: '',
};

function mockStore(store: JiraIntakeStore): void {
  fetchPropertyMock.mockResolvedValue({ id: 'p1', key: 'nodetoolbox-jira-intake', value: store, version: { number: 1 } } as never);
}

afterEach(() => { vi.clearAllMocks(); });

describe('useIntakeConfig', () => {
  it('loads an empty store on first run (absent property)', async () => {
    fetchPropertyMock.mockResolvedValue(null as never);
    const { result } = renderHook(() => useIntakeConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).toBeNull();
    expect(result.current.ledger).toEqual([]);
  });

  it('loads an existing config and ledger', async () => {
    mockStore({
      schemaVersion: 1,
      updatedAt: '',
      config: SAMPLE_CONFIG,
      ledger: [{ id: 'a', jiraKey: 'ENFCT-1', createdAt: '', reporterOutcome: 'matched' }],
    });
    const { result } = renderHook(() => useIntakeConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config?.projectKey).toBe('ENFCT');
    expect(result.current.ledger).toHaveLength(1);
  });

  it('surfaces a friendly error when the store schema version is unsupported', async () => {
    mockStore({ schemaVersion: 999, updatedAt: '', config: null, ledger: [] });
    const { result } = renderHook(() => useIntakeConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.errorMessage).toMatch(/Could not load the intake configuration/);
  });

  it('saveConfig stamps the author and preserves the existing ledger', async () => {
    mockStore({
      schemaVersion: 1,
      updatedAt: '',
      config: null,
      ledger: [{ id: 'keep', jiraKey: 'ENFCT-7', createdAt: '', reporterOutcome: 'fallback' }],
    });
    getMyselfMock.mockResolvedValue({ displayName: 'Michael Smith' } as never);
    upsertPropertyMock.mockResolvedValue({} as never);

    const { result } = renderHook(() => useIntakeConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.saveConfig(SAMPLE_CONFIG); });

    expect(upsertPropertyMock).toHaveBeenCalledTimes(1);
    const savedStore = upsertPropertyMock.mock.calls[0][2] as JiraIntakeStore;
    expect(savedStore.config?.updatedBy).toBe('Michael Smith');
    expect(savedStore.ledger).toHaveLength(1);
    expect(result.current.config?.updatedBy).toBe('Michael Smith');
  });

  it('recordProcessed appends to the ledger and persists', async () => {
    mockStore({ schemaVersion: 1, updatedAt: '', config: SAMPLE_CONFIG, ledger: [] });
    upsertPropertyMock.mockResolvedValue({} as never);

    const { result } = renderHook(() => useIntakeConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.recordProcessed({ id: 'new', jiraKey: 'ENFCT-9', createdAt: '2026-07-01T00:00:00Z', reporterOutcome: 'matched' });
    });

    const savedStore = upsertPropertyMock.mock.calls[0][2] as JiraIntakeStore;
    expect(savedStore.ledger).toEqual([{ id: 'new', jiraKey: 'ENFCT-9', createdAt: '2026-07-01T00:00:00Z', reporterOutcome: 'matched' }]);
    expect(result.current.ledger).toHaveLength(1);
  });
});
