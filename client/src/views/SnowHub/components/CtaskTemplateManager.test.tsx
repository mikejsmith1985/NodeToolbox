// CtaskTemplateManager.test.tsx — The CTASK template manager: one list of saved templates beside one editor.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CTASK_SHARE_FILE_NAME, CTASK_SHARE_PREFIX, decodeCtaskTemplatesShare } from '../ctaskTemplateShare.ts';
import type { CtaskTemplate } from '../hooks/useCrgState.ts';
import { CtaskTemplateManager, type CtaskTemplateManagerProps } from './CtaskTemplateManager.tsx';

vi.mock('../hooks/useChangeTaskTypeOptions.ts', () => ({
  useChangeTaskTypeOptions: () => ({
    typeOptions: [{ value: 'implementation', label: 'Implementation' }, { value: 'testing', label: 'Testing' }],
    isLoading: false,
    loadErrorMessage: null,
  }),
}));

const SAVED_TEMPLATE: CtaskTemplate = {
  id: 'template-1',
  name: 'Deploy Validation',
  createdAt: '2026-01-01T00:00:00.000Z',
  shortDescription: 'Validate production deployment',
  description: 'Run the smoke tests.',
  assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
  assignedTo: { sysId: '', displayName: '' },
  plannedStartDate: '',
  plannedEndDate: '',
  closeNotes: '',
  changeTaskType: 'testing',
  startOffsetMinutes: '30',
  durationMinutes: '60',
};

function renderManager(overrides: Partial<CtaskTemplateManagerProps> = {}) {
  const props: CtaskTemplateManagerProps = {
    templates: [SAVED_TEMPLATE],
    onCreateTemplate: vi.fn(() => 'template-new'),
    onUpdateTemplate: vi.fn(),
    onDuplicateTemplate: vi.fn(() => 'template-copy'),
    onDeleteTemplate: vi.fn(),
    onAddToChange: vi.fn(),
    onCloneCtask: vi.fn(),
    ...overrides,
  };
  render(<CtaskTemplateManager {...props} />);
  return { props, user: userEvent.setup() };
}

describe('CtaskTemplateManager', () => {
  it('lists every saved template with its type, group and timing', () => {
    renderManager();

    const templateButton = screen.getByRole('button', { name: /Deploy Validation/ });
    expect(templateButton).toHaveTextContent('Testing · Platform Team');
    expect(templateButton).toHaveTextContent('Starts 30 minutes after the change starts · runs 1 hour');
  });

  it('says plainly when there are no templates yet', () => {
    renderManager({ templates: [] });

    expect(screen.getByText(/No CTASK templates yet/)).toBeInTheDocument();
  });

  it('opens a template in the editor, marks unsaved edits, and saves a rename with the edits', async () => {
    const { props, user } = renderManager();

    await user.click(screen.getByRole('button', { name: /Deploy Validation/ }));
    expect(screen.getByRole('textbox', { name: 'CTASK template name' })).toHaveValue('Deploy Validation');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.clear(screen.getByRole('textbox', { name: 'CTASK template name' }));
    await user.type(screen.getByRole('textbox', { name: 'CTASK template name' }), 'Smoke Test');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(props.onUpdateTemplate).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ shortDescription: 'Validate production deployment', startOffsetMinutes: '30', durationMinutes: '60' }),
      'Smoke Test',
    );
  });

  it('edits timing as minutes after the change starts, not as fixed dates', async () => {
    const { user } = renderManager();

    await user.click(screen.getByRole('button', { name: /Deploy Validation/ }));

    expect(screen.getByRole('spinbutton', { name: /Starts \(minutes after the change starts\)/ })).toHaveValue(30);
    expect(screen.getByRole('spinbutton', { name: /Runs for \(minutes\)/ })).toHaveValue(60);
    expect(screen.queryByLabelText('CTASK planned start date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Load CTASK template')).not.toBeInTheDocument();
  });

  it('creates a new template with its timing and no fixed dates, then keeps it open', async () => {
    const { props, user } = renderManager();

    await user.click(screen.getByRole('button', { name: '+ New CTASK template' }));
    await user.type(screen.getByRole('textbox', { name: 'CTASK template name' }), 'Backout');
    await user.type(screen.getByRole('textbox', { name: 'CTASK short description' }), 'Run the backout');
    await user.type(screen.getByRole('spinbutton', { name: /Starts \(minutes after the change starts\)/ }), '15');
    await user.click(screen.getByRole('button', { name: 'Save CTASK Template' }));

    expect(props.onCreateTemplate).toHaveBeenCalledWith(
      'Backout',
      expect.objectContaining({ shortDescription: 'Run the backout', startOffsetMinutes: '15', plannedStartDate: '', plannedEndDate: '' }),
    );
  });

  it('will not save a new template without a name, and says why', async () => {
    const { props, user } = renderManager();

    await user.click(screen.getByRole('button', { name: '+ New CTASK template' }));

    expect(screen.getByRole('button', { name: 'Save CTASK Template' })).toBeDisabled();
    expect(screen.getByText('Give the template a name to save it.')).toBeInTheDocument();
    expect(props.onCreateTemplate).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting a template', async () => {
    const { props, user } = renderManager();

    await user.click(screen.getByRole('button', { name: /Deploy Validation/ }));
    await user.click(screen.getByRole('button', { name: 'Delete template' }));
    expect(props.onDeleteTemplate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(props.onDeleteTemplate).toHaveBeenCalledWith('template-1');
  });

  it('duplicates a template and adds the saved template to the change', async () => {
    const { props, user } = renderManager();

    await user.click(screen.getByRole('button', { name: /Deploy Validation/ }));
    await user.click(screen.getByRole('button', { name: 'Add to this change' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));

    expect(props.onAddToChange).toHaveBeenCalledWith(SAVED_TEMPLATE);
    expect(props.onDuplicateTemplate).toHaveBeenCalledWith('template-1');
  });

  it('loads an existing CTASK into a new, unsaved template', async () => {
    const onCloneCtask = vi.fn(async () => ({ ...SAVED_TEMPLATE, shortDescription: 'Cloned task' }));
    const { user } = renderManager({ onCloneCtask });

    await user.type(screen.getByRole('textbox', { name: 'Existing CTASK for template clone' }), 'ctask0001234');
    await user.click(screen.getByRole('button', { name: 'Load CTASK as Template' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('CTASK0001234 loaded into the CTASK template editor.');
    });
    expect(onCloneCtask).toHaveBeenCalledWith('CTASK0001234');
    expect(screen.getByRole('textbox', { name: 'CTASK template name' })).toHaveValue('Cloned task');
    expect(screen.getByRole('button', { name: 'Save CTASK Template' })).toBeEnabled();
  });
});

describe('CtaskTemplateManager — sharing every template with the SNow Wizard', () => {
  it('copies one code holding every template', async () => {
    const { user } = renderManager();
    // user-event installs its own clipboard on setup, so the test's own goes in after it.
    const writeText = vi.fn(async (_copiedText: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await user.click(screen.getByRole('button', { name: 'Share all' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Code for all 1 templates copied'));
    const copiedCode = writeText.mock.calls[0]?.[0] ?? '';
    expect(copiedCode.startsWith(CTASK_SHARE_PREFIX)).toBe(true);
    const decoded = decodeCtaskTemplatesShare(copiedCode);
    expect(decoded.isValid && decoded.ctaskTemplates.map((template) => template.name)).toEqual(['Deploy Validation']);
  });

  it('shows the code to copy by hand when the clipboard refuses', async () => {
    const { user } = renderManager();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });

    await user.click(screen.getByRole('button', { name: 'Share all' }));

    const codeBox = await screen.findByRole('textbox', { name: /Copy this code/ });
    expect((codeBox as HTMLTextAreaElement).value.startsWith(CTASK_SHARE_PREFIX)).toBe(true);
  });

  it('downloads every template as one file', async () => {
    const createObjectURL = vi.fn(() => 'blob:tasks');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { user } = renderManager();

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect((clickSpy.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(CTASK_SHARE_FILE_NAME);
    expect(screen.getByRole('status')).toHaveTextContent('File downloaded');
    clickSpy.mockRestore();
  });

  it('offers no sharing when there is nothing to share', () => {
    renderManager({ templates: [] });
    expect(screen.queryByRole('button', { name: 'Share all' })).toBeNull();
  });
});
