// useCtaskTemplates — Manages reusable ServiceNow Change Task templates in localStorage.

import { useCallback, useEffect, useState } from 'react';

import type { CtaskTemplate } from './useCrgState.ts';

const CTASK_TEMPLATES_STORAGE_KEY = 'ntbx-ctask-templates';
const MAX_CTASK_TEMPLATES = 20;

type CtaskTemplateData = Omit<CtaskTemplate, 'id' | 'name' | 'createdAt'>;

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
  updateTemplate: (templateId: string, templateData: CtaskTemplateData) => void;
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

  const updateTemplate = useCallback((templateId: string, templateData: CtaskTemplateData) => {
    setTemplates((previousTemplates) =>
      previousTemplates.map((template) =>
        template.id === templateId
          ? {
            ...template,
            ...templateData,
            id:        template.id,
            name:      template.name,
            createdAt: template.createdAt,
          }
          : template,
      ),
    );
  }, []);

  const deleteTemplate = useCallback((templateId: string) => {
    setTemplates((previousTemplates) =>
      previousTemplates.filter((template) => template.id !== templateId),
    );
  }, []);

  return { templates, saveTemplate, updateTemplate, deleteTemplate };
}
