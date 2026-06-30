// ScopedFieldPicker.test.tsx — Component test: supported fields addable, unsupported gated.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FieldDescriptor } from '../lib/templateTypes.ts';
import ScopedFieldPicker from './ScopedFieldPicker.tsx';

const SUPPORTED: FieldDescriptor = {
  fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice',
  isSupported: true, allowedValues: [{ id: '1', label: 'High' }], hasDefault: false,
};
const UNSUPPORTED: FieldDescriptor = {
  fieldId: 'cf_cascade', name: 'Cascade', required: false, internalType: null,
  isSupported: false, hasDefault: false,
};

describe('ScopedFieldPicker', () => {
  it('lets the user add a supported field but disables unsupported ones', () => {
    const onAdd = vi.fn();
    render(<ScopedFieldPicker descriptors={[SUPPORTED, UNSUPPORTED]} addedFieldIds={[]} onAdd={onAdd} />);

    expect(screen.getByText('unsupported field type')).toBeInTheDocument();

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    // Priority is addable; Cascade's button is disabled.
    const priorityButton = addButtons[0];
    fireEvent.click(priorityButton);
    expect(onAdd).toHaveBeenCalledWith(SUPPORTED);

    const cascadeButton = addButtons[1];
    expect(cascadeButton).toBeDisabled();
  });

  it('shows already-added fields as added and non-clickable', () => {
    const onAdd = vi.fn();
    render(<ScopedFieldPicker descriptors={[SUPPORTED]} addedFieldIds={['priority']} onAdd={onAdd} />);
    const addedButton = screen.getByRole('button', { name: /added/i });
    expect(addedButton).toBeDisabled();
  });
});
