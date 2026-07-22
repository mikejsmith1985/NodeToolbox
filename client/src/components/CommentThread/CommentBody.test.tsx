// CommentBody.test.tsx — Unit tests for rendering a comment body with its mentions resolved to names.
//
// The important assertions here are the two the spec is most easily broken on: a mention that is
// merely still loading must never be presented as one that cannot be identified (FR-005a), and
// swapping a name in must not disturb the prose around it (FR-005b).

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import CommentBody from './CommentBody.tsx';

const CLOUD_MENTION_BODY = 'Hey [~accountid:557058:ab-12] please review';
const CLOUD_DIRECTORY_KEY = 'accountId:557058:ab-12';

/** Reads the rendered mention element, which carries its resolution status as a data attribute. */
function readMentionElement(): HTMLElement {
  const mentionElement = document.querySelector('[data-mention-status]');
  if (!mentionElement) {
    throw new Error('No mention element rendered');
  }
  return mentionElement as HTMLElement;
}

beforeEach(() => {
  useMentionDirectoryStore.setState({ entriesByIdentifier: {} });
});

describe('CommentBody', () => {
  it('renders a plain comment unchanged', () => {
    render(<CommentBody body="just a normal comment" />);

    expect(screen.getByText('just a normal comment')).toBeInTheDocument();
  });

  it('renders a resolved mention as the person display name, never the raw identifier', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'resolved', displayName: 'Jane Doe' } },
    });

    const { container } = render(<CommentBody body={CLOUD_MENTION_BODY} />);

    expect(screen.getByText('@Jane Doe')).toBeInTheDocument();
    expect(container.textContent).not.toContain('accountid:');
    expect(container.textContent).toBe('Hey @Jane Doe please review');
  });

  it('renders the neutral placeholder when a person cannot be identified', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'unresolvable' } },
    });

    render(<CommentBody body={CLOUD_MENTION_BODY} />);

    expect(screen.getByText('@unknown user')).toBeInTheDocument();
  });

  it('distinguishes a still-loading mention from an unidentifiable one', () => {
    // FR-005a — "slow" and "cannot be identified" are different facts. This test fails if the two
    // states are ever collapsed onto one appearance.
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'pending' } },
    });

    const { container } = render(<CommentBody body={CLOUD_MENTION_BODY} />);

    expect(readMentionElement().dataset.mentionStatus).toBe('pending');
    expect(container.textContent).not.toContain('@unknown user');
  });

  it('treats a mention with no directory entry yet as pending, not unidentifiable', () => {
    render(<CommentBody body={CLOUD_MENTION_BODY} />);

    expect(readMentionElement().dataset.mentionStatus).toBe('pending');
  });

  it('leaves the surrounding prose untouched when a name arrives', () => {
    // FR-005b — only the mention element may change during the swap.
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'pending' } },
    });
    const { container, rerender } = render(<CommentBody body={CLOUD_MENTION_BODY} />);

    const readSiblingText = () => Array.from(container.querySelectorAll('[data-mention-sibling]'))
      .map((node) => node.textContent);
    const siblingTextBefore = readSiblingText();

    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'resolved', displayName: 'Jane Doe' } },
    });
    rerender(<CommentBody body={CLOUD_MENTION_BODY} />);

    expect(siblingTextBefore).toEqual(['Hey ', ' please review']);
    expect(readSiblingText()).toEqual(siblingTextBefore);
    expect(readMentionElement().dataset.mentionStatus).toBe('resolved');
  });

  it('renders a mention carried in an ADF body instead of dropping it', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'resolved', displayName: 'Jane Doe' } },
    });
    const adfBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hey ' },
            { type: 'mention', attrs: { id: '557058:ab-12', text: '@Jane Doe' } },
            { type: 'text', text: ' please review' },
          ],
        },
      ],
    };

    const { container } = render(<CommentBody body={adfBody} />);

    expect(container.textContent).toBe('Hey @Jane Doe please review');
  });

  it('renders each of several mentions with its own name', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: {
        'name:jsmith': { status: 'resolved', displayName: 'Jane Smith' },
        'name:bwilson': { status: 'resolved', displayName: 'Bob Wilson' },
      },
    });

    const { container } = render(<CommentBody body="[~jsmith] and [~bwilson] please" />);

    expect(container.textContent).toBe('@Jane Smith and @Bob Wilson please');
  });

  it('marks a mention of the current user so it stands out', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'resolved', displayName: 'Jane Doe' } },
    });

    render(<CommentBody body={CLOUD_MENTION_BODY} currentUserDirectoryKeys={[CLOUD_DIRECTORY_KEY]} />);

    expect(readMentionElement().dataset.mentionSelf).toBe('true');
  });

  it('does not mark a mention of someone else as a self-mention', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { [CLOUD_DIRECTORY_KEY]: { status: 'resolved', displayName: 'Jane Doe' } },
    });

    render(<CommentBody body={CLOUD_MENTION_BODY} currentUserDirectoryKeys={['name:someone-else']} />);

    expect(readMentionElement().dataset.mentionSelf).toBeUndefined();
  });
});
