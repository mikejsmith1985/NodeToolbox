// MyOpenChangesPicker.test.tsx — Proves "Load my open changes" lists the user's changes and picking one hands back its number.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fetchMyOpenChanges } from '../../views/SnowHub/myOpenChanges.ts';
import MyOpenChangesPicker from './MyOpenChangesPicker.tsx';

vi.mock('../../views/SnowHub/myOpenChanges.ts', () => ({ fetchMyOpenChanges: vi.fn() }));

describe('MyOpenChangesPicker', () => {
  it('loads the user\'s open changes on request and hands back the one picked', async () => {
    vi.mocked(fetchMyOpenChanges).mockResolvedValueOnce([{ changeNumber: 'CHG0052017', shortDescription: 'REL release' }]);
    const onPick = vi.fn();
    render(<MyOpenChangesPicker onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load my open changes' }));
    fireEvent.change(await screen.findByLabelText('Or pick one of my open changes'), { target: { value: 'CHG0052017' } });
    expect(screen.getByRole('option', { name: 'CHG0052017 — REL release' })).toBeTruthy();
    expect(onPick).toHaveBeenCalledWith('CHG0052017');
    // The pick stays shown instead of snapping back to "Choose…".
    expect((screen.getByLabelText('Or pick one of my open changes') as HTMLSelectElement).value).toBe('CHG0052017');
  });

  it('says so when the user has no open changes, or the read failed', async () => {
    vi.mocked(fetchMyOpenChanges).mockResolvedValueOnce([]);
    const { unmount } = render(<MyOpenChangesPicker onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load my open changes' }));
    expect(await screen.findByText('You have no open changes assigned to you.')).toBeTruthy();
    unmount();
    vi.mocked(fetchMyOpenChanges).mockRejectedValueOnce(new Error('HTTP 401'));
    render(<MyOpenChangesPicker onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load my open changes' }));
    expect(await screen.findByText('Could not load your changes: HTTP 401')).toBeTruthy();
  });
});
