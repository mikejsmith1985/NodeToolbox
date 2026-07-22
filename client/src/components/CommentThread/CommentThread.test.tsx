// CommentThread.test.tsx — Unit tests for the shared scrollable comment-history presentation.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraComment } from '../../types/jira.ts';
import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import CommentThread from './CommentThread.tsx';
import styles from './CommentThread.module.css';

// The thread looks up the names of anyone mentioned but not already known; keep that inert here so
// these tests exercise rendering rather than the network.
vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn().mockResolvedValue(null),
  getMyself: vi.fn().mockResolvedValue({ displayName: 'Reader', accountId: 'reader-1' }),
}));

// Provided newest-first, exactly as the hook orders them.
const COMMENTS: JiraComment[] = [
  { id: '3', author: { displayName: 'Cyd' }, body: 'newest body', created: '2025-01-03T00:00:00.000Z' },
  { id: '2', author: { displayName: 'Ben' }, body: 'middle body', created: '2025-01-02T00:00:00.000Z' },
  { id: '1', author: { displayName: 'Ada' }, body: 'oldest body', created: '2025-01-01T00:00:00.000Z' },
];

describe('CommentThread — @-mentions', () => {
  beforeEach(() => {
    useMentionDirectoryStore.setState({ entriesByIdentifier: {} });
  });

  it('renders a mention as the person display name, not the stored identifier', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { 'accountId:557058:ab-12': { status: 'resolved', displayName: 'Jane Doe' } },
    });
    const comments: JiraComment[] = [
      { id: '1', author: { displayName: 'Ada' }, body: 'Hey [~accountid:557058:ab-12] look', created: '2025-01-01T00:00:00.000Z' },
    ];

    const { container } = render(<CommentThread comments={comments} isLoading={false} loadError={null} />);

    expect(container.textContent).toContain('@Jane Doe');
    expect(container.textContent).not.toContain('accountid:');
  });

  it('renders a mention carried in an ADF body instead of dropping the person', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { 'accountId:557058:ab-12': { status: 'resolved', displayName: 'Jane Doe' } },
    });
    const comments: JiraComment[] = [
      {
        id: '1',
        author: { displayName: 'Ada' },
        created: '2025-01-01T00:00:00.000Z',
        body: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hey ' },
              { type: 'mention', attrs: { id: '557058:ab-12', text: '@Jane Doe' } },
              { type: 'text', text: ' look' },
            ],
          }],
        },
      },
    ];

    const { container } = render(<CommentThread comments={comments} isLoading={false} loadError={null} />);

    expect(container.textContent).toContain('@Jane Doe look');
  });

  it('records each comment author, so mentioning them elsewhere needs no extra lookup', () => {
    const comments: JiraComment[] = [
      { id: '1', author: { displayName: 'Jane Doe', accountId: '557058:ab-12' }, body: 'first', created: '2025-01-01T00:00:00.000Z' },
    ];

    render(<CommentThread comments={comments} isLoading={false} loadError={null} />);

    expect(useMentionDirectoryStore.getState().entriesByIdentifier['accountId:557058:ab-12'])
      .toEqual({ status: 'resolved', displayName: 'Jane Doe' });
  });
});

describe('CommentThread', () => {
  it('renders every comment (no cap) in the given order', () => {
    render(<CommentThread comments={COMMENTS} isLoading={false} loadError={null} />);

    const bodies = screen.getAllByText(/body$/).map((node) => node.textContent);
    expect(bodies).toEqual(['newest body', 'middle body', 'oldest body']);
  });

  it('shows the newest comment first (at the top of the list)', () => {
    render(<CommentThread comments={COMMENTS} isLoading={false} loadError={null} />);

    const items = document.querySelectorAll(`.${styles.commentItem}`);
    expect(items[0].textContent).toContain('newest body');
  });

  it('renders author and date for each comment', () => {
    render(<CommentThread comments={COMMENTS} isLoading={false} loadError={null} />);

    expect(screen.getByText('Cyd')).toBeInTheDocument();
    expect(screen.getByText('2025-01-03')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    render(<CommentThread comments={[]} isLoading loadError={null} />);
    expect(screen.getByText(/loading comments/i)).toBeInTheDocument();
  });

  it('shows the error state', () => {
    render(<CommentThread comments={[]} isLoading={false} loadError="nope" />);
    expect(screen.getByText('nope')).toBeInTheDocument();
  });

  it('shows the shared empty state when there are no comments', () => {
    render(<CommentThread comments={[]} isLoading={false} loadError={null} />);
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('renders a single comment in the same scrollable window (no bespoke layout)', () => {
    render(<CommentThread comments={[COMMENTS[0]]} isLoading={false} loadError={null} />);
    expect(document.querySelector(`.${styles.commentList}`)).not.toBeNull();
    expect(document.querySelectorAll(`.${styles.commentItem}`)).toHaveLength(1);
  });
});
