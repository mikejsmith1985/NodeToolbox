// piReviewPullFeatures.ts — Populates a PI Review table with a team's Program Increment Features.
//
// Discovery is a single, direct Jira query: every feature-level issue in the page's PI that belongs to
// the team's Product Owner (taken from the roster) — matched against the Jira Product Owner field by
// default, or against Assignee when that is the saved choice or the instance has no such field. This deliberately replaces the older
// Blueprint bottom-up discovery + label/assignee filter combination — the PI plus the PO uniquely
// scope a team's Features, so no extra filters are needed. Notably the query does NOT constrain by
// project: a team's Features often live in a different (portfolio/program) project than the team's
// delivery board, so adding a project clause silently excludes them. The PO assignee is the scope.
// Discovered Features are de-duplicated against the rows already in the table so a pull only ever
// appends genuinely new Features.

import { readArtSettings, writeArtSetting } from '../../services/artSettingsStore.ts';
import { resolveConfiguredFieldIds, resolveWriteFieldId } from '../../services/jiraFieldMapping.ts';
import { jiraGet } from '../../services/jiraApi.ts';
import { buildIssueTypeClause, loadFeatureIssueTypeNames } from '../../services/jiraIssueTypes.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { extractPiReviewFeatureKey } from './piReviewJira.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from './piReviewTable.ts';

const DIRECT_FEATURE_SEARCH_MAX_RESULTS = 200;
// Only the fields needed to build a row; reconciliation fills priority/estimate/etc. afterwards.
const DIRECT_FEATURE_FIELD_IDS = ['summary', 'status', 'assignee'];

/** ART settings needed to scope the Feature query; resolved from localStorage by default. */
export interface PiReviewPullSettings {
  piFieldId: string;
  /** The Product Owner field the roster's POs are matched against; null matches them by Assignee. */
  productOwnerFieldId: string | null;
}

/** How a pull matches the roster's Product Owners to Epics. */
export type PiPullOwnerMatch = 'productOwnerField' | 'assignee';

// The Jira field name the Product Owner field is found by when none has been chosen in Field Mapping.
const PRODUCT_OWNER_FIELD_NAME_PATTERN = /^\s*product owner\s*$/i;

/** Outcome of a pull: the new rows to append plus counts for user feedback. */
export interface PullPiReviewFeaturesResult {
  /** New rows to append to the table (already de-duplicated against existing rows). */
  rows: PiReviewRow[];
  /** Total distinct Features discovered by the query (before de-duplication vs the table). */
  discoveredCount: number;
  /** How many of the discovered Features were genuinely new and became rows. */
  addedCount: number;
  /** How many new Features were skipped because the user marked them ignored. */
  ignoredCount: number;
}

interface DiscoveredFeature {
  key: string;
  summary: string;
}

/** How pulls match Product Owners: by the Product Owner field unless Assignee was chosen (saved app-wide). */
export function readPiPullOwnerMatch(): PiPullOwnerMatch {
  return readArtSettings().piPullOwnerMatch;
}

/** Saves how pulls match Product Owners, alongside the other ART settings and without disturbing them. */
export function writePiPullOwnerMatch(ownerMatch: PiPullOwnerMatch): void {
  writeArtSetting('piPullOwnerMatch', ownerMatch);
}

/**
 * Reads the pull settings without asking Jira: the PI field, and the Product Owner field when one was
 * chosen in Field Mapping. Use resolvePiReviewPullSettings to also find the field by name.
 */
export function readPiReviewPullSettings(): PiReviewPullSettings {
  // Delegated: the override-then-default chain lives in the mapping module, and a local copy of it
  // is one more thing to keep in step with the field it is trying to name.
  return {
    piFieldId: resolveWriteFieldId('piFieldId', window.localStorage),
    productOwnerFieldId: readPiPullOwnerMatch() === 'assignee'
      ? null
      : resolveConfiguredFieldIds('productOwnerFieldId', window.localStorage)[0] ?? null,
  };
}

/**
 * The pull settings with the Product Owner field resolved: the one chosen in Field Mapping, else the
 * field this Jira names "Product Owner", else none — and none means the roster's POs are matched by
 * Assignee, so a Jira without the field still pulls rather than finding nothing.
 */
export async function resolvePiReviewPullSettings(): Promise<PiReviewPullSettings> {
  const savedSettings = readPiReviewPullSettings();
  if (readPiPullOwnerMatch() === 'assignee' || savedSettings.productOwnerFieldId !== null) {
    return savedSettings;
  }
  const availableFields = await jiraGet<Array<{ id?: unknown; name?: unknown }>>('/rest/api/2/field');
  const productOwnerField = (Array.isArray(availableFields) ? availableFields : [])
    .find((field) => typeof field.name === 'string' && PRODUCT_OWNER_FIELD_NAME_PATTERN.test(field.name));
  return { ...savedSettings, productOwnerFieldId: productOwnerField ? String(productOwnerField.id) : null };
}

/** What a pull matches the roster's Product Owners against, in words for the page. */
export function describePullOwnerMatch(settings: PiReviewPullSettings): string {
  return settings.productOwnerFieldId === null ? 'Assignee' : 'the Product Owner field';
}

/** Wraps a JQL value in quotes, escaping embedded quotes the same way the roster clause builder does. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the owner clause for the Product Owner(s) — against the Product Owner field (`cf[NNN]`) or, with
 * none, Assignee: `= "x"` for a single PO, `in ("x", "y")` for several. Null when no PO is supplied.
 */
function buildProductOwnerClause(poQueryValues: readonly string[], productOwnerFieldId: string | null): string | null {
  const ownerValues = poQueryValues.map((ownerValue) => ownerValue.trim()).filter(Boolean);
  if (ownerValues.length === 0) {
    return null;
  }
  const fieldReference = productOwnerFieldId === null ? 'assignee' : `cf[${productOwnerFieldId.replace('customfield_', '')}]`;
  if (ownerValues.length === 1) {
    return `${fieldReference} = ${quoteJqlValue(ownerValues[0])}`;
  }
  return `${fieldReference} in (${ownerValues.map(quoteJqlValue).join(', ')})`;
}

/**
 * Builds the direct `issuetype = Feature` JQL for a PI + Product Owner(s), mirroring the query a
 * user would run by hand. Returns null when the query cannot be meaningfully scoped — a missing PI
 * or PO would broaden the pull to every Feature the assignee owns (or every Feature in the PI),
 * which is never what the user wants. Deliberately unscoped by project (see file header).
 */
export function buildDirectFeatureJql(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  piFieldId: string,
  featureIssueTypeNames: readonly string[] = [],
  productOwnerFieldId: string | null = null,
): string | null {
  const trimmedPiName = piName.trim();
  const assigneeClause = buildProductOwnerClause(poAssigneeQueryValues, productOwnerFieldId);
  if (trimmedPiName === '' || assigneeClause === null) {
    return null;
  }

  const piFieldNumber = piFieldId.replace('customfield_', '');
  // The type names are discovered from the instance, never assumed: DENP renamed Feature to Epic, and
  // a query naming a type Jira no longer defines is a 400 and an empty page. With no names known the
  // clause is dropped — the PI and Product Owner still scope the pull, which is wider but never blind.
  return [
    buildIssueTypeClause([...featureIssueTypeNames]),
    assigneeClause,
    `cf[${piFieldNumber}] = ${quoteJqlValue(trimmedPiName)}`,
  ].filter((clause) => clause !== '').join(' AND ');
}

/** Runs the direct Feature query and normalizes the issues into discovered Features. */
async function fetchDirectFeatures(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  settings: PiReviewPullSettings,
): Promise<DiscoveredFeature[]> {
  const featureIssueTypeNames = await loadFeatureIssueTypeNames();
  const directFeatureJql = buildDirectFeatureJql(
    piName, poAssigneeQueryValues, settings.piFieldId, featureIssueTypeNames, settings.productOwnerFieldId,
  );
  if (directFeatureJql === null) {
    return [];
  }

  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(directFeatureJql)}`
    + `&fields=${encodeURIComponent(DIRECT_FEATURE_FIELD_IDS.join(','))}`
    + `&maxResults=${DIRECT_FEATURE_SEARCH_MAX_RESULTS}`;
  const searchResponse = await jiraGet<{ issues?: JiraIssue[] }>(searchPath);
  return (searchResponse.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: typeof issue.fields?.summary === 'string' ? issue.fields.summary : '',
  }));
}

/** Turns a discovered Feature into a blank PI Review row whose feature cell carries the key + summary. */
function createFeatureRow(feature: DiscoveredFeature): PiReviewRow {
  const newRow = createEmptyPiReviewRow();
  const trimmedSummary = feature.summary.trim();
  newRow.feature = trimmedSummary === '' ? feature.key : `${feature.key} - ${trimmedSummary}`;
  return newRow;
}

/**
 * Pulls a team's Features for the given PI + Product Owner(s) via a single direct Jira query,
 * returning the rows that are not already in the table. Features on the caller-supplied ignore list
 * are skipped (and counted) so a Feature the user does not own stays out of the table on every
 * re-pull. When the query cannot be scoped (no PO or no PI) it resolves to an empty result without
 * contacting Jira. The ignore list is a plain parameter (not read from storage here) so the module
 * stays free of extra browser dependencies — it is also bundled into the server-side PI Review engine.
 */
export async function pullPiReviewFeatures(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  existingRows: readonly PiReviewRow[],
  settings: PiReviewPullSettings = readPiReviewPullSettings(),
  ignoredFeatureKeys: ReadonlySet<string> = new Set<string>(),
): Promise<PullPiReviewFeaturesResult> {
  const discoveredFeatures = await fetchDirectFeatures(piName, poAssigneeQueryValues, settings);

  // De-duplicate discovered Features by upper-cased key (Jira can, in theory, echo a key twice).
  const discoveredFeaturesByKey = new Map<string, DiscoveredFeature>();
  for (const discoveredFeature of discoveredFeatures) {
    discoveredFeaturesByKey.set(discoveredFeature.key.toUpperCase(), discoveredFeature);
  }

  const existingFeatureKeys = new Set(
    existingRows
      .map((row) => extractPiReviewFeatureKey(row.feature))
      .filter((featureKey): featureKey is string => featureKey !== null),
  );

  // A Feature already in the table is a dedupe, never an "ignored skip" — so the existing-rows
  // filter runs first and only genuinely new candidates are tested against the ignore list.
  const newCandidateFeatures = [...discoveredFeaturesByKey.values()]
    .filter((feature) => !existingFeatureKeys.has(feature.key.toUpperCase()));
  const keptFeatures = newCandidateFeatures
    .filter((feature) => !ignoredFeatureKeys.has(feature.key.toUpperCase()));

  const newRows = keptFeatures
    .sort((leftFeature, rightFeature) => leftFeature.key.localeCompare(rightFeature.key))
    .map(createFeatureRow);

  return {
    rows: newRows,
    discoveredCount: discoveredFeaturesByKey.size,
    addedCount: newRows.length,
    ignoredCount: newCandidateFeatures.length - keptFeatures.length,
  };
}
