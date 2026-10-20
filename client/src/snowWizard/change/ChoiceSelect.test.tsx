// ChoiceSelect.test.tsx — Proves the dropdown offers only ServiceNow's list, marks required values, and waits for the list.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChoiceSelect from './ChoiceSelect.tsx';

describe('ChoiceSelect', () => {
  it('offers ServiceNow\'s own options and reports the chosen value', () => {
    const onChange = vi.fn();
    render(<ChoiceSelect label="Category" isRequired options={[{ value: 'software', label: 'Software' }]} value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Category (needed)'), { target: { value: 'software' } });
    expect(onChange).toHaveBeenCalledWith('software');
  });

  it('is disabled with a plain note until the list arrives', () => {
    render(<ChoiceSelect label="Impact" options={[]} value="" onChange={vi.fn()} />);
    const select = screen.getByLabelText('Impact') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.getByText('Waiting for ServiceNow\'s list…')).toBeTruthy();
  });

  it('keeps a loaded value that the list does not hold', () => {
    render(<ChoiceSelect label="Type" options={[{ value: 'normal', label: 'Normal' }]} value="legacy" onChange={vi.fn()} />);
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('legacy');
  });
});
