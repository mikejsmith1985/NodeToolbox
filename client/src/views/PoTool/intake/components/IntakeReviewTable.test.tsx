// IntakeReviewTable.test.tsx — The one pre-filled table the PO reviews: the count line, rows needing a look first,
// every value pre-selected, a change saved as the PO's own, the DENP Epic choice limited to the top pick plus four,
// and non-work items collapsed under "Also in the notes" where Kind can still turn one back into work.

import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type DuplicateCandidate,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import { refreshApplicability, settleDecision } from '../intakeChecklist.ts';
import IntakeReviewTable from './IntakeReviewTable.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const JIRA_BASE_URL = 'https://jira.example.com';

function buildIntake(items: IntakeItem[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: items.flatMap((item) => item.lineNumbers.map((lineNumber) => ({ lineNumber, text: item.title, rawText: item.title, outlineLevel: 1 as const }))),
    items,
    setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

function buildCandidate(key: string): DuplicateCandidate {
  return { key, summary: `Epic ${key}`, statusName: 'Open', statusCategory: 'new', descriptionExcerpt: '', foundBy: 'search' };
}

function buildWorkItem(itemNumber: number, title: string): IntakeItem {
  const item = createIntakeItem(itemNumber, title, [itemNumber]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'ai', 'Sorted');
  item.decisions.owner = settleDecision(item.decisions.owner, 'enrollment', 'ai', 'Share 80%');
  item.decisions.searchTerms = settleDecision(item.decisions.searchTerms, [title], 'ai', 'Suggested');
  return item;
}

function buildNewEpicItem(itemNumber: number, title: string): IntakeItem {
  const item = buildWorkItem(itemNumber, title);
  item.decisions.duplicate = settleDecision(item.decisions.duplicate, { verdict: 'createNew' }, 'ai', 'None covers it');
  item.decisions.label = settleDecision(item.decisions.label, 'Roadmap', 'ai', 'New capability');
  return { ...item, searchStatus: 'ok' };
}

function buildExistingItem(itemNumber: number, title: string): IntakeItem {
  const item = buildWorkItem(itemNumber, title);
  item.decisions.duplicate = settleDecision(item.decisions.duplicate, { verdict: 'existing', key: 'DENP-632' }, 'ai', 'Same scope');
  item.decisions.label = { state: 'notApplicable', reason: 'Duplicate check: existing' };
  item.decisions.draftAccepted = { state: 'notApplicable', reason: 'Duplicate check: existing' };
  const candidates = ['DENP-1', 'DENP-632', 'DENP-2', 'DENP-3', 'DENP-4', 'DENP-5'].map(buildCandidate);
  return { ...item, searchStatus: 'ok', candidates };
}

/** Keeps the intake in state so every change the table makes feeds straight back into it. */
function ControlledReviewTable({ initialIntake }: { initialIntake: EpicIntake }) {
  const [intake, setIntake] = useState(initialIntake);
  return <IntakeReviewTable intake={intake} isAiUnlocked={false} jiraBaseUrl={JIRA_BASE_URL} onChange={setIntake} nowIso={() => NOW_ISO} />;
}

describe('IntakeReviewTable', () => {
  it('shows the count line and every value pre-filled, rows needing a look first', () => {
    const flagged = { ...buildNewEpicItem(3, 'AEP'), reviewFlag: 'Shared: a close call' };
    const intake = buildIntake([buildNewEpicItem(1, 'Paperless Options'), buildExistingItem(2, 'Core Integration'), flagged]);

    render(<ControlledReviewTable initialIntake={intake} />);

    expect(screen.getByText('Create 2 · Existing 1 · Needs a look 0 · Not created 0')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Work items' })).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].querySelector('strong')?.textContent)).toEqual(['AEP', 'Paperless Options', 'Core Integration']);
    expect(within(rows[0]).getByText('⚠ Shared: a close call')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Kind for "Paperless Options"' })).toHaveValue('work');
    expect(screen.getByRole('combobox', { name: 'Label for "Paperless Options"' })).toHaveValue('Roadmap');
    expect(screen.getByRole('combobox', { name: 'DENP Epic for "Paperless Options"' })).toHaveValue('createNew');
    expect(within(rows[2]).getByRole('link', { name: 'DENP-632' })).toHaveAttribute('href', expect.stringContaining('DENP-632'));
  });

  it('lists the top pick and at most four other open Epics in the DENP Epic choice', () => {
    render(<ControlledReviewTable initialIntake={buildIntake([buildExistingItem(1, 'Core Integration')])} />);

    const epicSelect = screen.getByRole('combobox', { name: 'DENP Epic for "Core Integration"' });
    expect(epicSelect).toHaveValue('DENP-632');
    expect(within(epicSelect).getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['DENP-632', 'DENP-1', 'DENP-2', 'DENP-3', 'DENP-4', 'createNew', 'notActionable']);
  });

  it('saves a change as the PO\'s own and moves the row to its new bucket', async () => {
    const user = userEvent.setup();
    render(<ControlledReviewTable initialIntake={buildIntake([buildExistingItem(1, 'Core Integration')])} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'DENP Epic for "Core Integration"' }), 'createNew');

    expect(screen.getByRole('combobox', { name: 'Label for "Core Integration"' })).toHaveValue('');
    expect(screen.getByText(/Needs your choice/)).toBeInTheDocument();
    expect(screen.getByText('Create 0 · Existing 0 · Needs a look 1 · Not created 0')).toBeInTheDocument();
  });

  it('says "Not checked yet" before the DENP check, and "Choose…" while a kind is undecided', () => {
    const unsorted = createIntakeItem(2, 'Invoice overhaul', [2]);
    render(<ControlledReviewTable initialIntake={buildIntake([buildWorkItem(1, 'Member portal'), unsorted])} />);

    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    const kindSelect = screen.getByRole('combobox', { name: 'Kind for "Invoice overhaul"' });
    expect(kindSelect).toHaveValue('');
    expect(within(kindSelect).getByRole('option', { name: 'Choose…' })).toBeInTheDocument();
  });

  it('keeps non-work items under "Also in the notes", where Kind turns one back into work', async () => {
    const user = userEvent.setup();
    const risk = createIntakeItem(1, 'Vendor may slip', [1]);
    risk.decisions.kind = settleDecision(risk.decisions.kind, 'risk', 'ai', 'A risk, not work');
    render(<ControlledReviewTable initialIntake={buildIntake([refreshApplicability(risk)])} />);

    const otherTable = screen.getByRole('table', { name: 'Also in the notes' });
    expect(within(otherTable).getAllByRole('cell').at(-1)).toHaveTextContent('Not actionable');
    expect(within(otherTable).queryByRole('combobox', { name: 'Owner for "Vendor may slip"' })).not.toBeInTheDocument();
    await user.selectOptions(within(otherTable).getByRole('combobox', { name: 'Kind for "Vendor may slip"' }), 'Work');

    const workTable = screen.getByRole('table', { name: 'Work items' });
    expect(within(workTable).getByRole('combobox', { name: 'Owner for "Vendor may slip"' })).toHaveValue('');
    expect(screen.queryByRole('table', { name: 'Also in the notes' })).not.toBeInTheDocument();
  });
});
