// IntakeReviewCells.test.tsx — Each review cell saves the PO's change as their own answer straight away: the draft is
// saved on blur only when it changed, "Don't create" declines it and "Create it after all" brings it back, and the
// DENP Epic cell says "Not checked yet" until the item has been checked.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import { settleDecision } from '../intakeChecklist.ts';
import { ReviewDraftCell, ReviewEpicCell, ReviewOwnerCell } from './IntakeReviewCells.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function buildNewEpicItem(): IntakeItem {
  const item = createIntakeItem(1, 'Paperless Options', [1]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'ai', 'Sorted');
  item.decisions.owner = settleDecision(item.decisions.owner, 'enrollment', 'ai', 'Share 80%');
  item.decisions.duplicate = settleDecision(item.decisions.duplicate, { verdict: 'createNew' }, 'rule', 'No open Epic found');
  return { ...item, searchStatus: 'ok' };
}

function buildIntake(item: IntakeItem): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: [{ lineNumber: 1, text: 'Paperless Options', rawText: 'Paperless Options', outlineLevel: 1 }],
    items: [item],
    setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

/** Renders one cell inside the table structure a <td> needs. */
function renderCell(cell: React.ReactElement) {
  return render(<table><tbody><tr>{cell}</tr></tbody></table>);
}

describe('ReviewDraftCell', () => {
  it('starts from the plain template and saves an edit on blur as the PO\'s own', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = buildNewEpicItem();
    renderCell(<ReviewDraftCell intake={buildIntake(item)} item={item} onChange={onChange} nowIso={() => NOW_ISO} />);

    const summary = screen.getByRole('textbox', { name: 'Epic summary for "Paperless Options"' });
    expect(summary).toHaveValue('Paperless Options');
    await user.click(summary);
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();

    await user.type(summary, ' v2');
    await user.tab();
    const saved = onChange.mock.calls[0][0] as EpicIntake;
    expect(saved.items[0].draft).toMatchObject({ summary: 'Paperless Options v2', editedByPo: true });
  });

  it('declines with "Don\'t create", and offers the way back once declined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = buildNewEpicItem();
    const { unmount } = renderCell(<ReviewDraftCell intake={buildIntake(item)} item={item} onChange={onChange} nowIso={() => NOW_ISO} />);

    await user.click(screen.getByRole('button', { name: 'Don\'t create' }));
    const declined = onChange.mock.calls[0][0] as EpicIntake;
    expect(declined.items[0].decisions.draftAccepted).toMatchObject({ state: 'settled', value: 'declined' });
    unmount();

    renderCell(<ReviewDraftCell intake={declined} item={declined.items[0]} onChange={onChange} nowIso={() => NOW_ISO} />);
    await user.click(screen.getByRole('button', { name: 'Create it after all' }));
    const restored = onChange.mock.calls[1][0] as EpicIntake;
    expect(restored.items[0].decisions.draftAccepted).toMatchObject({ state: 'settled', value: 'accepted' });
  });
});

describe('ReviewEpicCell and ReviewOwnerCell', () => {
  it('says "Not checked yet" before the DENP check', () => {
    const item = { ...buildNewEpicItem(), searchStatus: 'notRun' as const };
    renderCell(<ReviewEpicCell intake={buildIntake(item)} item={item} onChange={vi.fn()} nowIso={() => NOW_ISO} />);

    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });

  it('saves an owner change straight away, with Shared named plainly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = buildNewEpicItem();
    renderCell(<ReviewOwnerCell intake={buildIntake(item)} item={item} onChange={onChange} nowIso={() => NOW_ISO} />);

    const ownerSelect = screen.getByRole('combobox', { name: 'Owner for "Paperless Options"' });
    expect(ownerSelect).toHaveValue('enrollment');
    await user.selectOptions(ownerSelect, 'Shared — Enrollment takes its part');

    const saved = onChange.mock.calls[0][0] as EpicIntake;
    expect(saved.items[0].decisions.owner).toMatchObject({ state: 'settled', value: 'shared', settledBy: 'po' });
  });
});
