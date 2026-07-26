// piPlanAiApply.ts — Pure application of an accepted AI breakdown suggestion (spec 028, US1).
// Turns a BreakdownSuggestion into StorySuggestions for the engine, attaching the idempotency link
// (matchExistingKey) when a proposed Story matches a child already present on the Feature (US6).

import type { BreakdownSuggestion, ExistingChild, FeatureInput, StorySuggestion } from './piPlanTypes.ts';

/** Normalises a summary for tolerant matching against existing children (case/space-insensitive). */
function normalizeSummary(summary: string): string {
  return summary.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Finds an existing Story child of the Feature whose summary matches the proposed Story, if any. */
function findExistingStoryKey(feature: FeatureInput, summary: string): string | null {
  const target = normalizeSummary(summary);
  const match = feature.existingChildren.find(
    (child: ExistingChild) => child.kind === 'story' && normalizeSummary(child.summary) === target,
  );
  return match ? match.key : null;
}

/**
 * Applies an accepted breakdown to its Feature, returning engine-ready StorySuggestions. Passes size
 * and testability through unchanged and links each Story to an existing child when one matches, so a
 * re-run recognises it as already created rather than proposing a duplicate.
 */
export function applyBreakdownSuggestion(feature: FeatureInput, suggestion: BreakdownSuggestion): StorySuggestion[] {
  return suggestion.stories.map((story) => ({
    summary: story.summary,
    sizePoints: story.sizePoints,
    hasTestableOutput: story.hasTestableOutput,
    matchExistingKey: findExistingStoryKey(feature, story.summary),
  }));
}
