// IntakeItemsTable.test.tsx — Every decision's badge names who settled it and why, "Open" while undecided, a dash
// where a decision does not apply, a failed search says so in words, and set-aside lines keep their reason.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type IntakeItem,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { settleDecision } from '../intakeChecklist.ts';
import IntakeItemsTable from './IntakeItemsTable.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function buildLine(lineNumber: number, text: string, outlineLevel: 0 | 1 | 2 = 1): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel };
}

function buildIntake(items: IntakeItem[], lines: SourceLine[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines,
    items,
    setAsideLines: [{ lineNumber: 3, reason: 'headingOrProse', settledBy: 'rule', note: null }],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

describe('IntakeItemsTable', () => {
  it('shows each badge with its "who decided" label and the reason in its accessible name', () => {
    const decidedItem = createIntakeItem(1, 'Member portal work', [1]);
    decidedItem.decisions.kind = settleDecision(decidedItem.decisions.kind, 'work', 'rule', 'Notes say work');
    decidedItem.decisions.owner = settleDecision(decidedItem.decisions.owner, 'enrollment', 'ai', 'Estimated Enrollment share 70%');
    decidedItem.decisions.label = settleDecision(decidedItem.decisions.label, 'Roadmap', 'po', 'Chosen by the PO');

    const intake = buildIntake([decidedItem], [buildLine(1, 'Member portal work'), buildLine(2, 'Other line'), buildLine(3, 'A stray heading', 0)]);
    render(<IntakeItemsTable intake={intake} />);

    expect(screen.getByLabelText('Rule: Notes say work')).toHaveTextContent('Rule');
    expect(screen.getByLabelText('Suggested: Estimated Enrollment share 70%')).toHaveTextContent('Suggested');
    expect(screen.getByLabelText('You: Chosen by the PO')).toHaveTextContent('You');
  });

  it('shows "Open" for a decision still open, with its hint as the title', () => {
    const openItem = createIntakeItem(1, 'Member portal work', [1]);
    const intake = buildIntake([openItem], [buildLine(1, 'Member portal work')]);
    const { container } = render(<IntakeItemsTable intake={intake} />);

    const openBadges = screen.getAllByText('Open');
    expect(openBadges.length).toBeGreaterThan(0);
    const kindOpenBadge = container.querySelector('td span[title]');
    expect(kindOpenBadge).toHaveAttribute('title', 'Not decided yet');
  });

  it('shows a dash for a decision that does not apply, with the reason as its title', () => {
    const notWorkItem = createIntakeItem(1, 'A risk note', [1]);
    notWorkItem.decisions.kind = settleDecision(notWorkItem.decisions.kind, 'risk', 'rule', 'Notes say risk');
    notWorkItem.decisions.owner = { state: 'notApplicable', reason: 'Not work (risk)' };

    const intake = buildIntake([notWorkItem], [buildLine(1, 'A risk note')]);
    render(<IntakeItemsTable intake={intake} />);

    const row = screen.getByText('A risk note').closest('tr');
    expect(row).not.toBeNull();
    const dash = within(row as HTMLElement).getByTitle('Not work (risk)');
    expect(dash).toHaveTextContent('—');
  });

  it('reports a failed search in words rather than a candidate count', () => {
    const failedItem = createIntakeItem(1, 'Core integration', [1]);
    failedItem.searchStatus = 'failed';
    failedItem.searchFailureReason = 'Jira request timed out';

    const intake = buildIntake([failedItem], [buildLine(1, 'Core integration')]);
    render(<IntakeItemsTable intake={intake} />);

    expect(screen.getByText('Not checked — Jira request timed out')).toBeInTheDocument();
  });

  it('groups the set-aside lines under their own reason label', () => {
    const item = createIntakeItem(1, 'Member portal work', [1]);
    const intake = buildIntake([item], [buildLine(1, 'Member portal work'), buildLine(3, 'A stray heading', 0)]);
    render(<IntakeItemsTable intake={intake} />);

    expect(screen.getByText('1 line(s) set aside')).toBeInTheDocument();
    expect(screen.getByText(/A stray heading — Heading or prose/)).toBeInTheDocument();
  });
});
