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

/** Loads createmeta for a project key, re-fetching whenever the key changes. */
export function useJiraCreateMeta(projectKey: string | null): UseJiraCreateMetaResult {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issueTypes, setIssueTypes] = useState<CreateMetaIssueType[]>([]);
  const [fieldsByIssueType, setFieldsByIssueType] = useState<Record<string, FieldDescriptor[]>>({});
  const [areFieldsLoading, setAreFieldsLoading] = useState<boolean>(false);

  // Load the project's issue types whenever the project changes.
  useEffect(() => {
    setFieldsByIssueType({});
    if (!projectKey) {
      setIssueTypes([]);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);

    async function loadIssueTypes(): Promise<void> {
      try {
        const response = await getProjectIssueTypes(projectKey as string);
        if (!isMounted) {
          return;
        }
        const loadedIssueTypes = response.values ?? [];
        setIssueTypes(loadedIssueTypes);
        setErrorMessage(loadedIssueTypes.length === 0 ? NO_ISSUE_TYPES_MESSAGE : null);
      } catch (caught) {
        if (isMounted) {
          setIssueTypes([]);
          setErrorMessage(`${ISSUE_TYPES_ERROR} (${caught instanceof Error ? caught.message : String(caught)})`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssueTypes();
    return () => { isMounted = false; };
  }, [projectKey]);

  const loadFields = useCallback((issueTypeId: string): void => {
    if (!projectKey || !issueTypeId) {
      return;
    }
    setFieldsByIssueType((cache) => {
      if (cache[issueTypeId]) {
        return cache; // already loaded
      }
      // Kick off the fetch outside the updater; mark loading.
      setAreFieldsLoading(true);
      void getIssueTypeFields(projectKey, issueTypeId)
        .then((response) => {
          setFieldsByIssueType((current) => ({ ...current, [issueTypeId]: mapCreateMetaFieldList(response.values ?? []) }));
          setErrorMessage(null);
        })
        .catch((caught) => {
          setErrorMessage(`${FIELDS_ERROR} (${caught instanceof Error ? caught.message : String(caught)})`);
        })
        .finally(() => setAreFieldsLoading(false));
      return cache;
    });
  }, [projectKey]);

  const getFieldDescriptors = useCallback(
    (issueTypeId: string): FieldDescriptor[] => fieldsByIssueType[issueTypeId] ?? [],
    [fieldsByIssueType],
  );

  const hasCreatePermission = issueTypes.length > 0;

  return { isLoading, errorMessage, issueTypes, hasCreatePermission, loadFields, getFieldDescriptors, areFieldsLoading };
}
