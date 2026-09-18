// IntakeQuestionList.test.tsx — Every question is a closed choice rendered as a <select>, never a text input; any
// suggestion is pre-selected; Save stays disabled until a choice is made; and saving settles the slot as the PO's
// via the real answer helpers (spec 037, contracts/composition-mode.md §3).

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { recordAiProposal, type OpenDecision } from '../intakeChecklist.ts';
import IntakeQuestionList from './IntakeQuestionList.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 1 };
}

function buildIntake(): EpicIntake {
  const item = createIntakeItem(1, 'Member portal work', [1, 2]);
  item.decisions.owner = recordAiProposal(item.decisions.owner, 'fulfillment', 'Estimated Enrollment share 30%');
  item.candidates = [
    { key: 'DENP-1', summary: 'Existing portal Epic', statusName: 'Open', statusCategory: 'To Do', descriptionExcerpt: '', foundBy: 'search' },
  ];
  item.namedKeys = [
    { key: 'DENP-9', projectKey: 'DENP', lineNumber: 2, lookup: { status: 'unusable', reason: 'notFound', detail: 'Not found' } },
  ];
  item.searchStatus = 'ok';
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: [buildLine(1, 'Member portal work'), buildLine(2, 'More detail'), buildLine(5, 'A stray line')],
    items: [item],
    setAsideLines: [],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

const ALL_SLOT_QUESTIONS: OpenDecision[] = [
  { itemId: 'item-1', slot: 'kind', step: 'sortNotes', turn: 'po' },
  { itemId: 'item-1', slot: 'owner', step: 'decideOwners', turn: 'po' },
  { itemId: 'item-1', slot: 'duplicate', step: 'match', turn: 'po' },
  { itemId: 'item-1', slot: 'label', step: 'confirmLabels', turn: 'po' },
  { itemId: null, slot: 'lineCoverage', step: 'sortNotes', turn: 'po', lineNumber: 5 },
];

describe('IntakeQuestionList', () => {
  it('renders every question as a <select>, never a text input', () => {
    const intake = buildIntake();
    render(<IntakeQuestionList intake={intake} questions={ALL_SLOT_QUESTIONS} onChange={vi.fn()} nowIso={() => NOW_ISO} />);

    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('pre-selects the suggestion beside the owner question', () => {
    const intake = buildIntake();
    render(
      <IntakeQuestionList
        intake={intake}
        questions={[{ itemId: 'item-1', slot: 'owner', step: 'decideOwners', turn: 'po' }]}
        onChange={vi.fn()}
        nowIso={() => NOW_ISO}
      />,
    );

    const ownerSelect = screen.getByRole('combobox', { name: /Who owns/ }) as HTMLSelectElement;
    expect(ownerSelect.value).toBe('fulfillment');
  });

  it('keeps Save disabled until a choice is made, for a question with no suggestion', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    render(
      <IntakeQuestionList
        intake={intake}
        questions={[{ itemId: 'item-1', slot: 'kind', step: 'sortNotes', turn: 'po' }]}
        onChange={vi.fn()}
        nowIso={() => NOW_ISO}
      />,
    );

    const kindSelect = screen.getByRole('combobox', { name: /What is/ });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.selectOptions(kindSelect, 'work');
    expect(saveButton).toBeEnabled();
  });

  it('saving the kind question settles it by the PO, through the real answer helper', async () => {
    const user = userEvent.setup();
    const intake = buildIntake();
    const onChange = vi.fn();
    render(
      <IntakeQuestionList
        intake={intake}
        questions={[{ itemId: 'item-1', slot: 'kind', step: 'sortNotes', turn: 'po' }]}
        onChange={onChange}
        nowIso={() => NOW_ISO}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: /What is/ }), 'work');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedIntake = onChange.mock.calls[0][0] as EpicIntake;
    expect(updatedIntake.items[0].decisions.kind).toMatchObject({ state: 'settled', value: 'work', settledBy: 'po' });
  });

  it('lists match options as the item\'s candidates, an unusable named key offer, and the two closing choices', () => {
    const intake = buildIntake();
    render(
      <IntakeQuestionList
        intake={intake}
        questions={[{ itemId: 'item-1', slot: 'duplicate', step: 'match', turn: 'po' }]}
        onChange={vi.fn()}
        nowIso={() => NOW_ISO}
      />,
    );

    const duplicateSelect = screen.getByRole('combobox', { name: /Does an open Epic already cover/ });
    const optionTexts = within(duplicateSelect).getAllByRole('option').map((option) => option.textContent);
    expect(optionTexts).toEqual([
      'Choose…',
      'DENP-1 — Existing portal Epic [Open]',
      'Use DENP-9 anyway',
      'None of these — create a new Epic',
      'Not actionable',
    ]);
  });

  it('offers "Part of:" and set-aside choices for a line-coverage question', () => {
    const intake = buildIntake();
    render(
      <IntakeQuestionList
        intake={intake}
        questions={[{ itemId: null, slot: 'lineCoverage', step: 'sortNotes', turn: 'po', lineNumber: 5 }]}
        onChange={vi.fn()}
        nowIso={() => NOW_ISO}
      />,
    );

    const lineSelect = screen.getByRole('combobox', { name: /Where does line 5 belong/ });
    const optionTexts = within(lineSelect).getAllByRole('option').map((option) => option.textContent);
    expect(optionTexts).toContain('Part of: Member portal work');
    expect(optionTexts.some((text) => text?.startsWith('Set aside — '))).toBe(true);
  });
});
