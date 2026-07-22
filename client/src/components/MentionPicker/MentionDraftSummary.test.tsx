// MentionDraftSummary.test.tsx — Unit tests for the "Tagging: …" line beneath a comment composer.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import MentionDraftSummary from './MentionDraftSummary.tsx';

beforeEach(() => {
  useMentionDirectoryStore.setState({ entriesByIdentifier: {} });
});

describe('MentionDraftSummary', () => {
  it('names everyone the draft tags, so the author can read back who they picked', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: {
        'name:jsmith': { status: 'resolved', displayName: 'Jane Smith' },
        'name:bwilson': { status: 'resolved', displayName: 'Bob Wilson' },
      },
    });

    render(<MentionDraftSummary draftText="Thanks [~jsmith] and [~bwilson] for the help" />);

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
  });

  it('renders nothing at all when the draft tags nobody', () => {
    const { container } = render(<MentionDraftSummary draftText="just a plain comment" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty draft', () => {
    const { container } = render(<MentionDraftSummary draftText="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a still-resolving person as loading, not as unidentifiable', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { 'name:jsmith': { status: 'pending' } },
    });

    const { container } = render(<MentionDraftSummary draftText="Thanks [~jsmith]" />);

    expect(container.textContent).not.toContain('unknown user');
  });

  it('lists the same person once even if the draft tags them twice', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { 'name:jsmith': { status: 'resolved', displayName: 'Jane Smith' } },
    });

    render(<MentionDraftSummary draftText="[~jsmith] and again [~jsmith]" />);

    expect(screen.getAllByText('Jane Smith')).toHaveLength(1);
  });
});
