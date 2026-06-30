// FieldValueInput.test.tsx — Component test: dropdown offers only real allowedValues (AS-3).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FieldDescriptor } from '../lib/templateTypes.ts';
import FieldValueInput from './FieldValueInput.tsx';

const CHOICE_DESCRIPTOR: FieldDescriptor = {
  fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice',
  isSupported: true, allowedValues: [{ id: '1', label: 'High' }, { id: '2', label: 'Low' }], hasDefault: false,
};

describe('FieldValueInput (choice)', () => {
  it('offers only the field\'s real allowed values and emits the selected option id', () => {
    const onChange = vi.fn();
    render(<FieldValueInput descriptor={CHOICE_DESCRIPTOR} value={undefined} onChange={onChange} />);

    const select = screen.getByRole('combobox');
    // Only the placeholder + the two allowed values are present (no free-typed values possible).
    const optionLabels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
    expect(optionLabels).toEqual(['— Select —', 'High', 'Low']);

    fireEvent.change(select, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ id: '2' });
  });

  it('renders a labels input that dedupes case-sensitively', () => {
    const onChange = vi.fn();
    const labelsDescriptor: FieldDescriptor = {
      fieldId: 'labels', name: 'Labels', required: false, internalType: 'labels', isSupported: true, hasDefault: false,
    };
    render(<FieldValueInput descriptor={labelsDescriptor} value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('comma,separated,labels'), { target: { value: 'Ops,Ops,ops' } });
    expect(onChange).toHaveBeenCalledWith(['Ops', 'ops']);
  });
});
