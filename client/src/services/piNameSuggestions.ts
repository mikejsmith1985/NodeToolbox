// piNameSuggestions.ts — Fetches valid Program Increment (PI) names from Jira's JQL autocomplete.
//
// Shared by the ART view and the Team Dashboard so both surface the PI field's real allowed values —
// including future PIs that no issue references yet — instead of only the PIs already stamped on
// issues. Callers that want a narrower set (e.g. only recent PIs) filter the result by date.

import { jiraGet } from './jiraApi.ts';

// Two-digit fiscal-year offsets, relative to the current year, to probe for PI suggestions. The
// range is deliberately generous on the low side; date-based filtering is a caller concern.
const PI_SUGGESTION_YEAR_OFFSETS = [-6, -5, -4, -3, -2, -1, 0, 1] as const;
const TWO_DIGIT_YEAR_MODULO = 100;

interface JiraAutocompleteSuggestion {
  value?: string;
  displayName?: string;
}

interface JiraAutocompleteResponse {
  results?: JiraAutocompleteSuggestion[];
}

/** Converts a stored PI field id (e.g. "customfield_10301") into the JQL field reference "cf[10301]". */
function buildPiAutocompleteFieldName(piFieldId: string): string {
  if (piFieldId.startsWith('customfield_')) {
    return `cf[${piFieldId.replace('customfield_', '')}]`;
  }

  return piFieldId;
}

/** Builds the "PI YY" prefixes to query, spanning several fiscal years around the current one. */
function createPiSuggestionPrefixes(): string[] {
  const currentTwoDigitYear = new Date().getFullYear() % TWO_DIGIT_YEAR_MODULO;

  return PI_SUGGESTION_YEAR_OFFSETS
    .map((yearOffset) => currentTwoDigitYear + yearOffset)
    .filter((yearNumber) => yearNumber >= 0 && yearNumber <= 99)
    .map((yearNumber) => `PI ${String(yearNumber).padStart(2, '0')}`);
}

/**
 * Returns the valid PI names Jira offers for the configured PI field. The result is unsorted and may
 * contain duplicates — callers deduplicate and order as they need. A failed prefix query is treated
 * as empty so one bad response never sinks the whole lookup.
 */
export async function fetchPiNameSuggestions(piFieldId: string): Promise<string[]> {
  const autocompleteFieldName = buildPiAutocompleteFieldName(piFieldId);
  const autocompleteResults = await Promise.all(
    createPiSuggestionPrefixes().map(async (piPrefix) => {
      try {
        const response = await jiraGet<JiraAutocompleteResponse>(
          `/rest/api/2/jql/autocompletedata/suggestions?fieldName=${encodeURIComponent(autocompleteFieldName)}&fieldValue=${encodeURIComponent(piPrefix)}`,
        );

        return response.results ?? [];
      } catch {
        return [];
      }
    }),
  );

  return autocompleteResults.flatMap((resultSet) =>
    resultSet
      .map((suggestion) => (suggestion.value ?? suggestion.displayName ?? '').replace(/^"|"$/g, '').trim())
      .filter((piName) => piName !== ''),
  );
}
