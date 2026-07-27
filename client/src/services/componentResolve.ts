// componentResolve.ts — Resolves Jira component names to a project's component ids (spec 031, M3).
//
// Components are written to an issue as `[{ id }, …]`, but the classification allowlist is keyed by NAME
// (a repo is one thing across projects). This maps names → this project's ids at write time. It lives in
// services (shared) and calls the project-components endpoint directly, so the PO Tool and the ArtView
// planner can both use it without a cross-view import.

import { jiraGet } from './jiraApi.ts';

interface ProjectComponent {
  id: string;
  name: string;
}

/** The outcome of resolving names → ids for a project: the matched pairs, and any name with no match. */
export interface ResolvedComponents {
  ids: { name: string; id: string }[];
  unresolved: string[];
}

/**
 * Maps component names to this project's component ids (case-insensitive). A name with no matching component
 * on the project is reported in `unresolved` — never silently dropped — so the caller can surface it.
 */
export async function resolveComponentIdsByName(projectKey: string, names: readonly string[]): Promise<ResolvedComponents> {
  const components = await jiraGet<ProjectComponent[]>(
    `/rest/api/2/project/${encodeURIComponent(projectKey)}/components`,
  );
  const componentByName = new Map(components.map((component) => [component.name.trim().toLowerCase(), component]));

  const ids: { name: string; id: string }[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    const match = componentByName.get(name.trim().toLowerCase());
    if (match) {
      ids.push({ name: match.name, id: match.id });
    } else {
      unresolved.push(name);
    }
  }
  return { ids, unresolved };
}
