// IntakeAnnotatedNotes.test.tsx — The panel shows the notes with Epic keys and copies them with the keys as links.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import { startEpicIntake } from '../startIntake.ts';
import IntakeAnnotatedNotes from './IntakeAnnotatedNotes.tsx';

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;

afterEach(() => {
  (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  if (originalClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
});

function buildIntake() {
  const source: ReferencedSource = { kind: 'paste', id: 'p', label: 'Notes', text: '•\tPaperless Options' };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: '2026-09-22T00:00:00.000Z', mintId: () => 'i' });
}

describe('IntakeAnnotatedNotes', () => {
  it('shows the notes with each item\'s outcome beside it', () => {
    render(<IntakeAnnotatedNotes intake={buildIntake()} jiraBaseUrl="https://jira.example.com" />);
    expect(screen.getByRole('textbox', { name: 'Notes with Epic keys' })).toHaveValue('•\tPaperless Options — not decided yet');
  });

  it('copies both an HTML and a plain-text flavour', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.fn(async () => {});
    const clipboardItemConstructor = vi.fn(function ClipboardItemMock(this: { parts: unknown }, parts: unknown) {
      this.parts = parts;
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = clipboardItemConstructor;
    Object.defineProperty(navigator, 'clipboard', { value: { write: clipboardWrite }, configurable: true });

    render(<IntakeAnnotatedNotes intake={buildIntake()} jiraBaseUrl="https://jira.example.com" />);
    await user.click(screen.getByRole('button', { name: /Copy notes/ }));

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(Object.keys(clipboardItemConstructor.mock.calls[0][0] as Record<string, Blob>)).toEqual(['text/html', 'text/plain']);
    expect(await screen.findByText('✓ Copied')).toBeInTheDocument();
  });
});
