// templateLibraryShare.test.ts — Proves every template moves from Toolbox to the Wizard in one code or file: links kept,
// names already in the Wizard left alone, and nothing saved past the store's limit (which would drop old templates).

import { describe, expect, it, vi } from 'vitest';

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  TEMPLATE_LIBRARY_FILE_NAME, TEMPLATE_LIBRARY_PREFIX, decodeTemplateLibraryShare, importSharedLibrary, isTemplateLibraryShareText,
  prepareTemplateLibraryExport, type LibraryImportSinks, type SharedTemplateLibraryPayload,
} from './templateLibraryShare.ts';

const REFERENCE = { sysId: 'grp-1', displayName: 'Payments ✓' };
const BLANK = { sysId: '', displayName: '' };

function buildTemplate(id: string, name: string, ctaskTemplateIds: string[] = []): CrgTemplate {
  return {
    id, name, createdAt: '',
    chgBasicInfo: {
      category: 'software', changeType: 'normal', environment: '', requestedBy: BLANK, configItem: REFERENCE, assignmentGroup: REFERENCE,
      assignedTo: BLANK, changeManager: BLANK, tester: BLANK, serviceManager: BLANK, isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '3', systemAvailabilityImplication: '', hasBeenTested: 'yes', impactedPersonsAware: '', hasBeenPerformedPreviously: '',
      successProbability: '', canBeBackedOut: '',
    },
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Roll back', testPlan: '1. Smoke' },
    ctaskTemplateIds,
  };
}

function buildTask(id: string, name: string): CtaskTemplate {
  return {
    id, name, createdAt: '', shortDescription: name, description: '', assignmentGroup: REFERENCE, assignedTo: BLANK,
    plannedStartDate: '', plannedEndDate: '', closeNotes: '',
  };
}

/** Fake stores that hand out ids and remember what was saved, in save order. */
function buildSinks(overrides: Partial<LibraryImportSinks> = {}) {
  const savedTemplates: Array<{ name: string; ctaskTemplateIds?: string[] }> = [];
  const savedTaskNames: string[] = [];
  const sinks: LibraryImportSinks = {
    existingTemplateNames: [], existingTasks: [], templateRoom: 20, taskRoom: 100,
    saveCrgTemplate: vi.fn((name, templateData) => { savedTemplates.push({ name, ctaskTemplateIds: templateData.ctaskTemplateIds }); return `new-tpl-${savedTemplates.length}`; }),
    saveCtaskTemplate: vi.fn((name) => { savedTaskNames.push(name); return `new-task-${name}`; }),
    ...overrides,
  };
  return { sinks, savedTemplates, savedTaskNames };
}

function decodePayload(text: string): SharedTemplateLibraryPayload {
  const decoded = decodeTemplateLibraryShare(text);
  if (!decoded.isValid) throw new Error(decoded.errorMessage);
  return decoded.payload;
}

describe('prepareTemplateLibraryExport / decodeTemplateLibraryShare', () => {
  it('carries every change template and every task template in one code and one file', async () => {
    const exported = prepareTemplateLibraryExport(
      [buildTemplate('tpl-1', 'Payments', ['task-1']), buildTemplate('tpl-2', 'Claims')],
      [buildTask('task-1', 'Business Checkout'), buildTask('task-2', 'Smoke test')],
    );
    expect(exported.code.startsWith(TEMPLATE_LIBRARY_PREFIX)).toBe(true);
    expect(exported).toMatchObject({ templateCount: 2, taskCount: 2, leftOutNames: [] });
    expect(exported.file.fileName).toBe(TEMPLATE_LIBRARY_FILE_NAME);

    const fromCode = decodePayload(exported.code);
    expect(fromCode.templates.map((template) => template.name)).toEqual(['Payments', 'Claims']);
    expect(fromCode.templates[0].ctaskTemplateIds).toEqual(['task-1']);
    expect(fromCode.ctaskTemplates.map((task) => task.name)).toEqual(['Business Checkout', 'Smoke test']);
    expect(decodePayload(await exported.file.blob.text()).templates).toHaveLength(2);
  });

  it('leaves out, and names, a template too damaged to carry, instead of failing the whole export', () => {
    const damaged = { ...buildTemplate('tpl-9', 'Broken'), chgPlanningContent: undefined } as unknown as CrgTemplate;
    const exported = prepareTemplateLibraryExport([buildTemplate('tpl-1', 'Payments'), damaged], []);
    expect(exported.templateCount).toBe(1);
    expect(exported.leftOutNames).toEqual(['Broken']);
  });

  it('is recognised as a whole-library code or file, and nothing else is', () => {
    const exported = prepareTemplateLibraryExport([buildTemplate('tpl-1', 'Payments')], []);
    expect(isTemplateLibraryShareText(exported.code)).toBe(true);
    expect(isTemplateLibraryShareText(JSON.stringify(decodePayload(exported.code)))).toBe(true);
    expect(isTemplateLibraryShareText('SNOWWIZ-TEMPLATE-1:abc')).toBe(false);
    expect(isTemplateLibraryShareText('{"version":1,"template":{}}')).toBe(false);
  });

  it('answers in plain words for a damaged or newer code', () => {
    expect(decodeTemplateLibraryShare(`${TEMPLATE_LIBRARY_PREFIX}not-base64!!`)).toMatchObject({ isValid: false });
    expect(decodeTemplateLibraryShare('SNOWWIZ-LIBRARY-2:abc')).toEqual({ isValid: false, errorMessage: expect.stringMatching(/newer version/) });
  });
});

describe('importSharedLibrary', () => {
  const payload = decodePayload(prepareTemplateLibraryExport(
    [buildTemplate('tpl-1', 'Payments', ['task-1', 'task-2']), buildTemplate('tpl-2', 'Claims', ['task-2'])],
    [buildTask('task-1', 'Business Checkout'), buildTask('task-2', 'Smoke test')],
  ).code);

  it('saves every task and template, relinked to the new task ids, keeping the original order on screen', () => {
    const { sinks, savedTemplates, savedTaskNames } = buildSinks();
    const outcome = importSharedLibrary(payload, sinks);
    // Saved last-first, because each save goes to the top of the list.
    expect(savedTaskNames).toEqual(['Smoke test', 'Business Checkout']);
    expect(savedTemplates).toEqual([
      { name: 'Claims', ctaskTemplateIds: ['new-task-Smoke test'] },
      { name: 'Payments', ctaskTemplateIds: ['new-task-Business Checkout', 'new-task-Smoke test'] },
    ]);
    expect(outcome).toMatchObject({ addedTemplateNames: ['Payments', 'Claims'], addedTaskNames: ['Business Checkout', 'Smoke test'] });
  });

  it('leaves alone a template or task the Wizard already has by that name, linking to the task it already has', () => {
    const { sinks, savedTemplates, savedTaskNames } = buildSinks({
      existingTemplateNames: [' claims '], existingTasks: [{ id: 'wizard-smoke', name: 'SMOKE TEST' }],
    });
    const outcome = importSharedLibrary(payload, sinks);
    expect(savedTaskNames).toEqual(['Business Checkout']);
    expect(savedTemplates).toEqual([{ name: 'Payments', ctaskTemplateIds: ['new-task-Business Checkout', 'wizard-smoke'] }]);
    expect(outcome).toMatchObject({ alreadyThereTemplateNames: ['Claims'], alreadyThereTaskNames: ['Smoke test'] });
  });

  it('saves only as many as there is room for, so no saved template is pushed out, and names the rest', () => {
    const { sinks, savedTemplates } = buildSinks({ templateRoom: 1, taskRoom: 1 });
    const outcome = importSharedLibrary(payload, sinks);
    expect(savedTemplates.map((template) => template.name)).toEqual(['Payments']);
    expect(savedTemplates[0].ctaskTemplateIds).toEqual(['new-task-Business Checkout']);
    expect(outcome).toMatchObject({ noRoomTemplateNames: ['Claims'], noRoomTaskNames: ['Smoke test'] });
  });
});
