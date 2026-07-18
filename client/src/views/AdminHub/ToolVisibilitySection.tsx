// ToolVisibilitySection.tsx — Per-tool home card visibility controls for Admin Hub.
//
// Renders a toggle for every hideable card in APP_CARDS, bound to the SHARED
// toolVisibilityStore — the same store the Home view renders from, so a toggle here
// changes the home page immediately (spec 020: the old version persisted to localStorage
// but wired to nothing). The Admin Hub itself is never listed: the toggle that could lock
// an admin out of these toggles must not exist (FR-004).

import { APP_CARDS } from '../Home/homeCardData';
import {
  resolveToolIsVisible,
  setToolVisibility,
  useToolVisibilityStore,
} from '../../store/toolVisibilityStore.ts';
import styles from './AdminHubView.module.css';

// ── Constants ──

// Every card except the pinned Admin Hub is admin-hideable.
const HIDEABLE_CARDS = APP_CARDS.filter((appCard) => appCard.id !== 'admin-hub');

// ── Sub-components ──

interface ToolToggleItemProps {
  cardId: string;
  icon: string;
  title: string;
  isVisible: boolean;
  onToggle(cardId: string): void;
}

/** Single tool card visibility toggle — icon + title + checkbox. */
function ToolToggleItem({ cardId, icon, title, isVisible, onToggle }: ToolToggleItemProps) {
  return (
    <label className={styles.toolVisibilityItem}>
      <input
        type="checkbox"
        checked={isVisible}
        onChange={() => onToggle(cardId)}
        aria-label={`Toggle visibility of ${title}`}
      />
      <span className={styles.toolVisibilityIcon}>{icon}</span>
      <span className={styles.toolVisibilityLabel}>{title}</span>
    </label>
  );
}

// ── Main component ──

/** Tool Visibility section — controls which tool cards appear on the Home view, live. */
export default function ToolVisibilitySection() {
  const visibilityByCardId = useToolVisibilityStore((storeState) => storeState.visibilityByCardId);

  function handleToggleTool(cardId: string) {
    setToolVisibility(cardId, !resolveToolIsVisible(visibilityByCardId, cardId));
  }

  function handleSetAllTools(isVisible: boolean) {
    for (const hideableCard of HIDEABLE_CARDS) {
      setToolVisibility(hideableCard.id, isVisible);
    }
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🎯 Tool Visibility</h2>
      <p className={styles.adminDescription}>
        Controls which tool cards appear on the home screen — changes apply immediately and persist.
        Admin Hub is always visible and cannot be toggled.
      </p>

      <div className={styles.inputRow}>
        <button className={styles.actionButton} onClick={() => handleSetAllTools(true)}>
          Show All
        </button>
        <button className={styles.actionButton} onClick={() => handleSetAllTools(false)}>
          Hide All
        </button>
      </div>

      <div className={styles.toolVisibilityGrid}>
        {HIDEABLE_CARDS.map((hideableCard) => (
          <ToolToggleItem
            key={hideableCard.id}
            cardId={hideableCard.id}
            icon={hideableCard.icon}
            title={hideableCard.title}
            isVisible={resolveToolIsVisible(visibilityByCardId, hideableCard.id)}
            onToggle={handleToggleTool}
          />
        ))}
      </div>
    </section>
  );
}
