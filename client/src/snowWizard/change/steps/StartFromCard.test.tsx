// StartFromCard.test.tsx — Proves "Start from (optional)" opens a template's picks only (and links the job to it), copies
// the picks from a change raised before without its writing, and says plainly what it did.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import StartFromCard from './StartFromCard.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../../views/SnowHub/myOpenChanges.ts', () => ({ fetchMyOpenChanges: vi.fn(async () => [{ changeNumber: 'CHG0001234', shortDescription: 'Old title' }]) }));

const BLANK = { sysId: '', displayName: '' };
const BASIC_INFO = { category: 'hardware', changeType: 'normal', environment: '', requestedBy: BLANK, configItem: BLANK, assignmentGroup: BLANK, assignedTo: BLANK, changeManager: BLANK, tester: BLANK, serviceManager: BLANK, isExpedited: false };

/** What the card's draft last held, written after each render. */
const observed = { category: '', implementationPlan: '', shortDescription: '' };

function Harness({ updateSession = vi.fn() }: { updateSession?: (update: object) => void }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:start-from-test' });
  useEffect(() => {
    observed.category = crg.state.chgBasicInfo.category;
    observed.implementationPlan = crg.state.chgPlanningContent.implementationPlan;
    observed.shortDescription = crg.state.generatedShortDescription;
  });
  return <StartFromCard crg={crg} updateSession={updateSession} />;
}

describe('StartFromCard', () => {
  beforeEach(() => localStorage.clear());

  it('opens a template’s picks only, links the job to it, and says so', () => {
    localStorage.setItem('ntbx-crg-templates', JSON.stringify([{ id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: BASIC_INFO, chgPlanningAssessment: {}, chgPlanningContent: { implementationPlan: 'OLD plan', backoutPlan: '', testPlan: '' }, ctaskTemplateIds: [] }]));
    const updateSession = vi.fn();
    render(<Harness updateSession={updateSession} />);
    fireEvent.change(screen.getByLabelText('Open a saved template'), { target: { value: 'tpl-1' } });
    expect(observed.category).toBe('hardware');
    expect(observed.implementationPlan).toBe('');
    expect(updateSession).toHaveBeenCalledWith({ linkedTemplate: { id: 'tpl-1', name: 'Monthly' } });
    expect(screen.getByRole('status').textContent).toBe('✓ Opened template “Monthly” — its picks are filled in on the next steps.');
  });

  it('copies the picks from a change raised before, leaving its writing out', async () => {
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request')
      ? { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, short_description: { value: 'Old title', display_value: 'Old title' }, category: { value: 'software', display_value: 'Software' }, implementation_plan: { value: 'Old plan', display_value: 'Old plan' } }] }
      : { result: [] }) as never);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Or copy the picks from a change you raised before'), { target: { value: 'chg0001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy its picks' }));
    expect(await screen.findByText(/^✓ Copied the picks from CHG0001234/)).toBeTruthy();
    await waitFor(() => expect(observed.category).toBe('software'));
    expect(observed.shortDescription).toBe('');
    expect(observed.implementationPlan).toBe('');
  });

  it('copies the picks as soon as one of my open changes is picked', async () => {
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request')
      ? { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, category: { value: 'software', display_value: 'Software' } }] }
      : { result: [] }) as never);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Load my open changes' }));
    fireEvent.change(await screen.findByLabelText('Or pick one of my open changes'), { target: { value: 'CHG0001234' } });
    expect(await screen.findByText(/^✓ Copied the picks from CHG0001234/)).toBeTruthy();
    await waitFor(() => expect(observed.category).toBe('software'));
  });

  it('says where templates come from when there are none yet', () => {
    render(<Harness />);
    expect(screen.getByText(/^No templates in this Wizard yet/)).toBeTruthy();
  });
});
