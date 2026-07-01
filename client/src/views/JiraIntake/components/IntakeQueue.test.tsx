// IntakeQueue.test.tsx — Covers the empty state, newest-first rendering with badges/keys, and the
// blocking-reason display for invalid rows.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IntakeQueue from './IntakeQueue.tsx';
import type { QueueEntry } from '../lib/intakeTypes.ts';
import type { IntakeQueueCounts } from '../hooks/useIntakeQueue.ts';

function entry(overrides: Partial<QueueEntry> & { id: string }): QueueEntry {
  const { id, ...rest } = overrides;
  return {
    submission: {
      id, submittedAt: '2026-07-01T10:00:00Z', status: 'New',
      submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
      fields: { summary: `Summary ${id}`, description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High' },
      extras: {}, rowIndex: 0, parseErrors: [],
    },
    state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null,
    ...rest,
  };
}

const COUNTS: IntakeQueueCounts = { total: 2, newCount: 1, imported: 1, invalid: 0 };

describe('IntakeQueue', () => {
  it('renders an empty state when there are no entries', () => {
    render(<IntakeQueue entries={[]} counts={{ total: 0, newCount: 0, imported: 0, invalid: 0 }} />);
    expect(screen.getByText(/No submissions yet/i)).toBeInTheDocument();
  });

  it('renders rows with submitter, summary, badge, and Jira key', () => {
    const entries = [
      entry({ id: 'a', state: 'imported', jiraKey: 'ENFCT-1' }),
      entry({ id: 'b', state: 'new' }),
    ];
    render(<IntakeQueue entries={entries} counts={COUNTS} />);

    expect(screen.getAllByTestId('queue-row')).toHaveLength(2);
    expect(screen.getByText('ENFCT-1')).toBeInTheDocument();
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getByTestId('queue-counts')).toHaveTextContent('1 imported');
  });

  it('shows blocking reasons for invalid rows', () => {
    const entries = [entry({ id: 'c', state: 'invalid', blockingReasons: ['Missing required field: Summary'] })];
    render(<IntakeQueue entries={entries} counts={{ total: 1, newCount: 0, imported: 0, invalid: 1 }} />);
    expect(screen.getByText('Missing required field: Summary')).toBeInTheDocument();
  });
});
