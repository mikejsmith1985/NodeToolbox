// ChecklistSyntaxProbePanel.test.tsx — Proves the experiment is offered honestly and safely.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChecklistSyntaxProbePanel } from './ChecklistSyntaxProbePanel.tsx';

describe('ChecklistSyntaxProbePanel', () => {
  it('says up front that it changes a real checklist item', () => {
    // A tool that quietly edits somebody's data to learn something is not one anybody should trust.
    render(<ChecklistSyntaxProbePanel onFormsDiscovered={vi.fn()} writeFieldId="customfield_1" />);

    expect(screen.getByText(/changes a real checklist item and puts it/)).toBeTruthy();
  });

  it('will not run before a write field has been named', () => {
    // The syntax is a property of the field, so probing without one would answer nothing.
    render(<ChecklistSyntaxProbePanel onFormsDiscovered={vi.fn()} writeFieldId="" />);

    expect(screen.getByRole('button', { name: /Run the experiment/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Name the field to write through first/)).toBeTruthy();
  });

  it('will not run without an issue to experiment on', () => {
    render(<ChecklistSyntaxProbePanel onFormsDiscovered={vi.fn()} writeFieldId="customfield_1" />);

    expect(screen.getByRole('button', { name: /Run the experiment/ }).hasAttribute('disabled')).toBe(true);
  });
});
