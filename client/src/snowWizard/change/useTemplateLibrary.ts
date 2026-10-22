// useTemplateLibrary.ts — The Wizard's one handle on saved templates: change templates and task templates — save, delete, share, import (one, or Toolbox's whole library).
//
// Built entirely on Toolbox's own template stores (useCrgTemplates + useCtaskTemplates), so a template saved here is
// the same template Toolbox's Create CHG tab lists. Each screen keeps ONE of these and hands it to every part that
// saves: the stores each hold their own copy of the list, so two copies changing at once could undo each other.

import { useCallback, useMemo } from 'react';

import { buildCurrentTemplateData, type CrgTemplateSourceState } from '../../views/SnowHub/hooks/crgTemplateData.ts';
import type { CrgTemplate, CtaskTemplate, CtaskTemplateData } from '../../views/SnowHub/hooks/useCrgState.ts';
import { MAX_TEMPLATES, useCrgTemplates } from '../../views/SnowHub/hooks/useCrgTemplates.ts';
import { MAX_CTASK_TEMPLATES, useCtaskTemplates } from '../../views/SnowHub/hooks/useCtaskTemplates.ts';
import { importSharedLibrary as importLibraryInto, type LibraryImportOutcome, type SharedTemplateLibraryPayload } from './templateLibraryShare.ts';
import { importSharedCtaskTemplates, importSharedTemplate, type SharedTemplatePayload } from './templateShare.ts';
import { findTemplateByName, planStagedTaskLinks } from './templateSave.ts';

/** The change draft's parts a template is saved from: the reusable values and the tasks staged on it. */
export type TemplateDraft = CrgTemplateSourceState & { changeTasks: CtaskTemplate[] };

/** Everything the Wizard's template screens need. */
export interface TemplateLibrary {
  templates: CrgTemplate[];
  ctaskTemplates: CtaskTemplate[];
  findTemplateByName: (name: string) => CrgTemplate | undefined;
  listLinkedTasks: (template: CrgTemplate) => CtaskTemplate[];
  /** Saves the draft as a new template, or over `replaceTemplateId` when given. */
  saveDraftAsTemplate: (name: string, draft: TemplateDraft, replaceTemplateId?: string) => void;
  deleteTemplate: (templateId: string) => void;
  importShared: (payload: SharedTemplatePayload) => { templateId: string; templateName: string };
  /** Saves one task as a reusable task template; returns its id. */
  saveCtaskTemplate: (name: string, templateData: CtaskTemplateData) => string;
  deleteCtaskTemplate: (templateId: string) => void;
  /** Saves shared task templates as the user's own; returns the names they were saved under. */
  importSharedTasks: (ctaskTemplates: readonly CtaskTemplate[]) => string[];
  /** Saves every template from a Toolbox "export all", leaving alone names already here and never overfilling the stores. */
  importSharedLibrary: (payload: SharedTemplateLibraryPayload) => LibraryImportOutcome;
}

/** Saved change templates and their task templates, with the Wizard's save / share / import actions. */
export function useTemplateLibrary(): TemplateLibrary {
  const { templates, saveTemplate, updateTemplate, deleteTemplate } = useCrgTemplates();
  const { templates: ctaskTemplates, saveTemplate: saveCtaskTemplate, deleteTemplate: deleteCtaskTemplate } = useCtaskTemplates();

  const listLinkedTasks = useCallback((template: CrgTemplate) => {
    const linkedIds = template.ctaskTemplateIds ?? [];
    return ctaskTemplates.filter((ctaskTemplate) => linkedIds.includes(ctaskTemplate.id));
  }, [ctaskTemplates]);

  const saveDraftAsTemplate = useCallback((name: string, draft: TemplateDraft, replaceTemplateId?: string) => {
    const linkedIds = planStagedTaskLinks(draft.changeTasks, ctaskTemplates)
      .map((link) => (link.kind === 'reuse' ? link.ctaskTemplateId : saveCtaskTemplate(link.name, link.taskData)));
    const templateData = { ...buildCurrentTemplateData(draft), ctaskTemplateIds: linkedIds };
    if (replaceTemplateId) updateTemplate(replaceTemplateId, templateData);
    else saveTemplate(name, templateData);
  }, [ctaskTemplates, saveCtaskTemplate, saveTemplate, updateTemplate]);

  const importShared = useCallback((payload: SharedTemplatePayload) => importSharedTemplate(payload, {
    existingTemplateNames: templates.map((template) => template.name), saveCrgTemplate: saveTemplate, saveCtaskTemplate,
  }), [templates, saveTemplate, saveCtaskTemplate]);

  const importSharedTasks = useCallback((sharedTasks: readonly CtaskTemplate[]) => importSharedCtaskTemplates(sharedTasks, {
    existingTaskNames: ctaskTemplates.map((ctaskTemplate) => ctaskTemplate.name), saveCtaskTemplate,
  }), [ctaskTemplates, saveCtaskTemplate]);

  const importSharedLibrary = useCallback((payload: SharedTemplateLibraryPayload) => importLibraryInto(payload, {
    existingTemplateNames: templates.map((template) => template.name),
    existingTasks: ctaskTemplates,
    templateRoom: Math.max(MAX_TEMPLATES - templates.length, 0),
    taskRoom: Math.max(MAX_CTASK_TEMPLATES - ctaskTemplates.length, 0),
    saveCrgTemplate: saveTemplate,
    saveCtaskTemplate,
  }), [templates, ctaskTemplates, saveTemplate, saveCtaskTemplate]);

  return useMemo(() => ({
    templates,
    ctaskTemplates,
    findTemplateByName: (name: string) => findTemplateByName(templates, name),
    listLinkedTasks,
    saveDraftAsTemplate,
    deleteTemplate,
    importShared,
    saveCtaskTemplate,
    deleteCtaskTemplate,
    importSharedTasks,
    importSharedLibrary,
  }), [templates, ctaskTemplates, listLinkedTasks, saveDraftAsTemplate, deleteTemplate, importShared, saveCtaskTemplate, deleteCtaskTemplate, importSharedTasks, importSharedLibrary]);
}
