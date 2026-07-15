// useTemplateLibrary.ts — Loads, saves, and deletes the globally-shared Jira template library.
// Persistence is the shared Confluence content-property store; concurrent edits are reconciled
// with a 3-way merge against the snapshot taken at load. The saving user's display name is
// recorded as the template author (FR-4.3).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadJiraTemplates,
  mergeJiraTemplateStores,
  saveJiraTemplates,
} from '../../../services/confluenceApi.ts';
import { getMyself } from '../../../services/jiraApi.ts';
import type { JiraTemplate, JiraTemplateStore, ManualUrlParam, TemplateFieldEntry } from '../lib/templateTypes.ts';
import { JIRA_TEMPLATE_STORE_SCHEMA_VERSION } from '../lib/templateTypes.ts';

// Templates live on the same shared database as the ART workspace (globally shared, FR-4.4).
const SHARED_TEMPLATE_DATABASE_ID = '684163133';
const UNKNOWN_AUTHOR = 'unknown';
const LOAD_ERROR_MESSAGE = 'Could not load the shared template library. Check your Confluence access and try again.';

/** The editable shape a caller saves; identity/audit fields are filled in by the hook. */
export interface TemplateDraft {
  id?: string;
  name: string;
  description?: string;
  projectKey: string;
  projectId: string;
  issueTypeId: string;
  issueTypeName: string;
  fields: TemplateFieldEntry[];
  manualUrlParams?: ManualUrlParam[];
}

export interface UseTemplateLibraryResult {
  templates: JiraTemplate[];
  isLoading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  saveTemplate: (draft: TemplateDraft) => Promise<{ ok: boolean; conflicts: string[] }>;
  deleteTemplate: (templateId: string) => Promise<{ ok: boolean; conflicts: string[] }>;
}

function createTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Hook owning the shared template library state and its load/save/delete operations. */
export function useTemplateLibrary(): UseTemplateLibraryResult {
  const [templates, setTemplates] = useState<JiraTemplate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The store as last seen remotely — the merge base that protects concurrent editors.
  const baseSnapshotRef = useRef<JiraTemplateStore>({ schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION, updatedAt: '', templates: [] });

  const reload = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const store = await loadJiraTemplates(SHARED_TEMPLATE_DATABASE_ID);
      baseSnapshotRef.current = store;
      setTemplates(store.templates);
    } catch {
      setErrorMessage(LOAD_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // The first load is deliberately not `reload`. isLoading already starts true, so re-announcing it
  // would force a second render for nothing; and isActive stops a late response writing to a hook
  // whose component has unmounted, which reload cannot guard on its own.
  useEffect(() => {
    let isActive = true;

    loadJiraTemplates(SHARED_TEMPLATE_DATABASE_ID)
      .then((store) => {
        if (!isActive) return;
        baseSnapshotRef.current = store;
        setTemplates(store.templates);
        setErrorMessage(null);
      })
      .catch(() => {
        if (isActive) setErrorMessage(LOAD_ERROR_MESSAGE);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => { isActive = false; };
  }, []);

  /** Merges a working store against the freshly-fetched remote and persists when conflict-free. */
  const persistWorkingStore = useCallback(async (workingTemplates: JiraTemplate[]): Promise<{ ok: boolean; conflicts: string[] }> => {
    const workingStore: JiraTemplateStore = {
      schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      templates: workingTemplates,
    };
    const remoteStore = await loadJiraTemplates(SHARED_TEMPLATE_DATABASE_ID);
    const { merged, conflicts } = mergeJiraTemplateStores(baseSnapshotRef.current, remoteStore, workingStore);
    if (conflicts.length > 0) {
      return { ok: false, conflicts };
    }
    const savedStore = await saveJiraTemplates(SHARED_TEMPLATE_DATABASE_ID, merged);
    baseSnapshotRef.current = savedStore;
    setTemplates(savedStore.templates);
    return { ok: true, conflicts: [] };
  }, []);

  const saveTemplate = useCallback(async (draft: TemplateDraft): Promise<{ ok: boolean; conflicts: string[] }> => {
    const authorName = await resolveAuthorName();
    const nowIso = new Date().toISOString();
    const existing = templates.find((template) => template.id === draft.id);
    const fullTemplate: JiraTemplate = {
      id: draft.id ?? createTemplateId(),
      name: draft.name,
      description: draft.description ?? '',
      projectKey: draft.projectKey,
      projectId: draft.projectId,
      issueTypeId: draft.issueTypeId,
      issueTypeName: draft.issueTypeName,
      fields: draft.fields,
      manualUrlParams: draft.manualUrlParams ?? [],
      // Preserve the original author on edit; record the current user on first save.
      authorName: existing?.authorName ?? authorName,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    const workingTemplates = [
      ...templates.filter((template) => template.id !== fullTemplate.id),
      fullTemplate,
    ];
    return persistWorkingStore(workingTemplates);
  }, [templates, persistWorkingStore]);

  const deleteTemplate = useCallback(async (templateId: string): Promise<{ ok: boolean; conflicts: string[] }> => {
    return persistWorkingStore(templates.filter((template) => template.id !== templateId));
  }, [templates, persistWorkingStore]);

  return { templates, isLoading, errorMessage, reload, saveTemplate, deleteTemplate };
}
