// componentClassificationStore.ts — The repo/domain classification Jira does not have (spec 031, US1).
//
// Each Jira component is tagged 'repo' or 'domain' by an explicit human action in the Component Manager;
// absence means UNCLASSIFIED and is never inferred from the name. This store is the authoritative allowlist
// that both the AI component mapping and repo-only story generation consume, so the two cannot disagree.
// Persisted in localStorage, keyed by the component name (case-insensitive) — a repo is one thing across
// projects, so name is the stable identity; per-project ids are resolved at write time.

import { create } from 'zustand';

const CLASSIFICATION_STORAGE_KEY = 'tbxComponentClassification';

export type ComponentKind = 'repo' | 'domain';

/** One classified component: the original-cased name for display, plus its kind. */
export interface ClassificationEntry {
  displayName: string;
  kind: ComponentKind;
}

interface ComponentClassificationState {
  /** Keyed by name.trim().toLowerCase(); absence = unclassified. */
  classifications: Record<string, ClassificationEntry>;
}

/** The case-insensitive identity key for a component name. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Reads the persisted classifications, tolerating a missing/corrupt store. */
function readStoredClassifications(): Record<string, ClassificationEntry> {
  try {
    const raw = localStorage.getItem(CLASSIFICATION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const result: Record<string, ClassificationEntry> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Record<string, unknown>;
      if (typeof entry?.displayName === 'string' && (entry.kind === 'repo' || entry.kind === 'domain')) {
        result[key] = { displayName: entry.displayName, kind: entry.kind };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Persists the classifications; a blocked store (private mode) degrades to in-memory only. */
function writeStoredClassifications(classifications: Record<string, ClassificationEntry>): void {
  try {
    localStorage.setItem(CLASSIFICATION_STORAGE_KEY, JSON.stringify(classifications));
  } catch {
    // In-memory state stays authoritative.
  }
}

export const useComponentClassificationStore = create<ComponentClassificationState>(() => ({
  classifications: readStoredClassifications(),
}));

/** Classifies (or re-classifies) a component; overwrites any prior kind and takes effect everywhere immediately. */
export function classifyComponent(name: string, kind: ComponentKind): void {
  const key = nameKey(name);
  if (key === '') {
    return;
  }
  const classifications = {
    ...useComponentClassificationStore.getState().classifications,
    [key]: { displayName: name.trim(), kind },
  };
  writeStoredClassifications(classifications);
  useComponentClassificationStore.setState({ classifications });
}

/** Removes a component's classification — it returns to unclassified. */
export function clearComponentClassification(name: string): void {
  const key = nameKey(name);
  const current = useComponentClassificationStore.getState().classifications;
  if (!(key in current)) {
    return;
  }
  const classifications = { ...current };
  delete classifications[key];
  writeStoredClassifications(classifications);
  useComponentClassificationStore.setState({ classifications });
}

/** The component's kind, or null when it has not been classified (never guessed from the name). */
export function getComponentKind(name: string): ComponentKind | null {
  return useComponentClassificationStore.getState().classifications[nameKey(name)]?.kind ?? null;
}

export function isRepoComponent(name: string): boolean {
  return getComponentKind(name) === 'repo';
}

export function isDomainComponent(name: string): boolean {
  return getComponentKind(name) === 'domain';
}

/** The repo allowlist — the display names of every component classified 'repo'. */
export function repoAllowlist(): string[] {
  return Object.values(useComponentClassificationStore.getState().classifications)
    .filter((entry) => entry.kind === 'repo')
    .map((entry) => entry.displayName);
}
