// IntakeNotesPanel.test.tsx — Start stays disabled until a source is added, pasted notes become a paste source,
// and removing a source takes it back out. File/Confluence readers are not exercised here — only the pasted-text
// path, which needs no mocking of the source readers.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import IntakeNotesPanel from './IntakeNotesPanel.tsx';

async function addPastedNoteSource(user: ReturnType<typeof userEvent.setup>, noteText: string): Promise<void> {
  await user.type(screen.getByLabelText('Pasted notes'), noteText);
  await user.click(screen.getByRole('button', { name: 'Add pasted notes' }));
}

describe('IntakeNotesPanel', () => {
  it('keeps Start disabled until a source has been added', async () => {
    const user = userEvent.setup();
    render(<IntakeNotesPanel onStart={vi.fn()} />);

    const startButton = screen.getByRole('button', { name: 'Start intake' });
    expect(startButton).toBeDisabled();

    await addPastedNoteSource(user, 'Ship the portal');

    expect(startButton).toBeEnabled();
  });

  it('adds the pasted text as a source and clears the textarea', async () => {
    const user = userEvent.setup();
    render(<IntakeNotesPanel onStart={vi.fn()} />);

    await addPastedNoteSource(user, 'Ship the portal');

    const addedSources = screen.getByRole('list', { name: 'Added notes' });
    expect(within(addedSources).getByText('Pasted notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Pasted notes')).toHaveValue('');
  });

  it('calls onStart with a paste source carrying the pasted text', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<IntakeNotesPanel onStart={onStart} />);

    await addPastedNoteSource(user, 'Ship the portal');
    await user.click(screen.getByRole('button', { name: 'Start intake' }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const sources = onStart.mock.calls[0][0] as ReferencedSource[];
    expect(sources).toEqual([expect.objectContaining({ kind: 'paste', text: 'Ship the portal' })]);
  });

  it('removes a source, disabling Start again', async () => {
    const user = userEvent.setup();
    render(<IntakeNotesPanel onStart={vi.fn()} />);

    await addPastedNoteSource(user, 'Ship the portal');
    expect(screen.getByRole('button', { name: 'Start intake' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.queryByRole('list', { name: 'Added notes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start intake' })).toBeDisabled();
  });
});
