// LaneContextMenu.tsx — The actions you take ON a swimlane, on right-click rather than on screen.
//
// These three — Send to top, Send to bottom, Add work — used to be buttons in every lane header. On a
// twenty-Feature board that is sixty buttons permanently on screen for actions taken about twice a
// sprint, and they crowded out the thing the header is actually for: saying which Feature this is.
//
// Right-click is what the feature was asked for in the first place. It is not the only way in: the
// menu opens from the keyboard too, because an action reachable only by right-click is an action
// somebody navigating by keyboard cannot take at all.

import { useEffect, useRef } from 'react';

import styles from '../RollupBoardTab.module.css';

/** One entry in the menu. A disabled entry is not offered rather than shown greyed out. */
export interface LaneMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export interface LaneContextMenuProps {
  /** Where the menu was opened, in viewport coordinates. Null means it is closed. */
  position: { xPx: number; yPx: number } | null;
  actions: readonly LaneMenuAction[];
  onClose: () => void;
  /** Named in the menu's label so screen-reader users know which lane they are acting on. */
  featureKey: string;
}

/** Keeps the menu on screen when it is opened near the right or bottom edge. */
function clampToViewport(position: { xPx: number; yPx: number }, menuElement: HTMLElement | null): {
  left: number; top: number;
} {
  const menuWidth = menuElement?.offsetWidth ?? 0;
  const menuHeight = menuElement?.offsetHeight ?? 0;
  return {
    left: Math.max(4, Math.min(position.xPx, window.innerWidth - menuWidth - 4)),
    top: Math.max(4, Math.min(position.yPx, window.innerHeight - menuHeight - 4)),
  };
}

/** Renders the lane's actions as a menu anchored where the pointer was. */
export function LaneContextMenu({ position, actions, onClose, featureKey }: LaneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (position === null) return;

    // Focus the first action, so the menu is usable by keyboard the moment it opens.
    menuRef.current?.querySelector('button')?.focus();

    function handleDismiss(dismissEvent: Event): void {
      if (dismissEvent.target instanceof Node && menuRef.current?.contains(dismissEvent.target)) return;
      onClose();
    }
    function handleEscape(keyboardEvent: KeyboardEvent): void {
      if (keyboardEvent.key === 'Escape') onClose();
    }

    // Scrolling the board would leave the menu floating over an unrelated lane, so it closes instead.
    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [position, onClose]);

  if (position === null || actions.length === 0) return null;

  const { left, top } = clampToViewport(position, menuRef.current);

  return (
    <div
      aria-label={`Actions for ${featureKey}`}
      className={styles.laneMenu}
      data-testid={`rollup-lane-menu-${featureKey}`}
      ref={menuRef}
      role="menu"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      {actions.map((action) => (
        <button
          className={styles.laneMenuItem}
          key={action.id}
          onClick={() => { action.onSelect(); onClose(); }}
          role="menuitem"
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
