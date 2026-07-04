// BlueprintSelectionStep.test.tsx — Verifies the step-1 wrapper wires selection state into BlueprintTab.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BlueprintSelectionMode } from '../../ArtView/BlueprintTab.tsx';

// Stub BlueprintTab: expose the selection wiring so we can test the wrapper without a real fetch.
vi.mock('../../ArtView/BlueprintTab.tsx', () => ({
  default: ({ selectionMode }: { selectionMode?: BlueprintSelectionMode }) => (
    <div>
      <span>blueprint-tab</span>
      <span>oncanvas:{[...(selectionMode?.onCanvasKeys ?? [])].join(',')}</span>
      <span>selected:{[...(selectionMode?.selectedKeys ?? [])].join(',')}</span>
      <button type="button" onClick={() => selectionMode?.onToggle('ENCUC-1')}>toggle-ENCUC-1</button>
      <button type="button" onClick={() => selectionMode?.onAddToCanvas()}>do-add</button>
    </div>
  ),
}));

import { BlueprintSelectionStep } from './BlueprintSelectionStep.tsx';

const TEAM = { id: 't1', name: 'CleanupCrew', boardId: '42', projectKey: 'ENCUC', sprintIssues: [], isLoading: false, loadError: null } as never;

describe('BlueprintSelectionStep', () => {
  it('toggles a feature and adds the selection to the canvas, then closes', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onCanvasKeys={new Set()} onAdd={onAdd} onClose={onClose} hasCanvas={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-ENCUC-1' }));
    expect(screen.getByText('selected:ENCUC-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'do-add' }));
    expect(onAdd).toHaveBeenCalledWith(['ENCUC-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('passes the on-canvas keys through and shows Back-to-canvas when a canvas exists', () => {
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onCanvasKeys={new Set(['ENCUC-1'])} onAdd={vi.fn()} onClose={vi.fn()} hasCanvas />);
    expect(screen.getByText('oncanvas:ENCUC-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to canvas/ })).toBeInTheDocument();
  });
});
