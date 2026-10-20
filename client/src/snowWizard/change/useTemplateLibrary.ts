// useTemplateLibrary.ts — The Wizard's one handle on saved change templates: save the change in hand, delete, share, import.
//
// Built entirely on Toolbox's own template stores (useCrgTemplates + useCtaskTemplates), so a template saved here is
// the same template Toolbox's Create CHG tab lists. Each screen keeps ONE of these: the stores each hold their own
// copy of the list, so two copies changing at once could undo each other.

import { useCallback, useMemo } from 'react';

import { buildCurrentTemplateData, type CrgTemplateSourceState } from '../../views/SnowHub/hooks/crgTemplateData.ts';
import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { useCrgTemplates } from '../../views/SnowHub/hooks/useCrgTemplates.ts';
import { useCtaskTemplates } from '../../views/SnowHub/hooks/useCtaskTemplates.ts';
import { importSharedTemplate, type SharedTemplatePayload } from './templateShare.ts';
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
}

/** Saved change templates and their task templates, with the Wizard's save / share / import actions. */
export function useTemplateLibrary(): TemplateLibrary {
  const crgStore = useCrgTemplates();
  const ctaskStore = useCtaskTemplates();
  const { templates, saveTemplate, updateTemplate, deleteTemplate } = crgStore;
  const { templates: ctaskTemplates, saveTemplate: saveCtaskTemplate } = ctaskStore;

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

  return useMemo(() => ({
    templates,
    ctaskTemplates,
    findTemplateByName: (name: string) => findTemplateByName(templates, name),
    listLinkedTasks,
    saveDraftAsTemplate,
    deleteTemplate,
    importShared,
  }), [templates, ctaskTemplates, listLinkedTasks, saveDraftAsTemplate, deleteTemplate, importShared]);
}
