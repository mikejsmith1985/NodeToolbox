// CompositionModeSwitch.test.tsx — The two-way switch renders as a radiogroup of exactly two radios, its
// aria-checked state always matches the current mode, and clicking the other option reports the new mode.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CompositionModeSwitch from './CompositionModeSwitch.tsx';

describe('CompositionModeSwitch', () => {
  it('renders a radiogroup of two radios whose aria-checked matches the current mode', () => {
    render(<CompositionModeSwitch mode="compose" onModeChange={vi.fn()} />);

    const radioGroup = screen.getByRole('radiogroup', { name: 'Composition mode' });
    const radios = screen.getAllByRole('radio');
    expect(radioGroup).toBeInTheDocument();
    expect(radios).toHaveLength(2);

    const composeOption = screen.getByRole('radio', { name: 'Compose one Feature' });
    const intakeOption = screen.getByRole('radio', { name: 'Epic Intake from notes' });
    expect(composeOption).toHaveAttribute('aria-checked', 'true');
    expect(intakeOption).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the intake mode when selected', () => {
    render(<CompositionModeSwitch mode="intake" onModeChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Compose one Feature' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Epic Intake from notes' })).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onModeChange with the clicked mode', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<CompositionModeSwitch mode="compose" onModeChange={onModeChange} />);

    await user.click(screen.getByRole('radio', { name: 'Epic Intake from notes' }));

    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('intake');
  });

  it('never touches the composition draft — switching back reports compose', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<CompositionModeSwitch mode="intake" onModeChange={onModeChange} />);

    await user.click(screen.getByRole('radio', { name: 'Compose one Feature' }));

    expect(onModeChange).toHaveBeenCalledWith('compose');
  });
});
