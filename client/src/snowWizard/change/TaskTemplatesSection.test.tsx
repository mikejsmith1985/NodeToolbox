// TaskTemplatesSection.test.tsx — Proves saved tasks are listed and can be shared as a code, downloaded, and deleted (asked first).

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CTASK_SHARE_FILE_NAME, CTASK_SHARE_PREFIX, decodeCtaskTemplatesShare } from '../../views/SnowHub/ctaskTemplateShare.ts';
import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import TaskTemplatesSection from './TaskTemplatesSection.tsx';
import { useTemplateLibrary } from './useTemplateLibrary.ts';

const BLANK = { sysId: '', displayName: '' };
const SAVED_TASK: CtaskTemplate = {
  id: 'task-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: '', assignmentGroup: BLANK,
  assignedTo: { sysId: 'usr-1', displayName: 'Pat' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'review', environmentKeys: ['PRD'],
};

function Harness() {
  return <TaskTemplatesSection library={useTemplateLibrary()} />;
}

describe('TaskTemplatesSection', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ntbx-ctask-templates', JSON.stringify([SAVED_TASK]));
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists each saved task with who does it and where it goes', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Business Checkout' })).toBeTruthy();
    expect(screen.getByText('Assigned to Pat · goes on PRD')).toBeTruthy();
  });

  it('shows a task code to copy', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Share Business Checkout' }));
    const shareCode = (screen.getByLabelText('Task code for “Business Checkout”') as HTMLTextAreaElement).value;
    expect(shareCode.startsWith(CTASK_SHARE_PREFIX)).toBe(true);
    const decoded = decodeCtaskTemplatesShare(shareCode);
    expect(decoded.isValid && decoded.ctaskTemplates[0].name).toBe('Business Checkout');
  });

  it('downloads the task as a file', () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:task'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Download Business Checkout' }));
    expect((clickSpy.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(CTASK_SHARE_FILE_NAME);
  });

  it('asks on the page before deleting, and can keep it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Business Checkout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('heading', { name: 'Business Checkout' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Business Checkout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    expect(screen.queryByRole('heading', { name: 'Business Checkout' })).toBeNull();
    expect(screen.getByText('You have no saved tasks yet.')).toBeTruthy();
  });
});
