// IntakeDraftReview.test.tsx — Shows the manual draft when the item has none yet, saves the PO's edits on blur
// with editedByPo true, keeps Accept disabled on a blank summary, and settles draftAccepted through Accept/Decline
// (FR-022 — nothing here writes to Jira).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildManualDraft } from '../ai/intakeDraftRound.ts';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type SourceLine,
} from '../epicIntakeModel.ts';
import IntakeDraftReview from './IntakeDraftReview.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

const LINES: SourceLine[] = [
  { lineNumber: 1, text: 'Member portal work', rawText: 'Member portal work', outlineLevel: 1 },
  { lineNumber: 2, text: 'Needs single sign-on', rawText: '  Needs single sign-on', outlineLevel: 2 },
];

function buildIntake(): EpicIntake {
  const item = createIntakeItem(1, 'Member portal work', [1, 2]);
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: LINES,
    items: [item],
    setAsideLines: [],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

describe('IntakeDraftReview', () => {
  it('shows the manual draft built from the item\'s own lines when it has no draft yet', () => {
    const intake = buildIntake();
    const manualDraft = buildManualDraft(intake.items[0], intake.lines);
    render(<IntakeDraftReview intake={intake} itemIds={['item-1']} onChange={vi.fn()} nowIso={() => NOW_ISO} />);

    expect(screen.getByLabelText(/^Summary/)).toHaveValue(manualDraft.summary);
    expect(screen.getByLabelText('Description')).toHaveValue(manualDraft.description);
  });

  it('saves the PO\'s edit on blur, marking the draft as edited by the PO', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    const onChange = vi.fn();
    render(<IntakeDraftReview intake={intake} itemIds={['item-1']} onChange={onChange} nowIso={() => NOW_ISO} />);

    const summaryInput = screen.getByLabelText(/^Summary/);
    await user.clear(summaryInput);
    await user.type(summaryInput, 'Member self-service portal');
    await user.tab();

    expect(onChange).toHaveBeenCalled();
    const updatedIntake = onChange.mock.calls.at(-1)?.[0] as EpicIntake;
    expect(updatedIntake.items[0].draft).toMatchObject({ summary: 'Member self-service portal', editedByPo: true });
  });

  it('disables Accept while the summary is blank', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    render(<IntakeDraftReview intake={intake} itemIds={['item-1']} onChange={vi.fn()} nowIso={() => NOW_ISO} />);

    const summaryInput = screen.getByLabelText(/^Summary/);
    await user.clear(summaryInput);

    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('Accept settles draftAccepted as accepted, by the PO', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    const onChange = vi.fn();
    render(<IntakeDraftReview intake={intake} itemIds={['item-1']} onChange={onChange} nowIso={() => NOW_ISO} />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    const updatedIntake = onChange.mock.calls.at(-1)?.[0] as EpicIntake;
    expect(updatedIntake.items[0].decisions.draftAccepted).toMatchObject({ state: 'settled', value: 'accepted', settledBy: 'po' });
  });

  it('Decline settles draftAccepted as declined, by the PO', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    const onChange = vi.fn();
    render(<IntakeDraftReview intake={intake} itemIds={['item-1']} onChange={onChange} nowIso={() => NOW_ISO} />);

    await user.click(screen.getByRole('button', { name: 'Decline' }));

    const updatedIntake = onChange.mock.calls.at(-1)?.[0] as EpicIntake;
    expect(updatedIntake.items[0].decisions.draftAccepted).toMatchObject({ state: 'settled', value: 'declined', settledBy: 'po' });
  });

  it('renders nothing when no item id in the list matches', () => {
    const intake = buildIntake();
    const { container } = render(<IntakeDraftReview intake={intake} itemIds={['item-missing']} onChange={vi.fn()} nowIso={() => NOW_ISO} />);
    expect(container).toBeEmptyDOMElement();
  });
});
