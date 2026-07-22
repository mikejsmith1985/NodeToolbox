// MentionComposer.test.tsx — Unit tests for the comment textarea that supports @-mentions.
//
// This wrapper is what makes every comment box in the app behave the same, so the tests below are
// about the contract each host relies on: the host keeps owning the value, an "@" beginning a word
// offers people, an "@" inside a word never does, and what lands in the box is what will post.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import MentionComposer from './MentionComposer.tsx';

const mockSearchUsers = vi.fn();

vi.mock('../../views/SprintDashboard/featureReviewFixes.ts', () => ({
  searchFeatureReviewUsers: (query: string) => mockSearchUsers(query),
}));

const PICKER_NAME = /people matching/i;

/** Renders the composer as a host would: the host owns the draft, the composer reports changes. */
function renderComposer(initialValue = '') {
  const onChange = vi.fn();
  const view = render(
    <MentionComposer
      onChange={onChange}
      textareaProps={{ 'aria-label': 'Comment' }}
      value={initialValue}
    />,
  );

  // Mirror a controlled host: feed each reported change straight back in as the new value.
  onChange.mockImplementation((nextValue: string) => {
    view.rerender(
      <MentionComposer
        onChange={onChange}
        textareaProps={{ 'aria-label': 'Comment' }}
        value={nextValue}
      />,
    );
  });

  return { onChange, textarea: screen.getByLabelText('Comment') };
}

beforeEach(() => {
  mockSearchUsers.mockReset();
  mockSearchUsers.mockResolvedValue([
    { userIdentifier: 'accountId:557058:ab-12', displayName: 'Jane Doe' },
  ]);
  useMentionDirectoryStore.setState({ entriesByIdentifier: {} });
});

describe('MentionComposer', () => {
  it('reports every keystroke to the host, which keeps owning the draft', async () => {
    const { onChange, textarea } = renderComposer();

    await userEvent.type(textarea, 'hello');

    expect(onChange).toHaveBeenCalled();
    expect(textarea).toHaveValue('hello');
  });

  it('offers people when an @ begins a word', async () => {
    const { textarea } = renderComposer();

    await userEvent.type(textarea, 'thanks @ja');

    expect(await screen.findByRole('listbox', { name: PICKER_NAME })).toBeInTheDocument();
  });

  it('never offers people for an @ inside a word, so an email address is safe to type', async () => {
    const { textarea } = renderComposer();

    await userEvent.type(textarea, 'mail me at mike@example');

    expect(screen.queryByRole('listbox', { name: PICKER_NAME })).not.toBeInTheDocument();
  });

  it('replaces the typed @query with the mention token that will actually post', async () => {
    const { textarea } = renderComposer();

    await userEvent.type(textarea, 'thanks @ja');
    await userEvent.click(await screen.findByText('Jane Doe'));

    expect(textarea).toHaveValue('thanks [~accountid:557058:ab-12] ');
  });

  it('keeps the surrounding sentence intact when inserting mid-draft', async () => {
    const { textarea } = renderComposer();

    // Type the whole sentence, then walk the caret back over " soon" so the half-typed mention —
    // not the end of the draft — is what the picker is offering for.
    await userEvent.type(textarea, 'please review @ja soon');
    await userEvent.keyboard('{ArrowLeft>5/}');

    await userEvent.click(await screen.findByText('Jane Doe'));

    expect(textarea).toHaveValue('please review [~accountid:557058:ab-12]  soon');
  });

  it('closes the picker on Escape and leaves the typed @ as ordinary text', async () => {
    const { textarea } = renderComposer();

    await userEvent.type(textarea, 'thanks @ja');
    expect(await screen.findByRole('listbox', { name: PICKER_NAME })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox', { name: PICKER_NAME })).not.toBeInTheDocument();
    expect(textarea).toHaveValue('thanks @ja');
  });

  it('names who the draft will tag, so the author can read back an opaque token', () => {
    useMentionDirectoryStore.setState({
      entriesByIdentifier: { 'name:jsmith': { status: 'resolved', displayName: 'Jane Smith' } },
    });

    renderComposer('thanks [~jsmith]');

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('forwards host textarea props so each caller keeps its own styling and labelling', () => {
    render(
      <MentionComposer
        onChange={vi.fn()}
        textareaProps={{ 'aria-label': 'Bulk comment text', rows: 7, placeholder: 'Type…' }}
        value=""
      />,
    );

    const textarea = screen.getByLabelText('Bulk comment text');
    expect(textarea).toHaveAttribute('rows', '7');
    expect(textarea).toHaveAttribute('placeholder', 'Type…');
  });
});
