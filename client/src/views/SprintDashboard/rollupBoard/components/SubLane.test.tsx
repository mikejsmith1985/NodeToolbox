// SubLane.test.tsx — Proves another discipline's band names itself in text, cannot be dragged, says
// so before anybody tries, and still appears when its Feature could not be read.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SubLane, describeSubLaneSummary } from './SubLane.tsx';
import { buildRenderedColumns } from '../boardColumns.ts';
import { buildColumnTracks } from '../columnTrackLayout.ts';
import type { BoardVocabulary, DisciplineProjects, RollupBoardItem, SubLane as SubLaneModel } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [{ id: 'col-qa', name: 'SL Testing', order: 0, mappings: [{ jiraStatusName: 'Testing', subStatusValue: null }] }],
  updatedAt: '',
  lastSyncedAt: null,
};
const COLUMNS = buildRenderedColumns(VOCABULARY);
/** The same object the board builds, so the tests exercise the real layout path. */
const COLUMN_TRACKS = buildColumnTracks(COLUMNS, new Set(), '136px');

const QE: DisciplineProjects = { name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['QEINT'] };

function buildItem(key: string): RollupBoardItem {
  return {
    key,
    columnId: 'col-qa',
    parentKey: null,
    summary: `${key} summary`,
    storyPoints: null,
    typeBucket: 'story',
    typeName: 'Story',
    assigneeDisplayName: null,
    fixVersionNames: [],
    statusName: 'Testing',
    subStatusValue: null,
    featureKey: 'QEINT-610',
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
    route: { steps: [], featureKey: 'QEINT-610', precedenceRank: null, unchosenCandidates: [], notes: [] },
    issue: { key, fields: { status: { statusCategory: { name: 'In Progress' } }, priority: { name: 'High' } } },
  } as unknown as RollupBoardItem;
}

function buildSubLane(overrides: Partial<SubLaneModel> = {}): SubLaneModel {
  const items = overrides.items ?? [buildItem('QEINT-700')];
  return {
    discipline: QE,
    cloneFeatureKey: 'QEINT-610',
    cloneFeatureIssue: { id: 'QEINT-610', key: 'QEINT-610', fields: { summary: 'QE copy' } } as unknown as JiraIssue,
    toneIndex: 1,
    isInferredMatch: false,
    cellsByColumnId: { 'col-qa': { containers: [], looseItems: items } },
    items,
    isCollapsed: false,
    matchedItemCount: items.length,
    totalItemCount: items.length,
    lookupFailures: [],
    ...overrides,
  };
}

function renderSubLane(subLane: SubLaneModel = buildSubLane()) {
  const collapseRequests: string[] = [];
  render(
    <SubLane
      columns={COLUMNS}
      columnTracks={COLUMN_TRACKS}
      onToggleCollapsed={(key) => collapseRequests.push(key)}
      subLane={subLane}
    />,
  );
  return collapseRequests;
}

describe('SubLane', () => {
  it('names the discipline in text, never by colour alone', () => {
    // S-01 / FR-004: a board read by somebody who cannot distinguish two tones must still be readable.
    renderSubLane();

    expect(screen.getByText('QE')).toBeTruthy();
    expect(screen.getByText('QEINT-610')).toBeTruthy();
  });

  it('carries its discipline tone as data, leaving the palette to the stylesheet', () => {
    renderSubLane();

    expect(screen.getByTestId('rollup-sub-lane-QEINT-610').getAttribute('data-tone')).toBe('1');
  });

  it('says it is read-only before anybody tries to move a card', () => {
    // S-03 / FR-006a: a restriction discovered by a card that snaps back is worse than one never offered.
    renderSubLane();

    expect(screen.getByText('read-only here')).toBeTruthy();
  });

  it('gives its cards no drag handle at all', () => {
    // S-02 / R-005: gated at the hook, not filtered at the drop.
    renderSubLane();

    const card = screen.getByTestId('rollup-card-QEINT-700');
    expect(card.getAttribute('draggable')).not.toBe('true');
    expect(card.hasAttribute('aria-roledescription')).toBe(false);
  });

  it('still renders a band for a clone that could not be read', () => {
    // S-05 / FR-010: an absent band must mean "no clone", never "a clone we failed to read".
    renderSubLane(buildSubLane({ cloneFeatureIssue: null }));

    // Said twice on purpose: once in the one-line summary a collapsed band shows, and once in full
    // when the band is open. Both have to survive, because either alone leaves a state unexplained.
    expect(screen.getAllByText(/could not be read/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/may not have permission/)).toBeTruthy();
  });

  it('marks a clone matched by name as an inference rather than a fact', () => {
    renderSubLane(buildSubLane({ isInferredMatch: true }));

    expect(screen.getByText(/matched by name/)).toBeTruthy();
  });

  it('does not claim an inference when the clone link was real', () => {
    renderSubLane();

    expect(screen.queryByText(/matched by name/)).toBeNull();
  });

  it('can be collapsed and expanded by the discipline that owns it', () => {
    const collapseRequests = renderSubLane();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse QE' }));

    expect(collapseRequests).toEqual(['QEINT-610']);
  });

  it('draws no cards while collapsed, so three disciplines do not treble the board height', () => {
    renderSubLane(buildSubLane({ isCollapsed: true }));

    expect(screen.queryByTestId('rollup-card-QEINT-700')).toBeNull();
    // The band itself stays, because a collapsed discipline is still a discipline.
    expect(screen.getByText('QE')).toBeTruthy();
  });
});

describe('describeSubLaneSummary', () => {
  it('names what it searched, not just that it found nothing', () => {
    // An empty band has two explanations, and asserting only the flattering one is how the real cause
    // stayed hidden twice: the discipline may link its work by a field nobody checked.
    const summary = describeSubLaneSummary(buildSubLane({ items: [], matchedItemCount: 0, totalItemCount: 0 }));

    expect(summary).toContain('QEINT-610');
    expect(summary).toContain('Feature Link');
    expect(summary).toContain('Parent Link');
  });

  it('says the copy could not be read, which is a different problem from having no work', () => {
    expect(describeSubLaneSummary(buildSubLane({ cloneFeatureIssue: null }))).toContain('could not be read');
  });

  it('counts filtered and total separately, so neither number is reused for the other', () => {
    expect(describeSubLaneSummary(buildSubLane({ matchedItemCount: 1, totalItemCount: 4 })))
      .toBe('1 of 4 items match');
  });

  it('gives a plain count when nothing is filtered out', () => {
    expect(describeSubLaneSummary(buildSubLane({ matchedItemCount: 4, totalItemCount: 4 }))).toBe('4 items');
  });
});

describe('a linkage Jira would not answer about', () => {
  it('says the query was refused rather than claiming the discipline has no work', () => {
    // The failure this guards: one unknown field id makes Jira reject the whole query, and swallowing
    // that turned a fixable error into "QE has not broken its work down yet" for three releases.
    const summary = describeSubLaneSummary(buildSubLane({
      items: [], matchedItemCount: 0, totalItemCount: 0,
      lookupFailures: ['Parent Link: Error: 400 Field customfield_10100 does not exist'],
    }));

    expect(summary).toContain('would not answer');
    expect(summary).toContain('customfield_10100');
    expect(summary).not.toContain('has not broken its work down');
  });

  it('reports a normal count when nothing was refused', () => {
    const summary = describeSubLaneSummary(buildSubLane({ lookupFailures: [] }));

    expect(summary).toBe('1 item');
  });
});
