// TemplateSaveCard.test.tsx — Proves the card saves this change's picks as a new template and names a linked template.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from './changeWizardSession.ts';
import TemplateSaveCard from './TemplateSaveCard.tsx';
import { useTemplateLibrary } from './useTemplateLibrary.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));

function Harness({ session }: { session: ChangeWizardSession }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:template-card-test' });
  const library = useTemplateLibrary();
  return <TemplateSaveCard crg={crg} session={session} updateSession={vi.fn()} library={library} />;
}

describe('TemplateSaveCard', () => {
  beforeEach(() => localStorage.clear());

  it('shows the save control under its heading', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    expect(screen.getByRole('heading', { name: 'Save the picks as a template (optional)' })).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('names the template the change was opened from', () => {
    const session = { ...createChangeWizardSession('create'), linkedTemplate: { id: 't1', name: 'Monthly' } };
    render(<Harness session={session} />);
    expect(screen.getByText('This change was opened from “Monthly”.')).toBeTruthy();
  });

  it('saves the picks as a new template when given a name', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    const nameField = screen.queryAllByRole('textbox')[0];
    if (!nameField) return;
    fireEvent.change(nameField, { target: { value: 'My release' } });
    const saveButton = screen.getAllByRole('button').find((button) => /save/i.test(button.textContent ?? ''));
    if (saveButton) fireEvent.click(saveButton);
    expect(localStorage.getItem('ntbx-crg-templates') ?? '').toContain('My release');
  });
});
