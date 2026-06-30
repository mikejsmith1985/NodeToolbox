// useTemplateLaunch.ts — Drives creating a real Jira issue from a saved template.
// Collects values for prompt-at-launch fields, validates required fields before any POST, then
// creates the issue and exposes an open-in-Jira link.

import { useCallback, useState } from 'react';

import { createIssue } from '../../../services/jiraApi.ts';
import { buildBrowseUrl } from '../lib/browseUrl.ts';
import { buildCreatePayload } from '../lib/buildCreatePayload.ts';
import { findMissingRequiredFields } from '../lib/requiredFields.ts';
import type { FieldDescriptor, JiraTemplate } from '../lib/templateTypes.ts';

const CREATE_ERROR_MESSAGE = 'Could not create the issue in Jira. Check the field values and your access, then try again.';

export interface CreatedIssueResult {
  key: string;
  browseUrl: string;
}

export interface UseTemplateLaunchResult {
  launchAnswers: Record<string, unknown>;
  setLaunchAnswer: (fieldId: string, value: unknown) => void;
  isCreating: boolean;
  createdIssue: CreatedIssueResult | null;
  missingRequiredNames: string[];
  errorMessage: string | null;
  createFromTemplate: (template: JiraTemplate, descriptors: FieldDescriptor[]) => Promise<void>;
  reset: () => void;
}

/** Hook owning the launch (create-from-template) flow state. */
export function useTemplateLaunch(): UseTemplateLaunchResult {
  const [launchAnswers, setLaunchAnswers] = useState<Record<string, unknown>>({});
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createdIssue, setCreatedIssue] = useState<CreatedIssueResult | null>(null);
  const [missingRequiredNames, setMissingRequiredNames] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setLaunchAnswer = useCallback((fieldId: string, value: unknown) => {
    setLaunchAnswers((previous) => ({ ...previous, [fieldId]: value }));
  }, []);

  const reset = useCallback(() => {
    setLaunchAnswers({});
    setIsCreating(false);
    setCreatedIssue(null);
    setMissingRequiredNames([]);
    setErrorMessage(null);
  }, []);

  const createFromTemplate = useCallback(async (template: JiraTemplate, descriptors: FieldDescriptor[]): Promise<void> => {
    setErrorMessage(null);
    setMissingRequiredNames([]);

    const payload = buildCreatePayload({ template, launchAnswers });
    const missing = findMissingRequiredFields(descriptors, payload.fields);
    if (missing.length > 0) {
      // Block create entirely so no partial issue is produced (FR-5.2).
      setMissingRequiredNames(missing);
      return;
    }

    setIsCreating(true);
    try {
      const created = await createIssue(payload);
      setCreatedIssue({ key: created.key, browseUrl: buildBrowseUrl(created.self, created.key) });
    } catch {
      setErrorMessage(CREATE_ERROR_MESSAGE);
    } finally {
      setIsCreating(false);
    }
  }, [launchAnswers]);

  return {
    launchAnswers, setLaunchAnswer, isCreating, createdIssue,
    missingRequiredNames, errorMessage, createFromTemplate, reset,
  };
}
