// useReadinessData.ts — Orchestrates the Readiness tab's fetch-and-grade lifecycle.
//
// Resolves the instance field config, derives the three lens PI scopes, runs one Jira query per
// scope (portfolio-project rule), and feeds them all through the single runReadinessScan. The panel
// consumes only the ReadinessScanResult this returns, so counts and listings agree by construction.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import { resolveHygieneFieldConfig, type HygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';
import { readArtFeatureScopeSettings } from '../artFeatureScopeSettings.ts';
import {
  buildReadinessFeatureJql,
  deriveReadinessPiContext,
  fetchReadinessFeatures,
  resolveReadinessScopeClause,
} from './readinessFeatureQuery.ts';
import { runReadinessScan, type ReadinessScanResult } from './readinessScan.ts';
import { applyReadinessFeatureIgnore, readReadinessIgnore } from './readinessIgnore.ts';

/** The teams the ART roster holds; the Jira label scopes the query and identifies a feature's team. */
export interface ReadinessRosterTeam {
  name?: string;
  jiraLabel?: string;
}

export interface UseReadinessDataArgs {
  selectedPiName: string;
  availablePiNames: readonly string[];
  rosterTeams: readonly ReadinessRosterTeam[];
}

export interface ReadinessDataState {
  scanResult: ReadinessScanResult | null;
  isLoading: boolean;
  reload: () => void;
}

/** Collects the distinct, non-empty Jira labels the roster teams define. */
function collectRosterLabels(rosterTeams: readonly ReadinessRosterTeam[]): string[] {
  return Array.from(
    new Set(rosterTeams.map((team) => team.jiraLabel?.trim()).filter((label): label is string => Boolean(label))),
  );
}

/** Runs the readiness fetch + scan for the current PI context, returning the single scan result. */
export function useReadinessData({
  selectedPiName,
  availablePiNames,
  rosterTeams,
}: UseReadinessDataArgs): ReadinessDataState {
  const [scanResult, setScanResult] = useState<ReadinessScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const rosterLabels = useMemo(() => collectRosterLabels(rosterTeams), [rosterTeams]);
  // Depend on stable string keys, not array references, so a caller passing a fresh array literal
  // each render (or new PI list reference) cannot spin the fetch effect into a loop.
  const rosterLabelsKey = rosterLabels.join('|');
  const availablePiNamesKey = availablePiNames.join('|');

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (selectedPiName.trim() === '') {
      setScanResult(null);
      return;
    }

    let isActive = true;
    setIsLoading(true);

    void (async () => {
      const scopeSettings = readArtFeatureScopeSettings();
      // A field-config load failure must not blank the whole tab — fall back to defaults (the
      // readiness families then resolve empty and render "not checked", which is the honest state).
      let fieldConfig: HygieneFieldConfig;
      try {
        fieldConfig = await loadHygieneFieldConfig();
      } catch {
        fieldConfig = resolveHygieneFieldConfig();
      }

      const piContext = deriveReadinessPiContext(selectedPiName, availablePiNames);
      const scope = resolveReadinessScopeClause(scopeSettings.featureProjectKeys, rosterLabels);
      // Features the user has chosen to ignore: whole projects are excluded in the query (so they
      // never eat the result cap); individual features are filtered out after the fetch.
      const ignore = readReadinessIgnore();

      const currentJql = buildReadinessFeatureJql([piContext.currentPiName], scopeSettings.piFieldId, scope.clause, ignore.ignoredProjectKeys);
      const upcomingJql = piContext.upcomingPiName
        ? buildReadinessFeatureJql([piContext.upcomingPiName], scopeSettings.piFieldId, scope.clause, ignore.ignoredProjectKeys)
        : '';
      const carryoverJql = buildReadinessFeatureJql(piContext.carryoverPiNames, scopeSettings.piFieldId, scope.clause, ignore.ignoredProjectKeys);

      let loadError: string | null = null;
      let currentIssues = [] as Awaited<ReturnType<typeof fetchReadinessFeatures>>['issues'];
      let upcomingIssues = currentIssues;
      let carryoverIssues = currentIssues;
      try {
        const [current, upcoming, carryover] = await Promise.all([
          fetchReadinessFeatures(currentJql),
          fetchReadinessFeatures(upcomingJql),
          fetchReadinessFeatures(carryoverJql),
        ]);
        currentIssues = current.issues;
        upcomingIssues = upcoming.issues;
        carryoverIssues = carryover.issues;
      } catch (fetchError) {
        loadError = fetchError instanceof Error ? fetchError.message : 'Failed to load Features from Jira.';
      }

      const result = runReadinessScan({
        piFieldId: scopeSettings.piFieldId,
        fieldConfig,
        currentPiName: piContext.currentPiName,
        upcomingPiName: piContext.upcomingPiName,
        carryoverPiNames: piContext.carryoverPiNames,
        currentFeatures: applyReadinessFeatureIgnore(currentIssues, ignore.ignoredFeatureKeys),
        upcomingFeatures: applyReadinessFeatureIgnore(upcomingIssues, ignore.ignoredFeatureKeys),
        carryoverFeatures: applyReadinessFeatureIgnore(carryoverIssues, ignore.ignoredFeatureKeys),
        loadError,
        scopeDescription: scope.description,
        isCarryoverCapped: piContext.isCarryoverCapped,
      });

      if (isActive) {
        setScanResult(result);
        setIsLoading(false);
      }
    })();

    return () => { isActive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by strings; arrays read inside are derived from these keys
  }, [selectedPiName, availablePiNamesKey, rosterLabelsKey, reloadToken]);

  return { scanResult, isLoading, reload };
}
