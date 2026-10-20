// templateShareFormat.test.ts — Proves a shared template keeps only known, well-formed values and never carries field pins.

import { describe, expect, it } from 'vitest';

import { DAMAGED_TEMPLATE_MESSAGE, TemplateShareFormatError, isPlainObject, readSharedTasks, readSharedTemplate } from './templateShareFormat.ts';

const MINIMAL_TEMPLATE = { name: ' Release ', chgBasicInfo: {}, chgPlanningAssessment: {}, chgPlanningContent: {} };

describe('readSharedTemplate', () => {
  it('fills absent known values with empties and trims the name', () => {
    const template = readSharedTemplate(MINIMAL_TEMPLATE, new Set());
    expect(template.name).toBe('Release');
    expect(template.chgBasicInfo.assignmentGroup).toEqual({ sysId: '', displayName: '' });
    expect(template.chgBasicInfo.isExpedited).toBe(false);
    expect(template.ctaskTemplateIds).toEqual([]);
  });

  it('never carries personal field pins, and drops links to tasks that did not travel', () => {
    const template = readSharedTemplate({ ...MINIMAL_TEMPLATE, customSnowFields: { approval: 'approved' }, ctaskTemplateIds: ['kept', 'gone'] }, new Set(['kept']));
    expect(template).not.toHaveProperty('customSnowFields');
    expect(template.ctaskTemplateIds).toEqual(['kept']);
  });

  it('keeps well-formed environments and refuses a badly formed one', () => {
    const environment = { isEnabled: true, plannedStartDate: '2026-11-01T19:00', configItem: { sysId: 'ci', displayName: 'API' } };
    expect(readSharedTemplate({ ...MINIMAL_TEMPLATE, prdEnvironment: environment }, new Set()).prdEnvironment?.isEnabled).toBe(true);
    expect(() => readSharedTemplate({ ...MINIMAL_TEMPLATE, prdEnvironment: 'PRD' }, new Set())).toThrow(DAMAGED_TEMPLATE_MESSAGE);
  });
});

describe('readSharedTasks', () => {
  it('keeps the optional timings when present and refuses a task without an id', () => {
    const [sharedTask] = readSharedTasks([{ id: 't1', name: 'Checkout', durationEstimates: { implementationMinutes: '30' }, startOffsetMinutes: '15' }]);
    expect(sharedTask.durationEstimates).toEqual({ implementationMinutes: '30', validationMinutes: '', backoutMinutes: '' });
    expect(sharedTask.startOffsetMinutes).toBe('15');
    expect(() => readSharedTasks([{ name: 'No id' }])).toThrow(TemplateShareFormatError);
    expect(readSharedTasks(undefined)).toEqual([]);
  });

  it('keeps only known environments a task goes on, and refuses environments that are not a list of words', () => {
    expect(readSharedTasks([{ id: 't1', name: 'Checkout', environmentKeys: ['PRD', 'MARS', 'REL'] }])[0].environmentKeys).toEqual(['REL', 'PRD']);
    expect(readSharedTasks([{ id: 't1', name: 'Checkout' }])[0]).not.toHaveProperty('environmentKeys');
    expect(() => readSharedTasks([{ id: 't1', name: 'Checkout', environmentKeys: 'PRD' }])).toThrow(TemplateShareFormatError);
  });

  it('refuses something that is not a list', () => {
    expect(() => readSharedTasks({})).toThrow(TemplateShareFormatError);
    expect(isPlainObject([])).toBe(false);
  });
});
