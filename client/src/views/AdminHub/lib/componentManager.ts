// componentManager.ts — The logic for the Admin Hub Jira Component Manager: list/export a project's
// components, bulk-import a list of component names into one or more projects (idempotently), and
// bulk-remove named components from a project. Pure helpers (parsing, matching, formatting) are separated
// from the thin Jira I/O so the rules are unit-tested; every write delegates to a jiraApi verb.

import { jiraDelete, jiraGet, jiraPost } from '../../../services/jiraApi.ts';

/** A Jira project component as this tool reads/writes it. */
export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
}

/** Per-project outcome of an import run. */
export interface ProjectImportResult {
  projectKey: string;
  created: string[];
  skipped: string[];          // names that already existed on the project
  failed: { name: string; reason: string }[];
}

/** Outcome of a bulk-remove run against a single project. */
export interface RemoveResult {
  deleted: JiraComponent[];
  failed: { name: string; reason: string }[];
  unmatched: string[];        // requested names with no matching component on the project
}

/**
 * Parses a pasted block of component names into a clean, de-duplicated list. Accepts newline- and/or
 * comma-separated input, trims each entry, drops blanks, and removes case-insensitive duplicates while
 * preserving the first occurrence's original spelling.
 */
export function parseComponentNames(rawText: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawEntry of rawText.split(/[\n,]/)) {
    const name = rawEntry.trim();
    if (name === '') {
      continue;
    }
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** Splits and normalises a list of project keys (newline/comma/space separated, upper-cased, de-duped). */
export function parseProjectKeys(rawText: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const rawEntry of rawText.split(/[\n,\s]/)) {
    const key = rawEntry.trim().toUpperCase();
    if (key !== '' && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** Matches requested names against existing components by case-insensitive name; splits matched/unmatched. */
export function matchComponentsByName(
  components: JiraComponent[],
  names: string[],
): { matched: JiraComponent[]; unmatched: string[] } {
  const componentsByName = new Map(components.map((component) => [component.name.toLowerCase(), component]));
  const matched: JiraComponent[] = [];
  const unmatched: string[] = [];
  for (const name of names) {
    const component = componentsByName.get(name.trim().toLowerCase());
    if (component) {
      matched.push(component);
    } else {
      unmatched.push(name);
    }
  }
  return { matched, unmatched };
}

/** Renders a component list as newline-separated names, for copy/download export. */
export function formatComponentsForExport(components: JiraComponent[]): string {
  return components.map((component) => component.name).join('\n');
}

/** Fetches all components on a project (the export source and the match source for import/remove). */
export function listProjectComponents(projectKey: string): Promise<JiraComponent[]> {
  return jiraGet<JiraComponent[]>(`/rest/api/2/project/${encodeURIComponent(projectKey)}/components`);
}

/**
 * Imports the given component names into every target project. For each project, existing names are
 * skipped (idempotent) and only genuinely new names are created; a per-name failure is captured without
 * aborting the run so one bad name never blocks the rest.
 */
export async function importComponentsToProjects(names: string[], projectKeys: string[]): Promise<ProjectImportResult[]> {
  const results: ProjectImportResult[] = [];
  for (const projectKey of projectKeys) {
    const result: ProjectImportResult = { projectKey, created: [], skipped: [], failed: [] };
    const existing = await listProjectComponents(projectKey);
    const existingNames = new Set(existing.map((component) => component.name.toLowerCase()));
    for (const name of names) {
      if (existingNames.has(name.toLowerCase())) {
        result.skipped.push(name);
        continue;
      }
      try {
        await jiraPost('/rest/api/2/component', { name, project: projectKey });
        result.created.push(name);
        existingNames.add(name.toLowerCase()); // guard against duplicates within the same list
      } catch (createError) {
        result.failed.push({ name, reason: createError instanceof Error ? createError.message : String(createError) });
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Removes the named components from a project. Names are matched by exact (case-insensitive) name; a
 * name with no match is reported as unmatched (never a silent no-op), and each delete failure is captured.
 * Deleting a component also removes it from any issues that reference it — the UI confirms before calling.
 */
export async function bulkRemoveComponents(projectKey: string, names: string[]): Promise<RemoveResult> {
  const components = await listProjectComponents(projectKey);
  const { matched, unmatched } = matchComponentsByName(components, names);
  const deleted: JiraComponent[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const component of matched) {
    try {
      await jiraDelete(`/rest/api/2/component/${encodeURIComponent(component.id)}`);
      deleted.push(component);
    } catch (deleteError) {
      failed.push({ name: component.name, reason: deleteError instanceof Error ? deleteError.message : String(deleteError) });
    }
  }
  return { deleted, failed, unmatched };
}
