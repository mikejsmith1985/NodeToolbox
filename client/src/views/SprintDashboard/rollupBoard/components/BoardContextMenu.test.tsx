// BoardContextMenu.test.tsx — Proves the actions that left the lane header are still reachable, and
// that the menu gets out of the way as readily as it appeared.
//
// The whole point of moving them was to remove sixty buttons from the screen. That is only an
// improvement if the actions themselves survived the move — including for somebody who cannot
// right-click.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardContextMenu, type BoardMenuAction } from './BoardContextMenu.tsx';

const AT_ORIGIN = { xPx: 20, yPx: 30 };

function buildActions(onSelect = vi.fn()): BoardMenuAction[] {
  return [
    { id: 'send-top', label: 'Send to top', onSelect },
    { id: 'send-bottom', label: 'Send to bottom', onSelect: vi.fn() },
  ];
}

describe('BoardContextMenu', () => {
  it('renders nothing at all while closed, so a board of lanes carries no hidden menus', () => {
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={vi.fn()} position={null} />);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders nothing when there are no actions, rather than an empty menu', () => {
    render(<BoardContextMenu actions={[]} ownerKey="FEAT-1" onClose={vi.fn()} position={AT_ORIGIN} />);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('names the lane it belongs to, so it is unambiguous read aloud', () => {
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={vi.fn()} position={AT_ORIGIN} />);

    expect(screen.getByRole('menu', { name: 'Actions for FEAT-1' })).toBeTruthy();
  });

  it('runs the action and then closes, so the menu never lingers over the board', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <BoardContextMenu actions={buildActions(onSelect)} ownerKey="FEAT-1" onClose={onClose} position={AT_ORIGIN} />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Send to top' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses its first action on open, so it can be driven from the keyboard', () => {
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={vi.fn()} position={AT_ORIGIN} />);

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Send to top' }));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={onClose} position={AT_ORIGIN} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a press outside itself, but not on one inside', () => {
    const onClose = vi.fn();
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={onClose} position={AT_ORIGIN} />);

    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Send to top' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the board scrolls, which would otherwise leave it over another lane', () => {
    // It is positioned from the pointer's viewport coordinates, so scrolling moves the lane out from
    // under it and the menu would go on claiming to act on a Feature no longer beneath it.
    const onClose = vi.fn();
    render(<BoardContextMenu actions={buildActions()} ownerKey="FEAT-1" onClose={onClose} position={AT_ORIGIN} />);

    fireEvent.scroll(document, {});

    expect(onClose).toHaveBeenCalled();
  });

  it('stays on screen when opened against the right-hand edge', () => {
    render(
      <BoardContextMenu
        actions={buildActions()}
        ownerKey="FEAT-1"
        onClose={vi.fn()}
        position={{ xPx: window.innerWidth + 500, yPx: 10 }}
      />,
    );

    const menuLeft = Number.parseInt((screen.getByRole('menu') as HTMLElement).style.left, 10);
    expect(menuLeft).toBeLessThanOrEqual(window.innerWidth);
  });
});
