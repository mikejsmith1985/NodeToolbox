// TemplateLibraryExport.test.tsx — Proves Toolbox exports every CHG and CTASK template in one file or code, says how
// many went, and that the Wizard reads it back.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeTemplateLibraryShare } from '../../../snowWizard/change/templateLibraryShare.ts';
import { downloadShareFile } from '../ctaskTemplateShare.ts';
import type { CrgTemplate, CtaskTemplate } from '../hooks/useCrgState.ts';
import { TemplateLibraryExport } from './TemplateLibraryExport.tsx';

vi.mock('../ctaskTemplateShare.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ctaskTemplateShare.ts')>()),
  downloadShareFile: vi.fn(),
}));

const BLANK = { sysId: '', displayName: '' };
const TASK = { id: 'task-1', name: 'Checkout', createdAt: '', shortDescription: 'Checkout', description: '', assignmentGroup: BLANK, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '' } as CtaskTemplate;
const TEMPLATE = {
  id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: {}, chgPlanningAssessment: {}, chgPlanningContent: {}, ctaskTemplateIds: ['task-1'],
} as unknown as CrgTemplate;

describe('TemplateLibraryExport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads every template in one file and says how many went', () => {
    render(<TemplateLibraryExport templates={[TEMPLATE, { ...TEMPLATE, id: 'tpl-2', name: 'Hotfix' }]} ctaskTemplates={[TASK]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download all templates' }));
    expect(downloadShareFile).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'all-templates.snow-library.json' }));
    expect(screen.getByRole('status').textContent).toMatch(/2 CHG templates and 1 CTASK template/);
  });

  it('copies one code the Wizard can read, links included', async () => {
    const writeText = vi.fn(async (_copiedText: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TemplateLibraryExport templates={[TEMPLATE]} ctaskTemplates={[TASK]} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy all as a code' })); });
    const decoded = decodeTemplateLibraryShare(writeText.mock.calls[0][0]);
    expect(decoded.isValid && decoded.payload.templates[0].ctaskTemplateIds).toEqual(['task-1']);
    expect(screen.getByRole('status').textContent).toMatch(/copied/);
  });

  it('shows nothing when there is nothing to export', () => {
    const { container } = render(<TemplateLibraryExport templates={[]} ctaskTemplates={[]} />);
    expect(container.textContent).toBe('');
  });
});
