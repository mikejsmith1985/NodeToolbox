// ctaskTemplateShare.test.ts — Proves every CTASK template travels as one code or file, and comes back safely or with a plain reason.

import { describe, expect, it, vi } from 'vitest';

import {
  CTASK_SHARE_FILE_NAME, CTASK_SHARE_PREFIX, buildCtaskTemplatesShareFile, decodeBase64Url, decodeCtaskTemplatesShare, downloadShareFile, encodeBase64Url,
  encodeCtaskTemplatesShareCode, isCtaskTemplatesShareText,
} from './ctaskTemplateShare.ts';
import type { CtaskTemplate } from './hooks/useCrgState.ts';

const GROUP = { sysId: 'grp-1', displayName: 'Équipe paiements ✓' };
const BLANK = { sysId: '', displayName: '' };

function buildTask(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: 'task-1', name: 'Smoke test — prod ✓', createdAt: '2026-10-01T00:00:00.000Z', shortDescription: 'Smoke test', description: 'Run it',
    assignmentGroup: GROUP, assignedTo: { sysId: 'usr-1', displayName: 'Pat' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '',
    changeTaskType: 'testing', startOffsetMinutes: '15', environmentKeys: ['PRD'],
    ...overrides,
  };
}

describe('encodeCtaskTemplatesShareCode / decodeCtaskTemplatesShare', () => {
  it('round-trips every template with its type, group, assignee and environments, accents included', () => {
    const shareCode = encodeCtaskTemplatesShareCode([buildTask(), buildTask({ id: 'task-2', name: 'Deploy', assignedTo: BLANK })]);
    expect(shareCode.startsWith(CTASK_SHARE_PREFIX)).toBe(true);
    expect(shareCode).not.toMatch(/[+/=\s]/);
    const decoded = decodeCtaskTemplatesShare(`  ${shareCode}\n`);
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    expect(decoded.ctaskTemplates).toHaveLength(2);
    expect(decoded.ctaskTemplates[0]).toMatchObject({
      name: 'Smoke test — prod ✓', changeTaskType: 'testing', assignmentGroup: GROUP, assignedTo: { sysId: 'usr-1', displayName: 'Pat' }, environmentKeys: ['PRD'],
    });
  });

  it('accepts the downloaded file text too', async () => {
    const shareFile = buildCtaskTemplatesShareFile([buildTask()]);
    expect(shareFile.fileName).toBe(CTASK_SHARE_FILE_NAME);
    const decoded = decodeCtaskTemplatesShare(await shareFile.blob.text());
    expect(decoded.isValid && decoded.ctaskTemplates[0].shortDescription).toBe('Smoke test');
  });

  it('drops anything it does not know about, so no raw field pins travel', () => {
    const tampered = { version: 1, ctaskTemplates: [{ ...buildTask(), customSnowFields: { approval: 'approved' }, sourceTemplateId: 'x' }] };
    const decoded = decodeCtaskTemplatesShare(JSON.stringify(tampered));
    if (!decoded.isValid) throw new Error(decoded.errorMessage);
    expect(decoded.ctaskTemplates[0]).not.toHaveProperty('customSnowFields');
    expect(decoded.ctaskTemplates[0]).not.toHaveProperty('sourceTemplateId');
  });

  it('gives an unnamed template a name instead of refusing to share it', () => {
    const decoded = decodeCtaskTemplatesShare(encodeCtaskTemplatesShareCode([buildTask({ name: ' ' })]));
    expect(decoded.isValid && decoded.ctaskTemplates[0].name).toBe('Smoke test');
  });

  it.each([
    ['', 'Paste a task code first.'],
    ['hello there', 'That is not a task code'],
    [`${CTASK_SHARE_PREFIX}@@@`, 'damaged'],
    ['SNOWWIZ-CTASKS-9:abc', 'newer version'],
    ['{"version":2,"ctaskTemplates":[]}', 'newer version'],
    ['{"version":1,"ctaskTemplates":[]}', 'no tasks'],
    ['{"version":1,"ctaskTemplates":{}}', 'damaged'],
    ['{"version":1,"ctaskTemplates":[{"id":"a","name":"x","assignedTo":"Pat"}]}', 'damaged'],
    ['{not json', 'damaged'],
  ])('explains %j in plain words, never throwing', (text, expectedFragment) => {
    const decoded = decodeCtaskTemplatesShare(text);
    expect(decoded.isValid).toBe(false);
    expect(!decoded.isValid && decoded.errorMessage).toContain(expectedFragment);
  });
});

describe('isCtaskTemplatesShareText', () => {
  it('tells a task code from a change template code', () => {
    expect(isCtaskTemplatesShareText(encodeCtaskTemplatesShareCode([buildTask()]))).toBe(true);
    expect(isCtaskTemplatesShareText('{"version":1,"ctaskTemplates":[]}')).toBe(true);
    expect(isCtaskTemplatesShareText('{"version":1,"template":{},"ctaskTemplates":[]}')).toBe(false);
    expect(isCtaskTemplatesShareText('SNOWWIZ-TEMPLATE-1:abc')).toBe(false);
    expect(isCtaskTemplatesShareText('{broken')).toBe(false);
  });
});

describe('encodeBase64Url / decodeBase64Url', () => {
  it('round-trips text with accents and symbols', () => {
    expect(decodeBase64Url(encodeBase64Url('Équipe ✓ — ok?'))).toBe('Équipe ✓ — ok?');
  });
});

describe('downloadShareFile', () => {
  it('starts a browser download under the file’s own name', () => {
    const createObjectURL = vi.fn(() => 'blob:tasks');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadShareFile(buildCtaskTemplatesShareFile([buildTask()]));
    expect(createObjectURL).toHaveBeenCalled();
    expect((clickSpy.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(CTASK_SHARE_FILE_NAME);
    clickSpy.mockRestore();
  });
});
