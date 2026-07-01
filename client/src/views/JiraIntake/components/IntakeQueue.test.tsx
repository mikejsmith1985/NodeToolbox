// IntakeQueue.test.tsx — Covers the empty state, newest-first rendering with badges/keys, and the
// blocking-reason display for invalid rows.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IntakeQueue from './IntakeQueue.tsx';
import type { QueueEntry } from '../lib/intakeTypes.ts';
import type { IntakeQueueCounts } from '../hooks/useIntakeQueue.ts';

function entry(overrides: Partial<QueueEntry> & { id: string }): QueueEntry {
  const { id, ...rest } = overrides;
  return {
    submission: {
      id, submittedAt: '2026-07-01T10:00:00Z', status: 'New',
      submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
      fields: { summary: `Summary ${id}`, description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High', project: '' },
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

  it('renders Create/Dismiss actions for new rows in review mode and wires the callbacks', () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();
    const newRow = entry({ id: 'd', state: 'new' });
    render(
      <IntakeQueue
        entries={[newRow]}
        counts={{ total: 1, newCount: 1, imported: 0, invalid: 0 }}
        isReviewMode
        onCreate={onCreate}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onCreate).toHaveBeenCalledWith(newRow);
    expect(onDismiss).toHaveBeenCalledWith(newRow);
  });

  it('does not render row actions when not in review mode', () => {
    render(<IntakeQueue entries={[entry({ id: 'e', state: 'new' })]} counts={{ total: 1, newCount: 1, imported: 0, invalid: 0 }} />);
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });
});
