// ReviewWizard.test.tsx — Proves the Review job walks a reviewer from a change number to the checks to an editable,
// copyable coaching note, guards ServiceNow as read-only for its whole life, and never offers a fix.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { installWizardTransports, readSnowTransport, resetWizardTransports, type SnowTransport } from '../transport/wizardTransports.ts';
import { runChangeReview, type ChangeReviewResult } from './changeReview.ts';
import { COACHING_PHRASES } from './coachingNote.ts';
import { isReadOnlySnowTransport } from './readOnlyTransport.ts';
import ReviewWizard from './ReviewWizard.tsx';

vi.mock('./changeReview.ts', () => ({ runChangeReview: vi.fn(), AUTHOR_ONLY_ITEM_IDS: new Set(['riskCheck', 'prbs']) }));

const mockedRunChangeReview = vi.mocked(runChangeReview);

const ORIGINAL_TRANSPORT: SnowTransport = { execute: vi.fn() };

const REVIEW_ITEMS: ReadinessItem[] = [
  { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Smith, Jane.', action: null },
  { id: 'outage', label: 'Outage record', state: 'needsAction', reason: 'No outage is recorded.', action: { kind: 'fixNow', fixId: 'createPlannedOutage', label: 'Create the planned outage', targetCount: 1 } },
  { id: 'rcp', label: 'Restricted change period rules', state: 'notApplicable', reason: 'Not a production change.', action: null },
  { id: 'testEvidence', label: 'Test evidence', state: 'couldNotCheck', reason: 'Could not read the change\'s attachments.', action: null },
];

function buildReview(overrides: Partial<ChangeReviewResult> = {}): ChangeReviewResult {
  return {
    changeNumber: 'CHG0012345',
    isChangeFound: true,
    items: REVIEW_ITEMS,
    coachingChange: { number: 'CHG0012345', creatorName: 'Smith, Jane', shortDescription: 'Login fix' },
    requesterEmail: 'jane@example.com',
    facts: {
      change: { changeNumber: 'CHG0012345', stateLabel: 'Assess', ownerName: 'Smith, Jane', configItemName: 'Login Service' },
      textFields: null, plannedWindow: null, isProduction: true,
    },
    ...overrides,
  };
}

async function findChange(changeNumber: string) {
  fireEvent.change(screen.getByLabelText('Change number'), { target: { value: changeNumber } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find this change' })); });
}

beforeEach(() => {
  mockedRunChangeReview.mockReset();
  installWizardTransports({ snow: ORIGINAL_TRANSPORT });
});

afterEach(() => {
  resetWizardTransports();
});

describe('ReviewWizard', () => {
  it('guards ServiceNow as read-only while open and restores the connection on exit', () => {
    const { unmount } = render(<ReviewWizard onExit={vi.fn()} />);

    expect(isReadOnlySnowTransport(readSnowTransport())).toBe(true);
    unmount();

    expect(readSnowTransport()).toBe(ORIGINAL_TRANSPORT);
  });

  it('waits for a change number before it will look', () => {
    render(<ReviewWizard onExit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Find this change' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/nothing is changed in ServiceNow/i)).toBeTruthy();
  });

  it('shows every check with its verdict in words, and offers no fix', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    render(<ReviewWizard onExit={vi.fn()} />);

    await findChange(' CHG0012345 ');

    expect(mockedRunChangeReview).toHaveBeenCalledWith('CHG0012345');
    expect(within(screen.getByRole('list', { name: 'Checks' })).getByText('Change owner')).toBeTruthy();
    for (const verdictText of ['Done', 'Needs action', 'Does not apply', 'Could not check']) {
      expect(screen.getAllByText(verdictText).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button', { name: /create the planned outage/i })).toBeNull();
    expect(screen.getByText(/1 check needs action/i)).toBeTruthy();
  });

  it('explains what it checks before and after the look-up', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    render(<ReviewWizard onExit={vi.fn()} />);
    expect(screen.getByText(/^What the Wizard checks, and why/)).toBeTruthy();
    await findChange('CHG0012345');
    expect(screen.getByText(/^What the Wizard checks, and why/)).toBeTruthy();
  });

  it('offers a prompt to talk the change through with an AI assistant, carrying every verdict', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    render(<ReviewWizard onExit={vi.fn()} />);
    await findChange('CHG0012345');
    const promptText = (screen.getByLabelText('Prompt for your AI assistant') as HTMLTextAreaElement).value;
    expect(promptText).toContain('Change: CHG0012345');
    expect(promptText).toContain('- Outage record: NEEDS ACTION — No outage is recorded.');
    expect(screen.getByRole('button', { name: 'Copy the prompt' })).toBeTruthy();
  });

  it('says plainly when the change cannot be found, and stays on the first step', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview({ isChangeFound: false, items: [] }));
    render(<ReviewWizard onExit={vi.fn()} />);

    await findChange('CHG404');

    expect(screen.getByRole('alert').textContent).toMatch(/couldn't find CHG404/i);
    expect(screen.getByLabelText('Change number')).toBeTruthy();
  });

  it('says plainly when the look-up itself fails', async () => {
    mockedRunChangeReview.mockRejectedValue(new Error('boom'));
    render(<ReviewWizard onExit={vi.fn()} />);

    await findChange('CHG1');

    expect(screen.getByRole('alert').textContent).toMatch(/couldn't check/i);
  });

  it('writes an editable coaching note with Copy and an addressed email', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    render(<ReviewWizard onExit={vi.fn()} />);
    await findChange('CHG0012345');

    fireEvent.click(screen.getByRole('button', { name: 'Write the note' }));
    const noteField = screen.getByLabelText('Note for Smith, Jane') as HTMLTextAreaElement;

    expect(noteField.value).toContain(COACHING_PHRASES.outage.missing);
    expect(noteField.value).toContain(`We couldn't check: ${COACHING_PHRASES.testEvidence.topic}`);
    fireEvent.change(noteField, { target: { value: 'My own words' } });
    const emailLink = screen.getByRole('link', { name: 'Open as email' }) as HTMLAnchorElement;
    expect(emailLink.getAttribute('href')).toContain('mailto:jane%40example.com?');
    expect(emailLink.getAttribute('href')).toContain('body=My%20own%20words');
    expect(screen.getByRole('button', { name: 'Copy the note' })).toBeTruthy();
  });

  it('keeps the reviewer\'s edits when they go back to the checks and return', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    render(<ReviewWizard onExit={vi.fn()} />);
    await findChange('CHG0012345');
    fireEvent.click(screen.getByRole('button', { name: 'Write the note' }));
    fireEvent.change(screen.getByLabelText('Note for Smith, Jane'), { target: { value: 'Edited' } });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write the note' }));

    expect((screen.getByLabelText('Note for Smith, Jane') as HTMLTextAreaElement).value).toBe('Edited');
  });

  it('starts over for another change, and goes back home on request', async () => {
    mockedRunChangeReview.mockResolvedValue(buildReview());
    const onExit = vi.fn();
    render(<ReviewWizard onExit={onExit} />);
    await findChange('CHG0012345');
    fireEvent.click(screen.getByRole('button', { name: 'Write the note' }));

    fireEvent.click(screen.getByRole('button', { name: 'Review another change' }));
    await waitFor(() => expect((screen.getByLabelText('Change number') as HTMLInputElement).value).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
