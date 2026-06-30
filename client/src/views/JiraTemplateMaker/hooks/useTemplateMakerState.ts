// useTemplateMakerState.ts — Owns the wizard's step and draft-template state.
// Pure UI state (no I/O). Enforces the dependent flow: changing the project or issue type
// re-scopes downstream selections and warns when previously chosen fields are dropped (FR-1.4).

import { useCallback, useMemo, useState } from 'react';

import type { FieldEntryMode, JiraTemplate, TemplateFieldEntry, TemplateFieldType } from '../lib/templateTypes.ts';

/** Wizard steps in order. */
export const TEMPLATE_MAKER_STEPS = ['project', 'issueType', 'fields', 'review'] as const;
export type TemplateMakerStep = typeof TEMPLATE_MAKER_STEPS[number];

export interface UseTemplateMakerStateResult {
  currentStep: TemplateMakerStep;
  goToStep: (step: TemplateMakerStep) => void;
  /** The id of the template currently being edited, or null when building a new one. */
  editingTemplateId: string | null;
  /** Loads a saved template back into the wizard for editing. */
  loadTemplate: (template: JiraTemplate) => void;
  projectKey: string;
  projectId: string;
  issueTypeId: string;
  issueTypeName: string;
  templateName: string;
  templateDescription: string;
  fieldEntries: TemplateFieldEntry[];
  rescopeWarning: string | null;
  dismissRescopeWarning: () => void;
  setProject: (projectKey: string, projectId: string) => void;
  setIssueType: (issueTypeId: string, issueTypeName: string) => void;
  setTemplateName: (name: string) => void;
  setTemplateDescription: (description: string) => void;
  addField: (entry: TemplateFieldEntry) => void;
  removeField: (fieldId: string) => void;
  setFieldValue: (fieldId: string, value: unknown) => void;
  setFieldDefault: (fieldId: string, defaultValue: unknown) => void;
  setFieldMode: (fieldId: string, mode: FieldEntryMode) => void;
  reset: () => void;
}

function buildRescopeWarning(droppedEntries: TemplateFieldEntry[]): string | null {
  if (droppedEntries.length === 0) {
    return null;
  }
  const droppedNames = droppedEntries.map((entry) => entry.fieldName).join(', ');
  return `Changing this cleared fields that no longer apply: ${droppedNames}.`;
}

/** Manages the wizard's step pointer and the in-progress template draft. */
export function useTemplateMakerState(): UseTemplateMakerStateResult {
  const [currentStep, setCurrentStep] = useState<TemplateMakerStep>('project');
  const [projectKey, setProjectKey] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [issueTypeId, setIssueTypeId] = useState<string>('');
  const [issueTypeName, setIssueTypeName] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [templateDescription, setTemplateDescription] = useState<string>('');
  const [fieldEntries, setFieldEntries] = useState<TemplateFieldEntry[]>([]);
  const [rescopeWarning, setRescopeWarning] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const goToStep = useCallback((step: TemplateMakerStep) => setCurrentStep(step), []);
  const dismissRescopeWarning = useCallback(() => setRescopeWarning(null), []);

  const loadTemplate = useCallback((template: JiraTemplate) => {
    setEditingTemplateId(template.id);
    setProjectKey(template.projectKey);
    setProjectId(template.projectId);
    setIssueTypeId(template.issueTypeId);
    setIssueTypeName(template.issueTypeName);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setFieldEntries(template.fields.map((entry) => ({ ...entry })));
    setRescopeWarning(null);
    setCurrentStep('fields');
  }, []);

  const setProject = useCallback((nextProjectKey: string, nextProjectId: string) => {
    setProjectKey((previousKey) => {
      if (previousKey !== nextProjectKey) {
        // Project changed: issue type and all field selections no longer apply.
        setIssueTypeId('');
        setIssueTypeName('');
        setFieldEntries((previousEntries) => {
          setRescopeWarning(buildRescopeWarning(previousEntries));
          return [];
        });
      }
      return nextProjectKey;
    });
    setProjectId(nextProjectId);
  }, []);

  const setIssueType = useCallback((nextIssueTypeId: string, nextIssueTypeName: string) => {
    setIssueTypeId((previousId) => {
      if (previousId !== nextIssueTypeId) {
        setFieldEntries((previousEntries) => {
          setRescopeWarning(buildRescopeWarning(previousEntries));
          return [];
        });
      }
      return nextIssueTypeId;
    });
    setIssueTypeName(nextIssueTypeName);
  }, []);

  const addField = useCallback((entry: TemplateFieldEntry) => {
    setFieldEntries((previousEntries) => (
      previousEntries.some((existing) => existing.fieldId === entry.fieldId)
        ? previousEntries
        : [...previousEntries, entry]
    ));
  }, []);

  const removeField = useCallback((fieldId: string) => {
    setFieldEntries((previousEntries) => previousEntries.filter((entry) => entry.fieldId !== fieldId));
  }, []);

  const setFieldValue = useCallback((fieldId: string, value: unknown) => {
    setFieldEntries((previousEntries) => previousEntries.map((entry) => (
      entry.fieldId === fieldId ? { ...entry, value } : entry
    )));
  }, []);

  const setFieldDefault = useCallback((fieldId: string, defaultValue: unknown) => {
    setFieldEntries((previousEntries) => previousEntries.map((entry) => (
      entry.fieldId === fieldId ? { ...entry, defaultValue } : entry
    )));
  }, []);

  const setFieldMode = useCallback((fieldId: string, mode: FieldEntryMode) => {
    setFieldEntries((previousEntries) => previousEntries.map((entry) => (
      entry.fieldId === fieldId ? { ...entry, mode } : entry
    )));
  }, []);

  const reset = useCallback(() => {
    setCurrentStep('project');
    setProjectKey('');
    setProjectId('');
    setIssueTypeId('');
    setIssueTypeName('');
    setTemplateName('');
    setTemplateDescription('');
    setFieldEntries([]);
    setRescopeWarning(null);
    setEditingTemplateId(null);
  }, []);

  return useMemo(() => ({
    currentStep, goToStep, editingTemplateId, loadTemplate,
    projectKey, projectId, issueTypeId, issueTypeName,
    templateName, templateDescription, fieldEntries, rescopeWarning, dismissRescopeWarning,
    setProject, setIssueType, setTemplateName, setTemplateDescription,
    addField, removeField, setFieldValue, setFieldDefault, setFieldMode, reset,
  }), [
    currentStep, goToStep, editingTemplateId, loadTemplate, projectKey, projectId, issueTypeId, issueTypeName,
    templateName, templateDescription, fieldEntries, rescopeWarning, dismissRescopeWarning,
    setProject, setIssueType, addField, removeField, setFieldValue, setFieldDefault, setFieldMode, reset,
  ]);
}

/** Helper for callers building a new field entry from a descriptor selection. */
export function createFieldEntry(
  fieldId: string,
  fieldName: string,
  fieldType: TemplateFieldType,
): TemplateFieldEntry {
  return { fieldId, fieldName, fieldType, mode: 'fixed' };
}
