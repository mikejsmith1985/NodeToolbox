// SurfacePicker.test.tsx — Verifies grouped candidates, deliberate selection, additive dedup,
// custom-JQL source, safe failure, and the no-team fallback.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUsePickerCandidates } = vi.hoisted(() => ({ mockUsePickerCandidates: vi.fn() }));
vi.mock('./usePickerCandidates.ts', () => ({ usePickerCandidates: mockUsePickerCandidates }));

import { SurfacePicker } from './SurfacePicker.tsx';

const TEAM = { id: 'team-1', name: 'Alpha', boardId: '42', projectKey: 'ENFCT' } as never;

function blueprintReady() {
  return {
    status: 'ready',
    programEpics: [{
      type: 'pe', key: 'PE-1', summary: 'Onboarding', status: null, health: 'yellow', completionPercent: 0,
      features: [
        { type: 'feature', key: 'F-1', summary: 'Login', status: 'To Do', health: 'yellow', completionPercent: 0, children: [{}], offTrain: [], isExternal: false },
        { type: 'feature', key: 'F-2', summary: 'Payments', status: 'To Do', health: 'gray', completionPercent: 0, children: [], offTrain: [], isExternal: false },
      ],
    }],
    jqlItems: [],
    error: null,
  };
}

function renderPicker(overrides: Partial<Parameters<typeof SurfacePicker>[0]> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<SurfacePicker team={TEAM} piName="PI 26.3" projectKey="ENFCT" onCanvasKeys={new Set()} defaultJql="project = X" onAdd={onAdd} onClose={onClose} {...overrides} />);
  return { onAdd, onClose };
}

describe('SurfacePicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists blueprint candidates grouped by Program Epic and adds only the selected', () => {
    mockUsePickerCandidates.mockReturnValue(blueprintReady());
    const { onAdd, onClose } = renderPicker();

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select F-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));

    expect(onAdd).toHaveBeenCalledWith(['F-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables already-on-canvas rows and never re-adds them (additive dedup)', () => {
    mockUsePickerCandidates.mockReturnValue(blueprintReady());
    const { onAdd } = renderPicker({ onCanvasKeys: new Set(['F-1']) });

    const alreadyAdded = screen.getByLabelText('Select F-1') as HTMLInputElement;
    expect(alreadyAdded.disabled).toBe(true);
    expect(screen.getByText('already added')).toBeInTheDocument();

    // Select-all + Add should only add the not-already-present feature.
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(onAdd).toHaveBeenCalledWith(['F-2']);
  });

  it('narrows the list with the search box', () => {
    mockUsePickerCandidates.mockReturnValue(blueprintReady());
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'payment' } });
    expect(screen.queryByLabelText('Select F-1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select F-2')).toBeInTheDocument();
  });

  it('shows a clear error and adds nothing when the custom query fails (safe failure)', () => {
    mockUsePickerCandidates.mockReturnValue({ status: 'error', programEpics: [], jqlItems: [], error: 'jql error 400' });
    const { onAdd } = renderPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Custom JQL' }));
    expect(screen.getByRole('alert')).toHaveTextContent('jql error 400');
    expect(screen.queryByLabelText(/Select /)).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('falls back to Custom JQL when no ART team is configured (G1)', () => {
    // Blueprint reports no-team; the picker guides the user to the Custom-JQL source.
    mockUsePickerCandidates.mockReturnValue({ status: 'no-team', programEpics: [], jqlItems: [], error: null });
    renderPicker({ team: null });
    expect(screen.getByText(/No ART team is configured/)).toBeInTheDocument();
    // The Custom-JQL tab is available as the fallback.
    expect(screen.getByRole('tab', { name: 'Custom JQL' })).toBeInTheDocument();
  });
});
