// TemplatesScreen.test.tsx — Proves "Your templates" lists, shares, downloads, deletes (asked first) and imports templates.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeCtaskTemplatesShareCode } from '../../views/SnowHub/ctaskTemplateShare.ts';
import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import TemplatesScreen from './TemplatesScreen.tsx';
import { prepareTemplateLibraryExport } from './templateLibraryShare.ts';
import { TEMPLATE_SHARE_PREFIX, encodeTemplateShareCode } from './templateShare.ts';
import { useTemplateLibrary } from './useTemplateLibrary.ts';

const BLANK = { sysId: '', displayName: '' };
const TASK = { id: 'ctask-1', name: 'Checkout', createdAt: '', shortDescription: 'Checkout', description: '', assignmentGroup: BLANK, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '' } as CtaskTemplate;
const TEMPLATE = {
  id: 'tpl-1', name: 'Monthly', createdAt: '2026-10-01T00:00:00.000Z', chgBasicInfo: {}, chgPlanningAssessment: {}, chgPlanningContent: {}, ctaskTemplateIds: ['ctask-1'],
} as unknown as CrgTemplate;

/** The screen with one library, the way the change job's landing uses it. */
function Harness({ onUseTemplate = vi.fn() }: { onUseTemplate?: (templateId: string) => void }) {
  return <TemplatesScreen library={useTemplateLibrary()} onUseTemplate={onUseTemplate} onBack={vi.fn()} />;
}

describe('TemplatesScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ntbx-crg-templates', JSON.stringify([TEMPLATE]));
    localStorage.setItem('ntbx-ctask-templates', JSON.stringify([TASK]));
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists each template and starts a change from one', () => {
    const onUseTemplate = vi.fn();
    render(<Harness onUseTemplate={onUseTemplate} />);
    expect(screen.getByRole('heading', { name: 'Monthly' })).toBeTruthy();
    expect(screen.getByText(/1 task/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open it in a new change' }));
    expect(onUseTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('shows a code to copy when sharing', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect((screen.getByLabelText('Template code for “Monthly”') as HTMLTextAreaElement).value.startsWith(TEMPLATE_SHARE_PREFIX)).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy the code' })).toBeTruthy();
  });

  it('downloads the template as a file', () => {
    const createObjectURL = vi.fn(() => 'blob:template');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect((clickSpy.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('Monthly.snow-template.json');
  });

  it('asks on the page before deleting, and can keep it', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('heading', { name: 'Monthly' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    expect(screen.queryByRole('heading', { name: 'Monthly' })).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('adds a pasted template code, renamed when the name is taken', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Paste a template code'), { target: { value: encodeTemplateShareCode(TEMPLATE, [TASK]) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this template' }));
    expect(screen.getByRole('status').textContent).toContain('Added “Monthly (shared)”');
    expect(screen.getByRole('heading', { name: 'Monthly (shared)' })).toBeTruthy();
  });

  it('explains a bad code in plain words', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Paste a template code'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this template' }));
    expect(screen.getByText(/That is not a template code/)).toBeTruthy();
  });

  it('adds a template from a chosen file', async () => {
    render(<Harness />);
    const sharedFile = new File([encodeTemplateShareCode({ ...TEMPLATE, name: 'Hotfix' }, [TASK])], 'Hotfix.snow-template.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Or choose a template file'), { target: { files: [sharedFile] } });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hotfix' })).toBeTruthy());
  });

  it('adds the tasks from a task code copied in Toolbox, renaming a clash', () => {
    render(<Harness />);
    const toolboxCode = encodeCtaskTemplatesShareCode([TASK, { ...TASK, id: 'ctask-2', name: 'Deploy', shortDescription: 'Deploy' }]);
    fireEvent.change(screen.getByLabelText('Paste a template code'), { target: { value: toolboxCode } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this template' }));
    expect(screen.getByRole('status').textContent).toBe('Added “Checkout (shared)” and “Deploy” to your saved tasks ✓');
    expect(screen.getByRole('heading', { name: 'Deploy' })).toBeTruthy();
  });

  it('adds every template from the Toolbox "export all" file, leaving alone the ones it already has', async () => {
    render(<Harness />);
    const toolboxTask = { ...TASK, id: 'toolbox-task-9', name: 'Deploy', shortDescription: 'Deploy' };
    const exported = prepareTemplateLibraryExport(
      [{ ...TEMPLATE, id: 'toolbox-1', name: 'Hotfix', ctaskTemplateIds: ['toolbox-task-9'] }, { ...TEMPLATE, id: 'toolbox-2' }],
      [toolboxTask, { ...TASK, id: 'toolbox-task-8' }],
    );
    const exportFile = new File([await exported.file.blob.text()], exported.file.fileName, { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Or choose a template file'), { target: { files: [exportFile] } });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hotfix' })).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(
      'Added 1 change template and 1 task template ✓ Already in the Wizard, so left as they are: “Monthly”, “Checkout”. '
      + "Delete one here first to bring Toolbox's copy in.",
    );
  });

  it('explains a damaged task code in plain words', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Paste a template code'), { target: { value: 'SNOWWIZ-CTASKS-1:@@@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this template' }));
    expect(screen.getByRole('alert').textContent).toMatch(/damaged/);
  });

  it('says what to do when there are no templates yet', () => {
    localStorage.clear();
    render(<Harness />);
    expect(screen.getByText(/no templates in this Wizard yet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/u_[a-z]|cmdb_ci|customfield_|sys_id/);
  });
});
