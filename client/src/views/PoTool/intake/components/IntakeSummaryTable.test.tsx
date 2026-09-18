// IntakeSummaryTable.test.tsx — Every work item appears once, non-work items collapse under "Also in the notes",
// and Copy table puts a real table on the clipboard — HTML for Outlook/Teams/Confluence, plain text as a fallback
// when the browser cannot write rich clipboard content (US5).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import { settleDecision } from '../intakeChecklist.ts';
import IntakeSummaryTable from './IntakeSummaryTable.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const JIRA_BASE_URL = 'https://example.atlassian.net';

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'po', reason: 'test', aiAttempts: 0 };
}

function buildCreatedWorkItem(): IntakeItem {
  const item = createIntakeItem(1, 'Member portal work', [1]);
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
    creation: { state: 'created', key: 'DENP-701', createdAtIso: NOW_ISO },
  };
}

function buildNoiseItem(): IntakeItem {
  const item = createIntakeItem(2, 'Somebody said hello', [2]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'noise', 'rule', 'Notes say noise');
  return item;
}

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
    lines: [],
    items,
    setAsideLines: [],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  }
  vi.restoreAllMocks();
});

describe('IntakeSummaryTable', () => {
  it('renders the work item and collapses the non-work item under "Also in the notes"', () => {
    const intake = buildIntake([buildCreatedWorkItem(), buildNoiseItem()]);
    render(<IntakeSummaryTable intake={intake} jiraBaseUrl={JIRA_BASE_URL} />);

    expect(screen.getByText('Member portal work')).toBeInTheDocument();
    expect(screen.getByText('Also in the notes (1)')).toBeInTheDocument();
    expect(screen.getByText('Somebody said hello')).toBeInTheDocument();
  });

  it('writes both an HTML and a plain-text flavour to the clipboard, then shows "✓ Copied"', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.fn(async () => {});
    // A plain arrow mock cannot be invoked with `new`; ClipboardItem is constructed with `new` in the component.
    const clipboardItemConstructor = vi.fn(function ClipboardItemMock(this: { parts: Record<string, Blob> }, parts: Record<string, Blob>) {
      this.parts = parts;
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = clipboardItemConstructor;
    Object.defineProperty(navigator, 'clipboard', { value: { write: clipboardWrite }, configurable: true });

    const intake = buildIntake([buildCreatedWorkItem()]);
    render(<IntakeSummaryTable intake={intake} jiraBaseUrl={JIRA_BASE_URL} />);

    await user.click(screen.getByRole('button', { name: /Copy table/ }));

    expect(await screen.findByText('✓ Copied')).toBeInTheDocument();
    expect(clipboardItemConstructor).toHaveBeenCalledTimes(1);
    const writtenParts = clipboardItemConstructor.mock.calls[0][0] as Record<string, Blob>;
    expect(Object.keys(writtenParts)).toEqual(['text/html', 'text/plain']);
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
  });

  it('falls back to writeText when the browser has no ClipboardItem', async () => {
    const user = userEvent.setup();
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = undefined;
    const clipboardWriteText = vi.fn(async (_copiedText: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWriteText }, configurable: true });

    const intake = buildIntake([buildCreatedWorkItem()]);
    render(<IntakeSummaryTable intake={intake} jiraBaseUrl={JIRA_BASE_URL} />);

    await user.click(screen.getByRole('button', { name: /Copy table/ }));

    expect(await screen.findByText('✓ Copied')).toBeInTheDocument();
    expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    expect(clipboardWriteText.mock.calls[0][0]).toContain('Member portal work');
  });
});
