// BlueprintSelectionStep.test.tsx — Verifies the step-1 wrapper wires selection state into BlueprintTab.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlueprintSelectionMode } from '../../ArtView/BlueprintTab.tsx';

// Stub BlueprintTab: expose the selection wiring so we can test the wrapper without a real fetch.
vi.mock('../../ArtView/BlueprintTab.tsx', () => ({
  default: ({ selectionMode }: { selectionMode?: BlueprintSelectionMode }) => (
    <div>
      <span>blueprint-tab</span>
      <span>oncanvas:{[...(selectionMode?.onCanvasKeys ?? [])].join(',')}</span>
      <span>selected:{[...(selectionMode?.selectedKeys ?? [])].join(',')}</span>
      <button type="button" onClick={() => selectionMode?.onToggle('ENCUC-1')}>toggle-ENCUC-1</button>
      <button type="button" onClick={() => selectionMode?.onSetKeysSelected(['ENCUC-1', 'ENCUC-2'], true)}>select-team</button>
      <button type="button" onClick={() => selectionMode?.onSetKeysSelected(['ENCUC-1'], false)}>clear-one</button>
      <button type="button" onClick={() => selectionMode?.onAddToCanvas()}>do-add</button>
    </div>
  ),
}));

// Stub the PI enumeration so the picker has options without hitting Jira.
const mockLoadPiNames = vi.fn();
vi.mock('../../ArtView/hooks/useArtData.ts', () => ({
  loadAvailablePiNamesFromJira: () => mockLoadPiNames(),
}));

import { BlueprintSelectionStep } from './BlueprintSelectionStep.tsx';

const TEAM = { id: 't1', name: 'CleanupCrew', boardId: '42', projectKey: 'ENCUC', sprintIssues: [], isLoading: false, loadError: null } as never;

beforeEach(() => {
  mockLoadPiNames.mockResolvedValue([]);
});

describe('BlueprintSelectionStep', () => {
  it('toggles a feature and adds the selection to the canvas, then closes', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onPiChange={vi.fn()} onCanvasKeys={new Set()} onAdd={onAdd} onClose={onClose} hasCanvas={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-ENCUC-1' }));
    expect(screen.getByText('selected:ENCUC-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'do-add' }));
    expect(onAdd).toHaveBeenCalledWith(['ENCUC-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('bulk-selects a team then clears one, reflecting the running selection', () => {
    const onAdd = vi.fn();
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onPiChange={vi.fn()} onCanvasKeys={new Set()} onAdd={onAdd} onClose={vi.fn()} hasCanvas={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'select-team' }));
    expect(screen.getByText('selected:ENCUC-1,ENCUC-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'clear-one' }));
    expect(screen.getByText('selected:ENCUC-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'do-add' }));
    expect(onAdd).toHaveBeenCalledWith(['ENCUC-2']);
  });

  it('passes the on-canvas keys through and shows Back-to-canvas when a canvas exists', () => {
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onPiChange={vi.fn()} onCanvasKeys={new Set(['ENCUC-1'])} onAdd={vi.fn()} onClose={vi.fn()} hasCanvas />);
    expect(screen.getByText('oncanvas:ENCUC-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to canvas/ })).toBeInTheDocument();
  });

  it('lets the user pick a different PI for the exercise', async () => {
    mockLoadPiNames.mockResolvedValue(['PI 26.3', 'PI 26.4']);
    const onPiChange = vi.fn();
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onPiChange={onPiChange} onCanvasKeys={new Set()} onAdd={vi.fn()} onClose={vi.fn()} hasCanvas={false} />);

    // The current PI is selectable immediately; the fetched ones appear after the async load.
    const piSelect = screen.getByLabelText('Program Increment for this exercise');
    await waitFor(() => expect(screen.getByRole('option', { name: 'PI 26.4' })).toBeInTheDocument());

    fireEvent.change(piSelect, { target: { value: 'PI 26.4' } });
    expect(onPiChange).toHaveBeenCalledWith('PI 26.4');
  });

  it('always offers the active PI even if the lookup returns nothing', async () => {
    mockLoadPiNames.mockResolvedValue([]);
    render(<BlueprintSelectionStep teams={[TEAM]} selectedPiName="PI 26.3" onPiChange={vi.fn()} onCanvasKeys={new Set()} onAdd={vi.fn()} onClose={vi.fn()} hasCanvas={false} />);
    expect(screen.getByRole('option', { name: 'PI 26.3' })).toBeInTheDocument();
  });
});
