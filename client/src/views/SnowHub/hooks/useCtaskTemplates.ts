// useCtaskTemplates — Manages reusable ServiceNow Change Task templates in localStorage.

import { useCallback, useEffect, useState } from 'react';

import type { CtaskTemplate, CtaskTemplateData } from './useCrgState.ts';

const CTASK_TEMPLATES_STORAGE_KEY = 'ntbx-ctask-templates';
// Generous enough that saving a template never quietly evicts one a team still uses; the old cap of 20 did.
export const MAX_CTASK_TEMPLATES = 100;
const DUPLICATE_NAME_SUFFIX = ' (copy)';

function loadCtaskTemplatesFromStorage(): CtaskTemplate[] {
  try {
    const storedJson = localStorage.getItem(CTASK_TEMPLATES_STORAGE_KEY);
    if (!storedJson) return [];
    const parsedTemplates = JSON.parse(storedJson) as unknown;
    if (!Array.isArray(parsedTemplates)) return [];
    return parsedTemplates as CtaskTemplate[];
  } catch {
    return [];
  }
}

function saveCtaskTemplatesToStorage(templates: CtaskTemplate[]): void {
  try {
    localStorage.setItem(CTASK_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Template persistence is convenience-only; CTASK creation still works without storage.
  }
}

interface UseCtaskTemplatesResult {
  templates: CtaskTemplate[];
  saveTemplate: (name: string, templateData: CtaskTemplateData) => string;
  /** Saves edits to a template; a name, when given, renames it. */
  updateTemplate: (templateId: string, templateData: CtaskTemplateData, name?: string) => void;
  /** Copies a template, placing the copy right after it, and returns the copy's id. */
  duplicateTemplate: (templateId: string) => string;
  deleteTemplate: (templateId: string) => void;
}

/**
 * Manages CTASK templates so recurring implementation, validation, or rollout
 * tasks can be reused across Change Requests without retyping each task.
 */
export function useCtaskTemplates(): UseCtaskTemplatesResult {
  const [templates, setTemplates] = useState<CtaskTemplate[]>(() => loadCtaskTemplatesFromStorage());

  useEffect(() => {
    saveCtaskTemplatesToStorage(templates);
  }, [templates]);

  const saveTemplate = useCallback((name: string, templateData: CtaskTemplateData): string => {
    const newTemplate: CtaskTemplate = {
      id:        crypto.randomUUID(),
      name:      name.trim() || 'Unnamed CTASK Template',
      createdAt: new Date().toISOString(),
      ...templateData,
    };

    setTemplates((previousTemplates) => {
      const trimmedTemplates = previousTemplates.length >= MAX_CTASK_TEMPLATES
        ? previousTemplates.slice(0, MAX_CTASK_TEMPLATES - 1)
        : previousTemplates;
      return [newTemplate, ...trimmedTemplates];
    });

    return newTemplate.id;
  }, []);

  const updateTemplate = useCallback((templateId: string, templateData: CtaskTemplateData, name?: string) => {
    setTemplates((previousTemplates) =>
      previousTemplates.map((template) =>
        template.id === templateId
          ? {
            ...template,
            ...templateData,
            id:        template.id,
            name:      name?.trim() || template.name,
            createdAt: template.createdAt,
          }
          : template,
      ),
    );
  }, []);

  const duplicateTemplate = useCallback((templateId: string): string => {
    const copyId = crypto.randomUUID();
    setTemplates((previousTemplates) => {
      const sourceIndex = previousTemplates.findIndex((template) => template.id === templateId);
      if (sourceIndex < 0) return previousTemplates;
      const sourceTemplate = previousTemplates[sourceIndex];
      const templateCopy: CtaskTemplate = {
        ...sourceTemplate,
        id:        copyId,
        name:      `${sourceTemplate.name}${DUPLICATE_NAME_SUFFIX}`,
        createdAt: new Date().toISOString(),
      };
      return [...previousTemplates.slice(0, sourceIndex + 1), templateCopy, ...previousTemplates.slice(sourceIndex + 1)];
    });
    return copyId;
  }, []);

  const deleteTemplate = useCallback((templateId: string) => {
    setTemplates((previousTemplates) =>
      previousTemplates.filter((template) => template.id !== templateId),
    );
  }, []);

  return { templates, saveTemplate, updateTemplate, duplicateTemplate, deleteTemplate };
}
