// boardScopeStore.ts — Which Feature projects each team tracks on its Roll-Up Board.
//
// This has to be PER TEAM, not per ART: Transformers care about one project, Cleanup Crew about two.
// The ART-wide setting already in the workspace is the sensible starting point, so a team that has
// never configured this inherits it and sees no change at all.

import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import type { FeatureScopeSettings } from './featureScope.ts';

const BOARD_SCOPE_STORAGE_KEY = 'tbxRollupBoardScope';

/** One team's stored scope. Absent fields mean "never configured", not "configured to nothing". */
interface StoredTeamScope {
  featureProjectKeys?: string[];
  shouldIncludeOutOfProjectFeatureLinks?: boolean;
  shouldIncludeIssueLinkedFeatures?: boolean;
  carryOverPiValue?: string;
  carryOverSource?: 'none' | 'pi-review' | 'unfinished-in-pi';
  teamFeatureLabel?: string;
  excludedFeatureLabels?: string[];
}

/** Reads every team's stored scope; unreadable storage counts as nothing stored. */
function readAllTeamScopes(): Record<string, StoredTeamScope> {
  try {
    return JSON.parse(window.localStorage.getItem(BOARD_SCOPE_STORAGE_KEY) || '{}') as Record<string, StoredTeamScope>;
  } catch {
    return {};
  }
}

/**
 * The Feature scope for one team.
 *
 * A team that has not set its own project list inherits the ART-wide one, so turning this feature on
 * changes nothing for anybody until a team deliberately narrows its board.
 */
export function loadTeamFeatureScope(teamProfileId: string): FeatureScopeSettings {
  const storedScope = readAllTeamScopes()[teamProfileId];
  const hasOwnProjectKeys = Array.isArray(storedScope?.featureProjectKeys);

  return {
    featureProjectKeys: hasOwnProjectKeys
      ? storedScope!.featureProjectKeys!
      : readArtFeatureScopeSettings().featureProjectKeys,
    // Both default OFF so the project list actually narrows the board. Out-of-project work is
    // reported either way — it is named on the board rather than silently dropped.
    shouldIncludeOutOfProjectFeatureLinks: storedScope?.shouldIncludeOutOfProjectFeatureLinks ?? false,
    shouldIncludeIssueLinkedFeatures: storedScope?.shouldIncludeIssueLinkedFeatures ?? false,
    // Absent means "show only this PI", which is how every board behaved before carry-over existed.
    carryOverPiValue: storedScope?.carryOverPiValue ?? '',
    // A board that already had a carry-over PI keeps deriving until somebody chooses otherwise;
    // anything new starts with carry-over off, as every board did before it existed.
    carryOverSource: storedScope?.carryOverSource
      ?? (storedScope?.carryOverPiValue ? 'unfinished-in-pi' : 'none'),
    // Empty keeps the inference every board used before labels existed.
    teamFeatureLabel: storedScope?.teamFeatureLabel ?? '',
    excludedFeatureLabels: storedScope?.excludedFeatureLabels ?? [],
  };
}

/** True when this team has narrowed the board itself, rather than inheriting the ART-wide setting. */
export function hasTeamOwnFeatureScope(teamProfileId: string): boolean {
  return Array.isArray(readAllTeamScopes()[teamProfileId]?.featureProjectKeys);
}

/** Saves one team's scope, leaving every other team's untouched. */
export function saveTeamFeatureScope(teamProfileId: string, settings: FeatureScopeSettings): void {
  const allScopes = readAllTeamScopes();
  allScopes[teamProfileId] = {
    featureProjectKeys: [...settings.featureProjectKeys],
    shouldIncludeOutOfProjectFeatureLinks: settings.shouldIncludeOutOfProjectFeatureLinks,
    shouldIncludeIssueLinkedFeatures: settings.shouldIncludeIssueLinkedFeatures,
    carryOverPiValue: settings.carryOverPiValue,
    carryOverSource: settings.carryOverSource,
    teamFeatureLabel: settings.teamFeatureLabel,
    excludedFeatureLabels: [...settings.excludedFeatureLabels],
  };
  window.localStorage.setItem(BOARD_SCOPE_STORAGE_KEY, JSON.stringify(allScopes));
}

/** Drops a team's own scope so it goes back to inheriting the ART-wide setting. */
export function clearTeamFeatureScope(teamProfileId: string): void {
  const allScopes = readAllTeamScopes();
  delete allScopes[teamProfileId];
  window.localStorage.setItem(BOARD_SCOPE_STORAGE_KEY, JSON.stringify(allScopes));
}
