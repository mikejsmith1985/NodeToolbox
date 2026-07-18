// AgileHubView.tsx — The Agile Hub thin shell: one door, three audience spaces (spec 020 US3).
//
// The shell owns NOTHING but the space choice. Each space mounts one of the pre-merge views —
// SprintDashboardView, PoToolView, ArtView — completely unchanged, so capability parity and
// per-space selection carry-over hold by construction: the spaces ARE the tools users had,
// reading the same stores they always read (incl. the PO's 017-isolated selection).

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSettingsStore } from '../../store/settingsStore.ts';
import ArtView from '../ArtView/ArtView.tsx';
import PoToolView from '../PoTool/PoToolView.tsx';
import SprintDashboardView from '../SprintDashboard/SprintDashboardView.tsx';
import styles from './AgileHubView.module.css';

/** The three audience spaces — always all visible (lenses, not permissions; FR-013). */
const AGILE_HUB_SPACES = [
  { key: 'team', label: '🏃 Team' },
  { key: 'product', label: '🧭 Product' },
  { key: 'train', label: '🚂 Train' },
] as const;

type AgileHubSpace = (typeof AGILE_HUB_SPACES)[number]['key'];

const SPACE_QUERY_PARAM = 'space';
const DEFAULT_AGILE_HUB_SPACE: AgileHubSpace = 'team';

/** Narrows an arbitrary string (URL param, persisted value) to a valid space. */
function isAgileHubSpace(candidateValue: string | null): candidateValue is AgileHubSpace {
  return AGILE_HUB_SPACES.some((spaceDef) => spaceDef.key === candidateValue);
}

/** Renders the space switcher and mounts exactly one unchanged pre-merge view per space. */
export default function AgileHubView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const persistedLastSpace = useSettingsStore((storeState) => storeState.agileHubLastSpace);
  const setAgileHubLastSpace = useSettingsStore((storeState) => storeState.setAgileHubLastSpace);

  // The URL param is authoritative (deep links, redirects); the persisted last space fills in
  // for a bare /agile-hub visit; anything invalid lands on Team (first-run default).
  const requestedSpace = searchParams.get(SPACE_QUERY_PARAM);
  const activeSpace: AgileHubSpace = isAgileHubSpace(requestedSpace)
    ? requestedSpace
    : isAgileHubSpace(persistedLastSpace)
      ? persistedLastSpace
      : DEFAULT_AGILE_HUB_SPACE;

  // Arriving somewhere IS using it: a deep-linked space becomes the remembered one (FR-013).
  useEffect(() => {
    if (persistedLastSpace !== activeSpace) {
      setAgileHubLastSpace(activeSpace);
    }
  }, [activeSpace, persistedLastSpace, setAgileHubLastSpace]);

  function handleSelectSpace(nextSpace: AgileHubSpace): void {
    setAgileHubLastSpace(nextSpace);
    setSearchParams(
      (previousParams) => {
        // Only the space changes; foreign params (e.g. hygieneFilter) belong to the mounted view.
        const nextParams = new URLSearchParams(previousParams);
        nextParams.set(SPACE_QUERY_PARAM, nextSpace);
        return nextParams;
      },
      { replace: true },
    );
  }

  return (
    <div className={styles.agileHub}>
      <nav aria-label="Agile Hub spaces" className={styles.spaceSwitcher}>
        {AGILE_HUB_SPACES.map((spaceDef) => (
          <button
            key={spaceDef.key}
            aria-pressed={activeSpace === spaceDef.key}
            className={activeSpace === spaceDef.key ? styles.spaceButtonActive : styles.spaceButton}
            type="button"
            onClick={() => handleSelectSpace(spaceDef.key)}
          >
            {spaceDef.label}
          </button>
        ))}
      </nav>

      {activeSpace === 'team' && <SprintDashboardView />}
      {activeSpace === 'product' && <PoToolView />}
      {activeSpace === 'train' && <ArtView />}
    </div>
  );
}
