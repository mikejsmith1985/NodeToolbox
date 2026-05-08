// ToolVisibilitySection.tsx — Per-tool home card visibility controls for Admin Hub.
//
// Renders a toggle for every card defined in APP_CARDS. Visibility state is persisted
// to localStorage under tbxToolVisibility as a JSON object keyed by card ID.
// Does NOT wire into the HomeView — persistence only.

import { useState } from 'react';

import { APP_CARDS } from '../Home/homeCardData';
import styles from './AdminHubView.module.css';

// ── Constants ──

const TOOL_VISIBILITY_STORAGE_KEY = 'tbxToolVisibility';

// ── Helpers ──

/** Reads the per-tool visibility map from localStorage. */
function loadToolVisibilityFromStorage(): Record<string, boolean> {
  try {
    const rawValue = localStorage.getItem(TOOL_VISIBILITY_STORAGE_KEY);
    if (rawValue === null) return {};
    return JSON.parse(rawValue) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Persists the visibility map to localStorage. */
function saveToolVisibilityToStorage(visibilityMap: Record<string, boolean>): void {
  try {
    localStorage.setItem(TOOL_VISIBILITY_STORAGE_KEY, JSON.stringify(visibilityMap));
  } catch {
    // Non-fatal: in-memory state remains authoritative.
  }
}

/** Returns true when a tool should be visible (default is visible when not explicitly set). */
function resolveToolIsVisible(
  visibilityMap: Record<string, boolean>,
  cardId: string,
): boolean {
  return visibilityMap[cardId] !== false;
}

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

/** Tool Visibility section — controls which tool cards appear on the Home view. */
export default function ToolVisibilitySection() {
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>(
    loadToolVisibilityFromStorage,
  );

  function handleToggleTool(cardId: string) {
    setVisibilityMap((currentMap) => {
      const nextMap = {
        ...currentMap,
        [cardId]: !resolveToolIsVisible(currentMap, cardId),
      };
      saveToolVisibilityToStorage(nextMap);
      return nextMap;
    });
  }

  function handleShowAll() {
    const nextMap: Record<string, boolean> = {};
    for (const card of APP_CARDS) {
      nextMap[card.id] = true;
    }
    setVisibilityMap(nextMap);
    saveToolVisibilityToStorage(nextMap);
  }

  function handleHideAll() {
    const nextMap: Record<string, boolean> = {};
    for (const card of APP_CARDS) {
      nextMap[card.id] = false;
    }
    setVisibilityMap(nextMap);
    saveToolVisibilityToStorage(nextMap);
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🎯 Tool Visibility</h2>
      <p className={styles.adminDescription}>
        Controls which tool cards appear on the home screen. Changes persist to localStorage.
        Admin Hub is always visible regardless of this setting.
      </p>

      <div className={styles.inputRow}>
        <button className={styles.actionButton} onClick={handleShowAll}>
          Show All
        </button>
        <button className={styles.actionButton} onClick={handleHideAll}>
          Hide All
        </button>
      </div>

      <div className={styles.toolVisibilityGrid}>
        {APP_CARDS.map((card) => (
          <ToolToggleItem
            key={card.id}
            cardId={card.id}
            icon={card.icon}
            title={card.title}
            isVisible={resolveToolIsVisible(visibilityMap, card.id)}
            onToggle={handleToggleTool}
          />
        ))}
      </div>
    </section>
  );
}
