// useJiraCreateMeta.ts — Loads Jira create metadata for a project and exposes its issue types
// and per-issue-type field descriptors. Every choice in the wizard is constrained by this live
// data so a user can never build an invalid issue. On failure it surfaces a plain-language
// message and presents no guessed data (FR-7.2).

import { useEffect, useMemo, useState } from 'react';

import { getCreateMeta } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueType, CreateMetaProject } from '../../../types/jira.ts';
import { mapCreateMetaFields } from '../lib/fieldModel.ts';
import type { FieldDescriptor } from '../lib/templateTypes.ts';

const LOAD_ERROR_MESSAGE = 'Could not load issue types and fields for this project. Check your Jira access and try again.';
const NO_PERMISSION_MESSAGE = 'This project has no issue types you can create. You may not have permission to create issues here.';

export interface UseJiraCreateMetaResult {
  isLoading: boolean;
  errorMessage: string | null;
  project: CreateMetaProject | null;
  issueTypes: CreateMetaIssueType[];
  /** True only when the project resolved with at least one creatable issue type. */
  hasCreatePermission: boolean;
  /** Maps the chosen issue type's createmeta fields to internal descriptors. */
  getFieldDescriptors: (issueTypeId: string) => FieldDescriptor[];
}

/** Loads createmeta for the given project key, re-fetching whenever the key changes. */
export function useJiraCreateMeta(projectKey: string | null): UseJiraCreateMetaResult {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [project, setProject] = useState<CreateMetaProject | null>(null);

  useEffect(() => {
    if (!projectKey) {
      setProject(null);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);

    async function loadCreateMeta(): Promise<void> {
      try {
        const response = await getCreateMeta(projectKey as string);
        if (!isMounted) {
          return;
        }
        const matchedProject = response.projects.find((candidate) => candidate.key === projectKey)
          ?? response.projects[0]
          ?? null;
        setProject(matchedProject);
        // A reachable project with no creatable issue types signals missing create permission.
        setErrorMessage(matchedProject && matchedProject.issuetypes.length === 0 ? NO_PERMISSION_MESSAGE : null);
      } catch {
        if (isMounted) {
          setProject(null);
          setErrorMessage(LOAD_ERROR_MESSAGE);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCreateMeta();
    return () => {
      isMounted = false;
    };
  }, [projectKey]);

  const issueTypes = useMemo(() => project?.issuetypes ?? [], [project]);
  const hasCreatePermission = Boolean(project) && issueTypes.length > 0;

  function getFieldDescriptors(issueTypeId: string): FieldDescriptor[] {
    const issueType = issueTypes.find((candidate) => candidate.id === issueTypeId);
    if (!issueType?.fields) {
      return [];
    }
    return mapCreateMetaFields(issueType.fields);
  }

  return { isLoading, errorMessage, project, issueTypes, hasCreatePermission, getFieldDescriptors };
}
