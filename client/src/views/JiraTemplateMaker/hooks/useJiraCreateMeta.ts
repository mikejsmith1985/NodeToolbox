// useJiraCreateMeta.ts — Loads Jira create metadata for a project via the modern createmeta
// endpoints (Cloud + DC 8.4+): issue types eagerly when the project is chosen, and the fields
// for a given issue type lazily (cached) when it is selected. Every choice in the wizard is
// constrained by this live data. On failure it surfaces a plain-language message plus the
// underlying reason, and presents no guessed data (FR-7.2).

import { useCallback, useEffect, useState } from 'react';

import { getIssueTypeFields, getProjectIssueTypes } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueType } from '../../../types/jira.ts';
import { mapCreateMetaFieldList } from '../lib/fieldModel.ts';
import type { FieldDescriptor } from '../lib/templateTypes.ts';

const ISSUE_TYPES_ERROR = 'Could not load issue types for this project. Check your Jira access and try again.';
const NO_ISSUE_TYPES_MESSAGE = 'This project exposes no issue types you can create. You may not have create permission here.';
const FIELDS_ERROR = 'Could not load the fields for this issue type. Check your Jira access and try again.';

export interface UseJiraCreateMetaResult {
  isLoading: boolean;
  errorMessage: string | null;
  issueTypes: CreateMetaIssueType[];
  hasCreatePermission: boolean;
  /** Fetches and caches the field descriptors for an issue type (no-op if already cached). */
  loadFields: (issueTypeId: string) => void;
  /** Returns the cached field descriptors for an issue type (empty until loaded). */
  getFieldDescriptors: (issueTypeId: string) => FieldDescriptor[];
  areFieldsLoading: boolean;
}

/** The issue types loaded for one project, remembered alongside the project they describe. */
interface IssueTypesResult {
  projectKey: string | null;
  issueTypes: CreateMetaIssueType[];
  errorMessage: string | null;
}

/** A field-load failure, remembered alongside the project it happened under. */
interface FieldsError {
  projectKey: string | null;
  message: string | null;
}

/** Builds the cache key for one issue type's fields. Scoped by project so two projects cannot collide. */
function buildFieldCacheKey(projectKey: string, issueTypeId: string): string {
  return `${projectKey}:${issueTypeId}`;
}

/** Loads createmeta for a project key, re-fetching whenever the key changes. */
export function useJiraCreateMeta(projectKey: string | null): UseJiraCreateMetaResult {
  const [issueTypesResult, setIssueTypesResult] = useState<IssueTypesResult>({ projectKey: null, issueTypes: [], errorMessage: null });
  const [fieldsByCacheKey, setFieldsByCacheKey] = useState<Record<string, FieldDescriptor[]>>({});
  const [fieldsError, setFieldsError] = useState<FieldsError>({ projectKey: null, message: null });
  const [areFieldsLoading, setAreFieldsLoading] = useState<boolean>(false);

  // Everything the caller sees is derived from one question: does the data on hand belong to the
  // project being asked about? That makes switching project self-clearing — the previous project's
  // issue types simply stop matching — where before an effect had to blank four values by hand, and
  // did it on the way in, costing an extra render every time.
  const hasResultForThisProject = issueTypesResult.projectKey === projectKey;
  const issueTypes = hasResultForThisProject ? issueTypesResult.issueTypes : [];
  // Loading is not a fact to store: it is simply "a project is chosen and its answer is not here yet".
  const isLoading = projectKey !== null && !hasResultForThisProject;
  const errorMessage = (fieldsError.projectKey === projectKey ? fieldsError.message : null)
    ?? (hasResultForThisProject ? issueTypesResult.errorMessage : null);

  // Load the project's issue types whenever the project changes. Nothing is set synchronously here:
  // the derivations above already describe the in-between state correctly.
  useEffect(() => {
    if (!projectKey) {
      return; // No project chosen; the derived values are already empty.
    }

    let isMounted = true;
    getProjectIssueTypes(projectKey)
      .then((response) => {
        if (!isMounted) return;
        const loadedIssueTypes = response.values ?? [];
        setIssueTypesResult({
          projectKey,
          issueTypes: loadedIssueTypes,
          errorMessage: loadedIssueTypes.length === 0 ? NO_ISSUE_TYPES_MESSAGE : null,
        });
      })
      .catch((caught: unknown) => {
        if (!isMounted) return;
        setIssueTypesResult({
          projectKey,
          issueTypes: [],
          errorMessage: `${ISSUE_TYPES_ERROR} (${caught instanceof Error ? caught.message : String(caught)})`,
        });
      });

    return () => { isMounted = false; };
  }, [projectKey]);

  const loadFields = useCallback((issueTypeId: string): void => {
    if (!projectKey || !issueTypeId) {
      return;
    }
    const cacheKey = buildFieldCacheKey(projectKey, issueTypeId);
    setFieldsByCacheKey((cache) => {
      if (cache[cacheKey]) {
        return cache; // already loaded
      }
      // Kick off the fetch outside the updater; mark loading.
      setAreFieldsLoading(true);
      void getIssueTypeFields(projectKey, issueTypeId)
        .then((response) => {
          setFieldsByCacheKey((current) => ({ ...current, [cacheKey]: mapCreateMetaFieldList(response.values ?? []) }));
          setFieldsError({ projectKey, message: null });
        })
        .catch((caught: unknown) => {
          setFieldsError({ projectKey, message: `${FIELDS_ERROR} (${caught instanceof Error ? caught.message : String(caught)})` });
        })
        .finally(() => setAreFieldsLoading(false));
      return cache;
    });
  }, [projectKey]);

  // Reads through the project-scoped key, so a previous project's fields can never be handed back
  // and no reset is needed when the project changes.
  const getFieldDescriptors = useCallback(
    (issueTypeId: string): FieldDescriptor[] =>
      (projectKey ? fieldsByCacheKey[buildFieldCacheKey(projectKey, issueTypeId)] : undefined) ?? [],
    [fieldsByCacheKey, projectKey],
  );

  const hasCreatePermission = issueTypes.length > 0;

  return { isLoading, errorMessage, issueTypes, hasCreatePermission, loadFields, getFieldDescriptors, areFieldsLoading };
}
