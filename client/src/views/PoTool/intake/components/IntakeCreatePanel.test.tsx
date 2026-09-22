// IntakeCreatePanel.test.tsx — Reads what the live Epic create screen requires, asks the PO once for anything the
// intake cannot supply, treats the Create click as the PO's confirmation of the reviewed rows, creates one Epic at a
// time, and shows Jira's own reason for a failure (spec 037, contracts/epic-create.md). loadCreateFields and createDeps are mocked; the create loop itself is the real
// runEpicCreates, driven through a small stateful wrapper so onChange actually feeds back into the panel.

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CreateMetaFieldEntry } from '../../../../types/jira.ts';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import type { EpicCreateDeps } from '../epicCreate.ts';
import IntakeCreatePanel from './IntakeCreatePanel.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'po', reason: 'test', aiAttempts: 0 };
}

function buildReadyItem(itemNumber: number, summary: string): IntakeItem {
  const item = createIntakeItem(itemNumber, summary, [itemNumber]);
  return {
    ...item,
    decisions: {
      kind: settled('work' as const),
      owner: settled('enrollment' as const),
      searchTerms: settled(['portal']),
      duplicate: settled({ verdict: 'createNew' as const }),
      label: settled('Roadmap' as const),
      draftAccepted: settled('accepted' as const),
    },
    searchStatus: 'ok',
    draft: { summary, description: 'Description:\nBuild the thing.', source: 'po', editedByPo: false },
  };
}

function buildIntake(items: IntakeItem[], epicType: EpicIntake['epicType'] = { state: 'resolved', id: '10000', name: 'Epic' }): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: [],
    items,
    setAsideLines: [],
    epicType,
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

function buildField(fieldId: string, name: string, overrides: Partial<CreateMetaFieldEntry> = {}): CreateMetaFieldEntry {
  return { fieldId, name, required: true, schema: { type: 'string' }, ...overrides };
}

function buildCreateDeps(overrides: Partial<EpicCreateDeps> = {}): EpicCreateDeps {
  return {
    createIssue: vi.fn(async () => ({ id: '1', key: 'DENP-701', self: '' })),
    searchIssues: vi.fn(async () => []),
    nowIso: () => NOW_ISO,
    ...overrides,
  };
}

interface RenderPanelOptions {
  initialIntake: EpicIntake;
  createDeps: EpicCreateDeps;
  loadCreateFields: (projectKey: string, issueTypeId: string) => Promise<{ values: CreateMetaFieldEntry[] }>;
  onChangeSpy?: (intake: EpicIntake) => void;
  isAiUnlocked?: boolean;
}

/** A thin stateful wrapper so clicking Create (and answering required fields) actually feeds back into the panel. */
function ControlledCreatePanel({ initialIntake, createDeps, loadCreateFields, onChangeSpy, isAiUnlocked = false }: RenderPanelOptions) {
  const [intake, setIntake] = useState(initialIntake);
  return (
    <IntakeCreatePanel
      intake={intake}
      isAiUnlocked={isAiUnlocked}
      nowIso={() => NOW_ISO}
      onChange={(nextIntake) => {
        setIntake(nextIntake);
        onChangeSpy?.(nextIntake);
      }}
      createDeps={createDeps}
      loadCreateFields={loadCreateFields}
    />
  );
}

describe('IntakeCreatePanel', () => {
  it('shows the loading message, then the Create button once the screen is read', async () => {
    let resolveFields: (value: { values: CreateMetaFieldEntry[] }) => void = () => {};
    const loadCreateFields = vi.fn(() => new Promise<{ values: CreateMetaFieldEntry[] }>((resolve) => { resolveFields = resolve; }));
    const intake = buildIntake([buildReadyItem(1, 'Member portal')]);

    render(<ControlledCreatePanel initialIntake={intake} createDeps={buildCreateDeps()} loadCreateFields={loadCreateFields} />);

    expect(screen.getByText(/Reading what the Epic create screen requires/)).toBeInTheDocument();
    resolveFields({ values: [] });

    expect(await screen.findByRole('button', { name: 'Create 1 Epic(s)' })).toBeEnabled();
    expect(loadCreateFields).toHaveBeenCalledWith('DENP', '10000');
  });

  it('keeps Create disabled until an extra required option field is answered', async () => {
    const user = userEvent.setup();
    const loadCreateFields = vi.fn(async () => ({
      values: [buildField('businessArea', 'Business Area', { schema: { type: 'option' }, allowedValues: [{ id: '42', name: 'Enrollment' }] })],
    }));
    const intake = buildIntake([buildReadyItem(1, 'Member portal')]);

    render(<ControlledCreatePanel initialIntake={intake} createDeps={buildCreateDeps()} loadCreateFields={loadCreateFields} />);

    const createButton = await screen.findByRole('button', { name: 'Create 1 Epic(s)' });
    expect(createButton).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Business Area' }), '42');
    expect(createButton).toBeEnabled();
  });

  it('creates one Epic per ready item and reports the created keys through onChange', async () => {
    const user = userEvent.setup();
    const loadCreateFields = vi.fn(async () => ({ values: [] }));
    const createIssue = vi.fn()
      .mockResolvedValueOnce({ id: '1', key: 'DENP-701', self: '' })
      .mockResolvedValueOnce({ id: '2', key: 'DENP-702', self: '' });
    const intake = buildIntake([buildReadyItem(1, 'Member portal'), buildReadyItem(2, 'ID cards')]);
    const onChangeSpy = vi.fn();

    render(
      <ControlledCreatePanel
        initialIntake={intake}
        createDeps={buildCreateDeps({ createIssue })}
        loadCreateFields={loadCreateFields}
        onChangeSpy={onChangeSpy}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Create 2 Epic(s)' }));

    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const lastIntake = onChangeSpy.mock.calls.at(-1)?.[0] as EpicIntake;
      expect(lastIntake.items.map((item) => item.creation.state)).toEqual(['created', 'created']);
    });
    expect(await screen.findByText(/Member portal: created DENP-701/)).toBeInTheDocument();
    expect(await screen.findByText(/ID cards: created DENP-702/)).toBeInTheDocument();
  });

  it('shows Jira\'s own reason beside a failed Epic', async () => {
    const user = userEvent.setup();
    const loadCreateFields = vi.fn(async () => ({ values: [] }));
    const createIssue = vi.fn().mockRejectedValueOnce(new Error('Epic Name is required.'));
    const intake = buildIntake([buildReadyItem(1, 'Member portal')]);

    render(<ControlledCreatePanel initialIntake={intake} createDeps={buildCreateDeps({ createIssue })} loadCreateFields={loadCreateFields} />);

    await user.click(await screen.findByRole('button', { name: 'Create 1 Epic(s)' }));

    expect(await screen.findByText(/Member portal: failed — Epic Name is required\./)).toBeInTheDocument();
  });

  it('tells the PO to run Check DENP first when the Epic type is not yet resolved', () => {
    const loadCreateFields = vi.fn();
    const intake = buildIntake([buildReadyItem(1, 'Member portal')], { state: 'unresolved' });

    render(<ControlledCreatePanel initialIntake={intake} createDeps={buildCreateDeps()} loadCreateFields={loadCreateFields} />);

    expect(screen.getByText(/run Check DENP first/)).toBeInTheDocument();
    expect(loadCreateFields).not.toHaveBeenCalled();
  });

  it('confirms a reviewed row with no written draft on Create, using the plain template as its draft', async () => {
    const user = userEvent.setup();
    const loadCreateFields = vi.fn(async () => ({ values: [] }));
    const createIssue = vi.fn(async () => ({ id: '1', key: 'DENP-701', self: '' }));
    const reviewedItem = buildReadyItem(1, 'Member portal');
    reviewedItem.draft = null;
    reviewedItem.decisions.draftAccepted = { state: 'open', aiAttempts: 0, isAwaitingPo: false, lastRejection: null, aiProposal: null, aiReason: null };
    const intake = { ...buildIntake([reviewedItem]), lines: [{ lineNumber: 1, text: 'Member portal', rawText: 'Member portal', outlineLevel: 1 as const }] };
    const onChangeSpy = vi.fn();

    render(<ControlledCreatePanel initialIntake={intake} createDeps={buildCreateDeps({ createIssue })} loadCreateFields={loadCreateFields} onChangeSpy={onChangeSpy} />);

    await user.click(await screen.findByRole('button', { name: 'Create 1 Epic(s)' }));

    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(1));
    const confirmedIntake = onChangeSpy.mock.calls[0][0] as EpicIntake;
    expect(confirmedIntake.items[0].decisions.draftAccepted).toMatchObject({ state: 'settled', value: 'accepted' });
    expect(confirmedIntake.items[0].draft?.summary).toBe('Member portal');
  });

  it('waits for a draft that can still be written when help is available, instead of counting the row', async () => {
    const loadCreateFields = vi.fn(async () => ({ values: [] }));
    const pendingItem = buildReadyItem(1, 'Member portal');
    pendingItem.draft = null;
    pendingItem.decisions.draftAccepted = { state: 'open', aiAttempts: 0, isAwaitingPo: false, lastRejection: null, aiProposal: null, aiReason: null };

    render(<ControlledCreatePanel initialIntake={buildIntake([pendingItem])} createDeps={buildCreateDeps()} loadCreateFields={loadCreateFields} isAiUnlocked />);

    expect(await screen.findByRole('button', { name: 'Create 0 Epic(s)' })).toBeDisabled();
  });
});
