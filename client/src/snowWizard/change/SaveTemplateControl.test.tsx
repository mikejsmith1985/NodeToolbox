// SaveTemplateControl.test.tsx — Proves saving a template is never a guess: "Update “X”" asks once and updates that
// template (no duplicate), "Save as a new template" asks for a name and never overwrites by surprise, and every outcome
// — saved (checked against the stored list), cancelled, or a clash — is said plainly.

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SaveTemplateControl, { type LinkedTemplate } from './SaveTemplateControl.tsx';
import { useTemplateLibrary, type TemplateDraft } from './useTemplateLibrary.ts';

const BLANK = { sysId: '', displayName: '' };
const TASK = { id: 'task-1', name: 'Deploy', createdAt: '', shortDescription: 'Deploy', description: '', assignmentGroup: BLANK, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '' };
const DRAFT = {
  chgBasicInfo: { category: 'software', assignmentGroup: BLANK },
  chgPlanningAssessment: {},
  chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '', testPlan: '' },
  changeTasks: [TASK],
} as unknown as TemplateDraft;
const TEMPLATES_KEY = 'ntbx-crg-templates';
const MONTHLY = { id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: {}, chgPlanningAssessment: {}, chgPlanningContent: {}, ctaskTemplateIds: [] };

function readSaved(): Array<{ id: string; name: string; ctaskTemplateIds: string[] }> {
  return JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]') as Array<{ id: string; name: string; ctaskTemplateIds: string[] }>;
}

/** The control with one library and the job's linked template, the way the change job hands them over. */
function Harness({ initialLink = null, onLink = vi.fn() }: { initialLink?: LinkedTemplate | null; onLink?: (template: LinkedTemplate) => void }) {
  const [linkedTemplate, setLinkedTemplate] = useState<LinkedTemplate | null>(initialLink);
  return <SaveTemplateControl draft={DRAFT} library={useTemplateLibrary()} linkedTemplate={linkedTemplate} onLinkTemplate={(template) => { setLinkedTemplate(template); onLink(template); }} />;
}

/** Saves under a new name through the form. */
function saveNewAs(templateName: string, buttonName = 'Save as template') {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  fireEvent.change(screen.getByLabelText('Name the new template'), { target: { value: templateName } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new template' }));
}

describe('SaveTemplateControl', () => {
  beforeEach(() => localStorage.clear());

  it('saves a new template, checks it is really stored, says so with what it holds, and links the job to it', async () => {
    const onLink = vi.fn();
    render(<Harness onLink={onLink} />);
    saveNewAs('Payments release');
    expect(await screen.findByText(/^✓ Saved new template “Payments release” at .+ — details, plan, environments and 1 task\.$/)).toBeTruthy();
    expect(readSaved().map((template) => template.name)).toEqual(['Payments release']);
    expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ name: 'Payments release' }));
    // Linked now: the next save offers to update it, not to make another.
    expect(screen.getByRole('button', { name: 'Update template “Payments release”' })).toBeTruthy();
  });

  it('updates the template the job was opened from — asked once, no duplicate made', async () => {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([MONTHLY]));
    render(<Harness initialLink={{ id: 'tpl-1', name: 'Monthly' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template “Monthly”' }));
    expect(screen.getByRole('alertdialog', { name: 'Update Monthly?' }).textContent).toContain('replaced by this change’s (1 task)');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, update “Monthly”' }));
    expect(await screen.findByText(/^✓ Updated “Monthly” at /)).toBeTruthy();
    expect(readSaved()).toHaveLength(1);
    expect(readSaved()[0].ctaskTemplateIds).toHaveLength(1);
  });

  it('says plainly that nothing was saved when the user cancels', () => {
    render(<Harness initialLink={{ id: 'tpl-1', name: 'Monthly' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template “Monthly”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('status').textContent).toBe('Nothing was saved.');
  });

  it('will not save a new template without a name', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect((screen.getByRole('button', { name: 'Save new template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks instead of duplicating when the new name is taken, and can update that template or take another name', async () => {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([MONTHLY]));
    render(<Harness />);
    saveNewAs('monthly');
    expect(screen.getByRole('alertdialog', { name: 'Name already used' }).textContent).toContain('Nothing was saved yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Use another name' }));
    expect(screen.getByLabelText('Name the new template')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name the new template'), { target: { value: 'Monthly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update “Monthly”' }));
    expect(await screen.findByText(/^✓ Updated “Monthly”/)).toBeTruthy();
    expect(readSaved()).toHaveLength(1);
  });
});
