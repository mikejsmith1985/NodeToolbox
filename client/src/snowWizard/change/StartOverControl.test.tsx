// StartOverControl.test.tsx — Proves "Start over" asks once on the page, can be called off, and names changes that stay in ServiceNow.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import StartOverControl from './StartOverControl.tsx';

describe('StartOverControl', () => {
  it('asks on the page before starting over, and "Keep going" calls it off', () => {
    const onStartOver = vi.fn();
    render(<StartOverControl createdChangeNumbers={[]} onStartOver={onStartOver} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('alertdialog', { name: 'Start over?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));
    expect(onStartOver).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start over' }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  it('says changes already made stay in ServiceNow, and how to pick them up again', () => {
    render(<StartOverControl createdChangeNumbers={['CHG1', 'CHG2']} onStartOver={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText(/CHG1 and CHG2 stay in ServiceNow — starting over does not delete them/)).toBeTruthy();
  });
});
