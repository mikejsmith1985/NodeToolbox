// ColumnVocabularyEditor.test.tsx — Proves the editor cannot produce a mapping Jira would reject,
// and cannot replace someone's columns without showing them what changes.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColumnVocabularyEditor } from './ColumnVocabularyEditor.tsx';
import type { ColumnOptionSources } from '../columnOptionSources.ts';
import type { BoardVocabulary } from '../rollupBoardTypes.ts';

const OPTION_SOURCES: ColumnOptionSources = {
  statusNames: ['To Do', 'In Progress', 'Done'],
  subStatusValues: ['Dev In Progress', 'Dev Complete'],
  isSubStatusUnavailable: false,
};

function buildVocabulary(overrides: Partial<BoardVocabulary> = {}): BoardVocabulary {
  return {
    teamProfileId: 'team-a',
    columns: [
      { id: 'col-1', name: 'Being coded', order: 0, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' } },
      { id: 'col-2', name: 'Waiting on SL test', order: 1, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' } },
    ],
    updatedAt: '2026-08-07T10:00:00.000Z',
    lastSyncedAt: null,
    ...overrides,
  };
}

describe('ColumnVocabularyEditor — the mapping controls', () => {
  it('only offers statuses Jira reported, never a free-text box', () => {
    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    const statusSelect = screen.getByLabelText('Jira status for Being coded');
    expect(statusSelect.tagName).toBe('SELECT');
    expect(screen.getAllByRole('option', { name: 'In Progress' }).length).toBeGreaterThan(0);
  });

  it('lets a column be defined before it is mapped', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.change(screen.getByLabelText('New column name'), { target: { value: 'Ready for release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns[2]).toMatchObject({ name: 'Ready for release', mapping: null });
  });

  it('disables the sub-status picker when this board exposes none, instead of offering free text', () => {
    render(
      <ColumnVocabularyEditor
        canShare
        optionSources={{ statusNames: ['To Do'], subStatusValues: [], isSubStatusUnavailable: true }}
        onVocabularyChange={vi.fn()}
        vocabulary={buildVocabulary()}
      />,
    );

    expect((screen.getByLabelText('Sub-status for Being coded') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/columns can only be mapped to a status/)).toBeTruthy();
  });

  it('reorders a column and renumbers so the order stays contiguous', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Waiting on SL test left' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns.map((column: { name: string; order: number }) => [column.name, column.order]))
      .toEqual([['Waiting on SL test', 0], ['Being coded', 1]]);
  });
});

describe('ColumnVocabularyEditor — refusing an ambiguous vocabulary', () => {
  it('refuses to publish two columns claiming the same Jira state, and says which', () => {
    const conflicting = buildVocabulary();
    conflicting.columns[1].mapping = { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' };

    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={conflicting} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('One state can only mean one column');
    expect((screen.getByRole('button', { name: 'Publish to the team' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses two columns with the same name', () => {
    const conflicting = buildVocabulary();
    conflicting.columns[1].name = 'BEING CODED';

    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={conflicting} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('both called');
  });
});

describe('ColumnVocabularyEditor — sharing', () => {
  it('says when the columns were last shared, so a stale copy is detectable', () => {
    render(
      <ColumnVocabularyEditor canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByText(/never shared with the team/)).toBeTruthy();
  });

  it('says plainly that sharing is unavailable when the team has no shared workspace', () => {
    render(
      <ColumnVocabularyEditor canShare={false} optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByText(/no shared ART workspace configured/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish to the team' })).toBeNull();
  });

  it('lists what a pull would change BEFORE anything changes', () => {
    const remote = buildVocabulary({
      columns: [{ id: 'col-1', name: 'In development', order: 0, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' } }],
    });

    render(
      <ColumnVocabularyEditor
        canShare
        onVocabularyChange={vi.fn()}
        optionSources={OPTION_SOURCES}
        pullPreview={{ remote, differences: [], hasDifferences: true }}
        vocabulary={buildVocabulary()}
      />,
    );

    expect(screen.getByText('Renames "Being coded" to "In development"')).toBeTruthy();
    expect(screen.getByText('Removes your column "Waiting on SL test"')).toBeTruthy();
  });

  it('lets a pull be refused, leaving the local columns alone', () => {
    const onCancelPull = vi.fn();
    const onAcceptPull = vi.fn();
    const remote = buildVocabulary({ columns: [{ id: 'col-1', name: 'In development', order: 0, mapping: null }] });

    render(
      <ColumnVocabularyEditor
        canShare
        onAcceptPull={onAcceptPull}
        onCancelPull={onCancelPull}
        onVocabularyChange={vi.fn()}
        optionSources={OPTION_SOURCES}
        pullPreview={{ remote, differences: [], hasDifferences: true }}
        vocabulary={buildVocabulary()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(onCancelPull).toHaveBeenCalled();
    expect(onAcceptPull).not.toHaveBeenCalled();
  });

  it('says nothing has been published yet rather than showing an empty diff', () => {
    render(
      <ColumnVocabularyEditor
        canShare
        onVocabularyChange={vi.fn()}
        optionSources={OPTION_SOURCES}
        pullPreview={{ remote: null, differences: [], hasDifferences: false }}
        vocabulary={buildVocabulary()}
      />,
    );

    expect(screen.getByText(/Nobody has published/)).toBeTruthy();
  });
});
