// DateTimeField.test.tsx — Proves a planned date-time is picked as day + hour + minutes, with minutes starting at 00.

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DateTimeField from './DateTimeField.tsx';

/** Holds the value like a real draft does, and reports every change. */
function Harness({ initialValue, onChange }: { initialValue: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initialValue);
  return <DateTimeField label="PRD starts" value={value} onChange={(nextValue) => { setValue(nextValue); onChange(nextValue); }} />;
}

describe('DateTimeField', () => {
  it('builds the value from a day and an hour, with minutes already at 00', () => {
    const onChange = vi.fn();
    render(<Harness initialValue="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('PRD starts day'), { target: { value: '2026-10-24' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('PRD starts hour'), { target: { value: '22' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-24T22:00');
    expect((screen.getByLabelText('PRD starts minutes') as HTMLSelectElement).value).toBe('00');
  });

  it('changes only the part picked', () => {
    const onChange = vi.fn();
    render(<Harness initialValue="2026-10-24T22:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('PRD starts minutes'), { target: { value: '30' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-24T22:30');
  });

  it('shows a value set from outside, such as a template', () => {
    render(<DateTimeField label="PRD ends" value="2026-10-25T01:15" onChange={vi.fn()} />);
    expect((screen.getByLabelText('PRD ends day') as HTMLInputElement).value).toBe('2026-10-25');
    expect((screen.getByLabelText('PRD ends hour') as HTMLSelectElement).value).toBe('01');
    expect((screen.getByLabelText('PRD ends minutes') as HTMLSelectElement).value).toBe('15');
  });
});
