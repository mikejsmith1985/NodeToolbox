// useIntakeConfig.ts — Loads and saves the single active intake configuration and the local
// dedup ledger from the shared Confluence content-property store (the same store mechanism the
// Jira Template Maker uses). See contracts/intake-contracts.md §D and research.md R3.

import { useCallback, useEffect, useState } from 'react';

import {
  fetchConfluenceDatabasePropertyByKey,
  upsertConfluenceDatabaseProperty,
} from '../../../services/confluenceApi.ts';
import { getMyself } from '../../../services/jiraApi.ts';
import { appendProcessed } from '../lib/processedLedger.ts';
import type { IntakeConfig, JiraIntakeStore, ProcessedEntry } from '../lib/intakeTypes.ts';
import { JIRA_INTAKE_STORE_SCHEMA_VERSION } from '../lib/intakeTypes.ts';

// The intake store lives on the same shared Confluence database as the ART workspace + templates,
// under its own content-property key so those schemas are untouched.
const SHARED_INTAKE_DATABASE_ID = '684163133';
const INTAKE_PROPERTY_KEY = 'nodetoolbox-jira-intake';
const UNKNOWN_AUTHOR = 'unknown';
const LOAD_ERROR_MESSAGE = 'Could not load the intake configuration. Check your Confluence access and try again.';

export interface UseIntakeConfigResult {
  config: IntakeConfig | null;
  ledger: ProcessedEntry[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  saveConfig: (config: IntakeConfig) => Promise<void>;
  recordProcessed: (entry: ProcessedEntry) => Promise<void>;
}

/** An absent property is the normal first-run state (empty store); a bad schema version is fatal. */
async function loadStore(): Promise<JiraIntakeStore> {
  const property = await fetchConfluenceDatabasePropertyByKey<JiraIntakeStore>(
    SHARED_INTAKE_DATABASE_ID,
    INTAKE_PROPERTY_KEY,
  );
  if (!property) {
    return { schemaVersion: JIRA_INTAKE_STORE_SCHEMA_VERSION, updatedAt: '', config: null, ledger: [] };
  }
  if (property.value.schemaVersion !== JIRA_INTAKE_STORE_SCHEMA_VERSION) {
    throw new Error(`Unsupported intake store schema version ${property.value.schemaVersion}.`);
  }
  return property.value;
}

/** Persists the whole intake store (config + ledger) under the content-property key. */
async function saveStore(store: JiraIntakeStore): Promise<void> {
  await upsertConfluenceDatabaseProperty(SHARED_INTAKE_DATABASE_ID, INTAKE_PROPERTY_KEY, store);
}

/** Resolves the current Jira user's display name, falling back to 'unknown' without throwing. */
async function resolveAuthorName(): Promise<string> {
  try {
    const me = await getMyself();
    return me.displayName ?? me.name ?? UNKNOWN_AUTHOR;
  } catch {
    return UNKNOWN_AUTHOR;
  }
}

/** Owns the intake config + ledger state and the load/save/record operations against the store. */
export function useIntakeConfig(): UseIntakeConfigResult {
  const [config, setConfig] = useState<IntakeConfig | null>(null);
  const [ledger, setLedger] = useState<ProcessedEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const store = await loadStore();
      setConfig(store.config);
      setLedger(store.ledger);
    } catch {
      setErrorMessage(LOAD_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const saveConfig = useCallback(async (nextConfig: IntakeConfig): Promise<void> => {
    const updatedBy = await resolveAuthorName();
    // Re-read so a concurrently-appended ledger entry is not lost when we write the config back.
    const remoteStore = await loadStore();
    const stampedConfig: IntakeConfig = { ...nextConfig, updatedAt: new Date().toISOString(), updatedBy };
    const nextStore: JiraIntakeStore = {
      schemaVersion: JIRA_INTAKE_STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      config: stampedConfig,
      ledger: remoteStore.ledger,
    };
    await saveStore(nextStore);
    setConfig(stampedConfig);
    setLedger(remoteStore.ledger);
  }, []);

  const recordProcessed = useCallback(async (entry: ProcessedEntry): Promise<void> => {
    // Re-read the latest ledger so sequential creates each build on the previously-saved state.
    const remoteStore = await loadStore();
    const nextLedger = appendProcessed(remoteStore.ledger, entry);
    const nextStore: JiraIntakeStore = {
      schemaVersion: JIRA_INTAKE_STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      config: remoteStore.config,
      ledger: nextLedger,
    };
    await saveStore(nextStore);
    setLedger(nextLedger);
  }, []);

  return { config, ledger, isLoading, errorMessage, reload, saveConfig, recordProcessed };
}
