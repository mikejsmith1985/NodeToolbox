// SurfacePicker.test.tsx — Verifies the Custom-JQL add panel: selection, dedup, safe failure.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUsePickerCandidates } = vi.hoisted(() => ({ mockUsePickerCandidates: vi.fn() }));
vi.mock('./usePickerCandidates.ts', () => ({ usePickerCandidates: mockUsePickerCandidates }));

import { SurfacePicker } from './SurfacePicker.tsx';

function ready(keys: string[]) {
  return { status: 'ready', jqlItems: keys.map((key) => ({ feature: { key, summary: key, status: 'To Do', health: 'gray' }, totalChildCount: 1 })), error: null };
}

function renderPicker(overrides: Partial<Parameters<typeof SurfacePicker>[0]> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<SurfacePicker piName="PI 26.3" projectKey="ENCUC" onCanvasKeys={new Set()} defaultJql="project = X" onAdd={onAdd} onClose={onClose} {...overrides} />);
  return { onAdd, onClose };
}

describe('SurfacePicker (Add via JQL)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists query matches and adds only the selected', () => {
    mockUsePickerCandidates.mockReturnValue(ready(['C-1', 'C-2']));
    const { onAdd, onClose } = renderPicker();

    fireEvent.click(screen.getByLabelText('Select C-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(onAdd).toHaveBeenCalledWith(['C-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables already-on-canvas rows (additive dedup)', () => {
    mockUsePickerCandidates.mockReturnValue(ready(['C-1', 'C-2']));
    const { onAdd } = renderPicker({ onCanvasKeys: new Set(['C-1']) });

    expect((screen.getByLabelText('Select C-1') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(onAdd).toHaveBeenCalledWith(['C-2']);
  });

  it('shows an error and adds nothing when the query fails (safe failure)', () => {
    mockUsePickerCandidates.mockReturnValue({ status: 'error', jqlItems: [], error: 'jql error 400' });
    const { onAdd } = renderPicker();
    expect(screen.getByRole('alert')).toHaveTextContent('jql error 400');
    expect(screen.queryByLabelText(/Select /)).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
