// templateShare.test.ts — Proves a change template travels as a text code or a file, and comes back safely or with a plain reason.

import { describe, expect, it, vi } from 'vitest';

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  TEMPLATE_SHARE_PREFIX, buildTemplateShareFile, decodeTemplateShare, encodeTemplateShareCode, importSharedCtaskTemplates, importSharedTemplate,
  pickUniqueTemplateName,
} from './templateShare.ts';

const REFERENCE = { sysId: 'grp-1', displayName: 'Paiements équipe ✓' };
const BLANK = { sysId: '', displayName: '' };

function buildTemplate(overrides: Partial<CrgTemplate> = {}): CrgTemplate {
  return {
    id: 'tpl-1', name: 'Payments — monthly ✓', createdAt: '2026-10-01T00:00:00.000Z',
    chgBasicInfo: {
      category: 'software', changeType: 'normal', environment: '', requestedBy: BLANK, configItem: REFERENCE, assignmentGroup: REFERENCE,
      assignedTo: BLANK, changeManager: BLANK, tester: BLANK, serviceManager: BLANK, isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '3', systemAvailabilityImplication: '', hasBeenTested: 'yes', impactedPersonsAware: '', hasBeenPerformedPreviously: '',
      successProbability: '', canBeBackedOut: '',
    },
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Roll back', testPlan: '1. Smoke' },
    ctaskTemplateIds: ['ctask-1'],
    ...overrides,
  };
}

function buildCtaskTemplate(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: 'ctask-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: '',
    assignmentGroup: REFERENCE, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'review',
    ...overrides,
  };
}

describe('encodeTemplateShareCode / decodeTemplateShare', () => {
  it('round-trips a template and its linked tasks, accents and symbols included', () => {
    const shareCode = encodeTemplateShareCode(buildTemplate(), [buildCtaskTemplate()]);
    expect(shareCode.startsWith(TEMPLATE_SHARE_PREFIX)).toBe(true);
    expect(shareCode).not.toMatch(/[+/=\s]/);
    const decoded = decodeTemplateShare(`  ${shareCode}\n`);
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    expect(decoded.payload.template.name).toBe('Payments — monthly ✓');
    expect(decoded.payload.template.chgBasicInfo.assignmentGroup.displayName).toBe('Paiements équipe ✓');
    expect(decoded.payload.ctaskTemplates[0].shortDescription).toBe('Business Checkout');
  });

  it('shares only the tasks the template links to', () => {
    const decoded = decodeTemplateShare(encodeTemplateShareCode(buildTemplate(), [buildCtaskTemplate(), buildCtaskTemplate({ id: 'other' })]));
    expect(decoded.isValid && decoded.payload.ctaskTemplates.map((task) => task.id)).toEqual(['ctask-1']);
  });

  it('accepts the downloaded file text too', async () => {
    const shareFile = buildTemplateShareFile(buildTemplate(), [buildCtaskTemplate()]);
    expect(shareFile.fileName).toBe('Payments-monthly.snow-template.json');
    const decoded = decodeTemplateShare(await shareFile.blob.text());
    expect(decoded.isValid && decoded.payload.template.name).toBe('Payments — monthly ✓');
  });

  it('drops anything it does not know about', () => {
    const tampered = { version: 1, template: { ...buildTemplate(), script: '<script>', chgBasicInfo: { ...buildTemplate().chgBasicInfo, extra: 1 } }, ctaskTemplates: [{ ...buildCtaskTemplate(), sourceTemplateId: 'x', evil: true }] };
    const decoded = decodeTemplateShare(JSON.stringify(tampered));
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    expect(decoded.payload.template).not.toHaveProperty('script');
    expect(decoded.payload.template.chgBasicInfo).not.toHaveProperty('extra');
    expect(decoded.payload.ctaskTemplates[0]).not.toHaveProperty('evil');
    expect(decoded.payload.ctaskTemplates[0]).not.toHaveProperty('sourceTemplateId');
  });

  it.each([
    ['', 'Paste a template code first.'],
    ['hello there', 'That is not a template code'],
    [`${TEMPLATE_SHARE_PREFIX}@@@`, 'damaged'],
    ['SNOWWIZ-TEMPLATE-9:abc', 'newer version'],
    ['{"version":2,"template":{}}', 'newer version'],
    ['{"version":1}', 'no template'],
    ['{"version":1,"template":{"name":"x"},"ctaskTemplates":[]}', 'missing'],
    ['{"version":1,"template":{"name":5},"ctaskTemplates":[]}', 'name'],
    ['{not json', 'damaged'],
  ])('explains %j in plain words, never throwing', (text, expectedFragment) => {
    const decoded = decodeTemplateShare(text);
    expect(decoded.isValid).toBe(false);
    expect(!decoded.isValid && decoded.errorMessage).toContain(expectedFragment);
  });

  it('refuses a value of the wrong kind inside a known field', () => {
    const wrongKind = { version: 1, template: { ...buildTemplate(), chgBasicInfo: { ...buildTemplate().chgBasicInfo, isExpedited: 'yes' } }, ctaskTemplates: [] };
    const decoded = decodeTemplateShare(JSON.stringify(wrongKind));
    expect(!decoded.isValid && decoded.errorMessage).toContain('damaged');
  });
});

describe('pickUniqueTemplateName', () => {
  it('keeps a free name and numbers clashes', () => {
    expect(pickUniqueTemplateName('Release', ['Other'])).toBe('Release');
    expect(pickUniqueTemplateName('Release', ['release '])).toBe('Release (shared)');
    expect(pickUniqueTemplateName('Release', ['Release', 'Release (shared)'])).toBe('Release (shared 2)');
  });
});

describe('importSharedTemplate', () => {
  it('saves every task under a new id and links the template to those new ids', () => {
    const decoded = decodeTemplateShare(encodeTemplateShareCode(buildTemplate(), [buildCtaskTemplate()]));
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    const saveCtaskTemplate = vi.fn(() => 'new-ctask-1');
    const saveCrgTemplate = vi.fn(() => 'new-tpl-1');
    const imported = importSharedTemplate(decoded.payload, { existingTemplateNames: ['Payments — monthly ✓'], saveCrgTemplate, saveCtaskTemplate });
    expect(imported).toEqual({ templateId: 'new-tpl-1', templateName: 'Payments — monthly ✓ (shared)' });
    expect(saveCtaskTemplate).toHaveBeenCalledWith('Business Checkout', expect.not.objectContaining({ id: expect.anything() }));
    expect(saveCrgTemplate).toHaveBeenCalledWith('Payments — monthly ✓ (shared)', expect.objectContaining({ ctaskTemplateIds: ['new-ctask-1'] }));
  });
});

describe('importSharedCtaskTemplates', () => {
  it('saves each task as the user’s own, renaming clashes — including clashes inside the same code', () => {
    const saveCtaskTemplate = vi.fn(() => 'new-id');
    const savedNames = importSharedCtaskTemplates(
      [buildCtaskTemplate(), buildCtaskTemplate({ id: 'ctask-2' }), buildCtaskTemplate({ id: 'ctask-3', name: 'Smoke test' })],
      { existingTaskNames: ['Business Checkout'], saveCtaskTemplate },
    );
    expect(savedNames).toEqual(['Business Checkout (shared)', 'Business Checkout (shared 2)', 'Smoke test']);
    expect(saveCtaskTemplate).toHaveBeenCalledWith('Smoke test', expect.not.objectContaining({ id: expect.anything() }));
  });
});
