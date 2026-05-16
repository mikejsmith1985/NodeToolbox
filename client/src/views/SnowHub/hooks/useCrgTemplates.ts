// useCrgTemplates — Manages named CHG field templates stored in localStorage.
// Templates let users save, update, and reapply a common set of Change Request
// selections without re-entering the same values for every recurring release.

import { useCallback, useEffect, useState } from 'react';

import type { CrgTemplate } from './useCrgState.ts';

// localStorage key used to persist templates between sessions.
const TEMPLATES_STORAGE_KEY = 'ntbx-crg-templates';
const DEFAULT_TEMPLATE_ID_STORAGE_KEY = 'ntbx-crg-default-template-id';

// Maximum templates allowed to prevent unbounded localStorage growth.
const MAX_TEMPLATES = 20;

type CrgTemplateData = Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>;

/**
 * Reads all saved templates from localStorage.
 * Returns an empty array if none exist or if the stored data is malformed.
 */
function loadTemplatesFromStorage(): CrgTemplate[] {
  try {
    const storedJson = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!storedJson) return [];
    const parsed = JSON.parse(storedJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CrgTemplate[];
  } catch {
    // Corrupted storage — start fresh rather than crashing.
    return [];
  }
}

function saveTemplatesToStorage(templates: CrgTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Storage quota exceeded or private browsing — silently ignore.
  }
}

function loadDefaultTemplateIdFromStorage(): string | null {
  try {
    return localStorage.getItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveDefaultTemplateIdToStorage(defaultTemplateId: string | null): void {
  try {
    if (!defaultTemplateId) {
      localStorage.removeItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DEFAULT_TEMPLATE_ID_STORAGE_KEY, defaultTemplateId);
  } catch {
    // Storage quota exceeded or private browsing — silently ignore.
  }
}

interface UseCrgTemplatesResult {
  /** All saved templates ordered by creation date (newest first). */
  templates: CrgTemplate[];
  /** Optional selected template ID that should auto-apply on Step 3 in wizard mode. */
  defaultTemplateId: string | null;
  /**
   * Saves the provided template data under the given name.
   * Returns the ID of the newly created template so the caller can
   * immediately apply it or highlight it in the UI.
   */
  saveTemplate: (name: string, templateData: CrgTemplateData) => string;
  /** Replaces the stored values in an existing template while keeping its name and identity. */
  updateTemplate: (templateId: string, templateData: CrgTemplateData) => void;
  /** Permanently deletes the template with the given ID. */
  deleteTemplate: (templateId: string) => void;
  /** Marks a template as the default Step 3 starter. */
  setDefaultTemplateId: (templateId: string) => void;
  /** Clears any previously selected default template. */
  clearDefaultTemplateId: () => void;
}

/**
 * Manages CHG field templates in localStorage so users can save a common
 * set of Steps 3-5 values and re-apply them from the shared CRG workspace.
 */
export function useCrgTemplates(): UseCrgTemplatesResult {
  const [templates, setTemplates] = useState<CrgTemplate[]>(() => loadTemplatesFromStorage());
  const [defaultTemplateId, setDefaultTemplateIdState] = useState<string | null>(() => loadDefaultTemplateIdFromStorage());

  // Keep localStorage in sync whenever the in-memory list changes.
  useEffect(() => {
    saveTemplatesToStorage(templates);
  }, [templates]);

  useEffect(() => {
    saveDefaultTemplateIdToStorage(defaultTemplateId);
  }, [defaultTemplateId]);

  const saveTemplate = useCallback(
    (name: string, templateData: CrgTemplateData): string => {
      const newTemplate: CrgTemplate = {
        id:        crypto.randomUUID(),
        name:      name.trim() || 'Unnamed Template',
        createdAt: new Date().toISOString(),
        ...templateData,
      };

      setTemplates((previousTemplates) => {
        // Enforce the cap by dropping the oldest template when full.
        const trimmed = previousTemplates.length >= MAX_TEMPLATES
          ? previousTemplates.slice(0, MAX_TEMPLATES - 1)
          : previousTemplates;
        // Newest template first so the dropdown naturally shows recent items at the top.
        return [newTemplate, ...trimmed];
      });

      return newTemplate.id;
    },
    [],
  );

  const updateTemplate = useCallback((templateId: string, templateData: CrgTemplateData) => {
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
    setDefaultTemplateIdState((previousDefaultTemplateId) => (
      previousDefaultTemplateId === templateId ? null : previousDefaultTemplateId
    ));
  }, []);

  const setDefaultTemplateId = useCallback((templateId: string) => {
    setDefaultTemplateIdState(templateId);
  }, []);

  const clearDefaultTemplateId = useCallback(() => {
    setDefaultTemplateIdState(null);
  }, []);

  return {
    templates,
    defaultTemplateId,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplateId,
    clearDefaultTemplateId,
  };
}
