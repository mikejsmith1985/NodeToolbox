// ColumnVocabularyEditor.test.tsx — Proves the editor cannot produce a mapping Jira would reject,
// and cannot replace someone's columns without showing them what changes.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColumnVocabularyEditor } from './ColumnVocabularyEditor.tsx';
import type { ColumnOptionSources } from '../columnOptionSources.ts';
import type { RollupBoardItem } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';
import type { BoardVocabulary } from '../rollupBoardTypes.ts';

const OPTION_SOURCES: ColumnOptionSources = {
  statusNames: ['To Do', 'In Progress', 'Done'],
  subStatusValues: ['Dev In Progress', 'Dev Complete'],
  isSubStatusUnavailable: false,
};

/** A board sitting in three real state combinations, so suggestions and counts have something to read. */
const BOARD_ITEMS = [
  buildBoardItem('DEV-1', 'In Progress', 'Dev In Progress'),
  buildBoardItem('DEV-2', 'In Progress', 'Dev Complete'),
  buildBoardItem('DEV-3', 'In Progress', 'Dev Complete'),
  buildBoardItem('DEV-4', 'To Do', null),
];

function buildBoardItem(key: string, statusName: string, subStatusValue: string | null): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: '__unmapped__',
    statusName,
    subStatusValue,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
  };
}

function buildVocabulary(overrides: Partial<BoardVocabulary> = {}): BoardVocabulary {
  return {
    teamProfileId: 'team-a',
    columns: [
      { id: 'col-1', name: 'Being coded', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }] },
      { id: 'col-2', name: 'Waiting on SL test', order: 1, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' }] },
    ],
    updatedAt: '2026-08-07T10:00:00.000Z',
    lastSyncedAt: null,
    ...overrides,
  };
}

describe('ColumnVocabularyEditor — the mapping controls', () => {
  it('never offers a free-text box for a Jira status — states are only ever chosen from real ones', () => {
    // Every state a column can claim comes from the board itself, so a mapping Jira would reject
    // cannot be typed in. The only text input here names the COLUMN, which is the team's own words.
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    const textInputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(textInputs.every((input) => /column/i.test(input.getAttribute('aria-label') ?? ''))).toBe(true);
  });

  it('lists the statuses a column claims, since a column can hold several like a Jira board', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getAllByText(/In Progress \/ Dev In Progress/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/In Progress \/ Dev Complete/).length).toBeGreaterThan(0);
  });

  it('lets a claimed status be taken off a column again', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dev In Progress' }));

    expect(onVocabularyChange.mock.calls[0][0].columns[0].mappings).toEqual([]);
  });

  it('lets a column be defined before it is mapped', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.change(screen.getByLabelText('New column name'), { target: { value: 'Ready for release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns[2]).toMatchObject({ name: 'Ready for release', mappings: [] });
  });

  it('says so, and claims status only, when this board exposes no sub-statuses', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor
        allItems={BOARD_ITEMS}
        canShare
        optionSources={{ statusNames: ['To Do'], subStatusValues: [], isSubStatusUnavailable: true }}
        onVocabularyChange={onVocabularyChange}
        vocabulary={buildVocabulary()}
      />,
    );

    expect(screen.getByText(/columns can only be mapped to a status/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Suggest columns from this board' }));
    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns.every((c: { mappings: { subStatusValue: string | null }[] }) =>
      c.mappings.every((mapping) => mapping.subStatusValue === null))).toBe(true);
  });

  it('reorders a column and renumbers so the order stays contiguous', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Waiting on SL test left' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns.map((column: { name: string; order: number }) => [column.name, column.order]))
      .toEqual([['Waiting on SL test', 0], ['Being coded', 1]]);
  });
});

describe('ColumnVocabularyEditor — refusing an ambiguous vocabulary', () => {
  it('refuses to share two columns claiming the same Jira state, and says which', () => {
    const conflicting = buildVocabulary();
    conflicting.columns[1].mappings = [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }];

    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={conflicting} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('One state can only mean one column');
    expect((screen.getByRole('button', { name: 'Share my columns with the team' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses two columns with the same name', () => {
    const conflicting = buildVocabulary();
    conflicting.columns[1].name = 'BEING CODED';

    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={conflicting} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('both called');
  });
});

describe('ColumnVocabularyEditor — sharing', () => {
  it('says when the columns were last shared, so a stale copy is detectable', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByText(/never shared with the team/)).toBeTruthy();
  });

  it('says plainly that sharing is unavailable when the team has no shared workspace', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare={false} optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByText(/no shared ART workspace configured/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share my columns with the team' })).toBeNull();
  });

  it('lists what a pull would change BEFORE anything changes', () => {
    const remote = buildVocabulary({
      columns: [{ id: 'col-1', name: 'In development', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }] }],
    });

    render(
      <ColumnVocabularyEditor
        allItems={BOARD_ITEMS}
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
    const remote = buildVocabulary({ columns: [{ id: 'col-1', name: 'In development', order: 0, mappings: [] }] });

    render(
      <ColumnVocabularyEditor
        allItems={BOARD_ITEMS}
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
        allItems={BOARD_ITEMS}
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

describe('ColumnVocabularyEditor — starting from what is really there', () => {
  it('offers to build columns from the states the board is actually in', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByRole('button', { name: 'Suggest columns from this board' })).toBeTruthy();
    // Three distinct state combinations across the four issues.
    expect(screen.getByText(/3 found/)).toBeTruthy();
  });

  it('builds one mapped column per real state, busiest first, ready to rename', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={onVocabularyChange} vocabulary={buildVocabulary()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Suggest columns from this board' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns).toHaveLength(3);
    // "Dev Complete" holds two issues, so it leads.
    expect(nextVocabulary.columns[0].mappings[0]).toEqual({ jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' });
    expect(nextVocabulary.columns.every((column: { mappings: unknown[] }) => column.mappings.length > 0)).toBe(true);
  });

  it('maps suggestions on status alone when this instance has no sub-status field', () => {
    const onVocabularyChange = vi.fn();
    render(
      <ColumnVocabularyEditor
        allItems={BOARD_ITEMS}
        canShare
        onVocabularyChange={onVocabularyChange}
        optionSources={{ statusNames: ['To Do'], subStatusValues: [], isSubStatusUnavailable: true }}
        vocabulary={buildVocabulary()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Suggest columns from this board' }));

    const [nextVocabulary] = onVocabularyChange.mock.calls[0];
    expect(nextVocabulary.columns.every((c: { mappings: [{ subStatusValue: string | null }] }) => c.mappings[0].subStatusValue === null)).toBe(true);
  });
});

describe('ColumnVocabularyEditor — live feedback while mapping', () => {
  it('says how many issues each mapped column is holding right now', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    // "Being coded" = In Progress / Dev In Progress → 1 issue. "Waiting on SL test" → 2.
    expect(screen.getByText('1 issues here now')).toBeTruthy();
    expect(screen.getByText('2 issues here now')).toBeTruthy();
  });

  it('flags a column that would catch nothing, which is nearly always a mistake', () => {
    const wrongMapping = buildVocabulary();
    wrongMapping.columns[0].mappings = [{ jiraStatusName: 'Accepted', subStatusValue: null }];

    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={wrongMapping} />,
    );

    expect(screen.getByText('0 issues here now')).toBeTruthy();
  });

  it('says a column claiming no status holds nothing, rather than showing a bare zero', () => {
    const unmapped = buildVocabulary();
    unmapped.columns[0].mappings = [];

    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={unmapped} />,
    );

    expect(screen.getByText('no statuses — holds nothing')).toBeTruthy();
  });
});

describe('ColumnVocabularyEditor — sharing says what it does', () => {
  it('names the share action in plain terms rather than "Publish"', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByRole('button', { name: 'Share my columns with the team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Get the team's columns" })).toBeTruthy();
  });

  it('explains what each of the two actions actually does', () => {
    render(
      <ColumnVocabularyEditor allItems={BOARD_ITEMS} canShare optionSources={OPTION_SOURCES} onVocabularyChange={vi.fn()} vocabulary={buildVocabulary()} />,
    );

    expect(screen.getByText(/sends the columns above to everyone on this team/)).toBeTruthy();
    expect(screen.getByText(/shows you the differences before anything changes/)).toBeTruthy();
  });
});
