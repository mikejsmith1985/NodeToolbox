// ArtProjectInput.test.tsx — Component test: themed suggestions + free key search + select.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ArtProjectInput from './ArtProjectInput.tsx';

describe('ArtProjectInput', () => {
  it('shows ART project keys as suggestions on focus', () => {
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT', 'DENP']} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByLabelText('Project'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['ENFCT', 'DENP']);
  });

  it('filters suggestions by what is typed and normalizes to uppercase', () => {
    const onChange = vi.fn();
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT', 'DENP']} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'en' } });
    expect(onChange).toHaveBeenCalledWith('EN');
  });

  it('selecting a suggestion reports the chosen key', () => {
    const onChange = vi.fn();
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT', 'DENP']} onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText('Project'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'DENP' }));
    expect(onChange).toHaveBeenCalledWith('DENP');
  });

  it('does not render a native datalist (uses a themed dropdown instead)', () => {
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={['ENFCT']} onChange={vi.fn()} />);
    expect(document.querySelector('datalist')).toBeNull();
  });

  it('explains when no ART projects are configured', () => {
    render(<ArtProjectInput id="p" label="Project" value="" artProjectKeys={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no ART projects configured/i)).toBeInTheDocument();
  });
});
