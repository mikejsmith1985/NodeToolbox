// DetailsStep.test.tsx — Proves Details writes the draft, picks category and type from ServiceNow's lists, and hides field names.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { readDetailsGaps } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import DetailsStep from './DetailsStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));

const CHOICES = { category: [{ value: 'software', label: 'Software' }], type: [{ value: 'normal', label: 'Normal' }] };

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestGaps: [] as string[], latestTaskNames: [] as string[], updateSession: vi.fn() };

function Harness() {
  const crg = useCrgState({ storageKey: 'snowWizard:change:details-test' });
  useEffect(() => {
    observed.latestGaps = readDetailsGaps(crg.state);
    observed.latestTaskNames = crg.state.changeTasks.map((task) => task.shortDescription);
  });
  return <DetailsStep crg={crg} session={createChangeWizardSession('create')} updateSession={observed.updateSession} goToStep={vi.fn()} choiceOptions={CHOICES} />;
}

describe('DetailsStep', () => {
  it('writes the title, category and type into the draft', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Title (needed)'), { target: { value: 'Payments 1.2' } });
    fireEvent.change(screen.getByLabelText('Category (needed)'), { target: { value: 'software' } });
    fireEvent.change(screen.getByLabelText('Change type (needed)'), { target: { value: 'normal' } });
    expect(observed.latestGaps).toEqual(['an assignment group', 'an owner', 'a configuration item']);
  });

  it('opens More options while a text there is empty, and shows no internal field names', () => {
    render(<Harness />);
    expect((screen.getByText('More options').closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(document.body.textContent).not.toMatch(/u_[a-z]|cmdb_ci|customfield_|sys_id/);
  });

  it('opens a saved template with its linked tasks staged, says so, and links the job to it', () => {
    const blank = { sysId: '', displayName: '' };
    localStorage.setItem('ntbx-ctask-templates', JSON.stringify([{ id: 'ctask-1', name: 'Checkout', createdAt: '', shortDescription: 'Checkout', description: '', assignmentGroup: blank, assignedTo: blank, plannedStartDate: '', plannedEndDate: '', closeNotes: '' }]));
    localStorage.setItem('ntbx-crg-templates', JSON.stringify([{ id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: { category: 'software', changeType: '', environment: '', requestedBy: blank, configItem: blank, assignmentGroup: blank, assignedTo: blank, changeManager: blank, tester: blank, serviceManager: blank, isExpedited: false }, chgPlanningAssessment: {}, chgPlanningContent: {}, ctaskTemplateIds: ['ctask-1'] }]));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Open a saved template (optional)'), { target: { value: 'tpl-1' } });
    expect(observed.latestTaskNames).toEqual(['Checkout']);
    expect(screen.getByRole('status').textContent).toBe('✓ Opened template “Monthly” — its values are filled in below.');
    expect(observed.updateSession).toHaveBeenCalledWith({ linkedTemplate: { id: 'tpl-1', name: 'Monthly' } });
    localStorage.clear();
  });
});
