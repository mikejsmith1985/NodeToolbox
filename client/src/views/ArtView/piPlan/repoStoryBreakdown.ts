// repoStoryBreakdown.ts — Deterministic repo-only story generation (spec 031, US3).
//
// For a repo-driven Feature the story set is NOT the 028 AI breakdown — it is exactly one Story per REPO
// component on the Feature, and never a story for a domain or unclassified component. Each Story is titled
// "{Feature summary} ({repo})" (GH #220 convention) and carries that single repo (set on its own component
// field at create time). Idempotent: a repo that already has a matching child Story is not re-created. A
// Feature with no repo components yields zero stories and an honest "map repos first" state. Pure — no I/O.

import type { ComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';
import type { ExistingChild } from './piPlanTypes.ts';

/** The Feature a repo breakdown is built for. */
export interface FeatureForRepoStories {
  key: string;
  summary: string;
}

/** One deterministic Story proposal — one per repo component. */
export interface RepoStoryProposal {
  featureKey: string;
  repoName: string;
  /** "{Feature summary} ({repo})" (FR-025), editable before creation. */
  title: string;
  /** Set when an existing child Story already covers this repo — the idempotency link (FR-023). */
  matchExistingKey: string | null;
}

export interface RepoStoryBreakdownResult {
  proposals: RepoStoryProposal[];
  honestStates: string[];
}

/** The convention title: repo in parentheses after the Feature summary. */
export function buildRepoStoryTitle(featureSummary: string, repoName: string): string {
  return `${featureSummary.trim()} (${repoName.trim()})`;
}

/** True when an existing child Story already represents this repo (by title suffix, case-insensitive). */
function findExistingStoryForRepo(
  existingChildren: readonly ExistingChild[],
  title: string,
  repoName: string,
): ExistingChild | undefined {
  const titleLower = title.toLowerCase();
  const repoSuffix = `(${repoName.trim().toLowerCase()})`;
  return existingChildren.find((child) => {
    const summaryLower = child.summary.trim().toLowerCase();
    return summaryLower === titleLower || summaryLower.endsWith(repoSuffix);
  });
}

/**
 * Builds one Story proposal per REPO component on the Feature. Repo/domain status is evaluated against the
 * CURRENT classification (FR-024) via `getKind`, so a component now classified domain (or unclassified) is
 * excluded here. Duplicates in the input collapse; the empty case is surfaced, never guessed.
 */
export function buildRepoStoryProposals(
  feature: FeatureForRepoStories,
  featureComponentNames: readonly string[],
  existingChildren: readonly ExistingChild[],
  getKind: (name: string) => ComponentKind | null,
): RepoStoryBreakdownResult {
  const proposals: RepoStoryProposal[] = [];
  const seen = new Set<string>();

  for (const componentName of featureComponentNames) {
    const key = componentName.trim().toLowerCase();
    if (key === '' || seen.has(key)) {
      continue;
    }
    // Repo-only, evaluated now (FR-020, FR-024): domain and unclassified components generate nothing.
    if (getKind(componentName) !== 'repo') {
      continue;
    }
    seen.add(key);
    const title = buildRepoStoryTitle(feature.summary, componentName);
    const match = findExistingStoryForRepo(existingChildren, title, componentName);
    proposals.push({
      featureKey: feature.key,
      repoName: componentName.trim(),
      title,
      matchExistingKey: match ? match.key : null,
    });
  }

  const honestStates = proposals.length === 0
    ? ['No repo components mapped — map repos first.']
    : [];
  return { proposals, honestStates };
}
