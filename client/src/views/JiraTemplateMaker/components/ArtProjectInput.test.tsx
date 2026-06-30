// ArtProjectInput.test.tsx — Component test: ART suggestions + free key search + normalization.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ArtProjectInput from './ArtProjectInput.tsx';

describe('ArtProjectInput', () => {
  it('offers the ART project keys as datalist suggestions', () => {
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT', 'DENP']} onChange={vi.fn()} />);
    const optionValues = Array.from(document.querySelectorAll('datalist option')).map((option) => (option as HTMLOptionElement).value);
    expect(optionValues).toEqual(['ENFCT', 'DENP']);
  });

  it('lets the user search/enter any key and normalizes it to uppercase', () => {
    const onChange = vi.fn();
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT']} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: ' abc ' } });
    expect(onChange).toHaveBeenCalledWith('ABC');
  });

  it('explains there are no ART projects when none are configured', () => {
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no ART projects configured/i)).toBeInTheDocument();
  });
});
