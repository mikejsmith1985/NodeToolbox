// LabelsInput.test.tsx — Component test for case-sensitive dedupe + invalid-label messaging.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LabelsInput from './LabelsInput.tsx';

describe('LabelsInput', () => {
  it('dedupes case-sensitively and emits the cleaned label list', () => {
    const onChange = vi.fn();
    render(<LabelsInput id="labels" value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('comma,separated,labels'), { target: { value: 'Ops,Ops,ops' } });
    expect(onChange).toHaveBeenLastCalledWith(['Ops', 'ops']);
  });

  it('flags labels containing spaces and excludes them from the emitted list', () => {
    const onChange = vi.fn();
    render(<LabelsInput id="labels" value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('comma,separated,labels'), { target: { value: 'good,has space' } });
    expect(onChange).toHaveBeenLastCalledWith(['good']);
    expect(screen.getByRole('alert')).toHaveTextContent(/can.t contain spaces/i);
    expect(screen.getByRole('alert')).toHaveTextContent('has space');
  });
});
