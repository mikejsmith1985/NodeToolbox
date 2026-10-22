// projectSearch.ts — Finds Jira projects by key or name for the Wizard's project pickers: people know a project by its
// key (ENCUC, DENP), so the key ranks first and every project is listed key-first.

/** The two things a picker needs from a Jira project. */
export interface ProjectChoice {
  key: string;
  name: string;
}

// Lower rank sorts first: the key typed in full, then keys starting with the text, then keys or names containing it.
const EXACT_KEY_RANK = 0;
const KEY_PREFIX_RANK = 1;
const CONTAINS_RANK = 2;
const NO_MATCH_RANK = 3;

const normaliseSearchText = (searchText: string) => searchText.trim().toLowerCase();

function rankProject(project: ProjectChoice, searchText: string): number {
  const projectKey = project.key.toLowerCase();
  if (projectKey === searchText) return EXACT_KEY_RANK;
  if (projectKey.startsWith(searchText)) return KEY_PREFIX_RANK;
  if (projectKey.includes(searchText) || project.name.toLowerCase().includes(searchText)) return CONTAINS_RANK;
  return NO_MATCH_RANK;
}

/** The projects matching the typed text, best match first; every project, sorted by key, when nothing is typed. */
export function findProjects<TProject extends ProjectChoice>(projects: readonly TProject[], searchText: string): TProject[] {
  const wantedText = normaliseSearchText(searchText);
  return projects
    .map((project) => ({ project, rank: wantedText === '' ? EXACT_KEY_RANK : rankProject(project, wantedText) }))
    .filter(({ rank }) => rank !== NO_MATCH_RANK)
    .sort((left, right) => left.rank - right.rank || left.project.key.localeCompare(right.project.key))
    .map(({ project }) => project);
}

/** The key of the project whose key was typed in full, or '' — so typing "ENCUC" picks ENCUC straight away. */
export function findExactProjectKey(projects: readonly ProjectChoice[], searchText: string): string {
  const wantedText = normaliseSearchText(searchText);
  return projects.find((project) => project.key.toLowerCase() === wantedText)?.key ?? '';
}

/** "ENCUC — Enrollment Customer Care": key first, so the list reads the way people name projects. */
export function labelProject(project: ProjectChoice): string {
  return `${project.key} — ${project.name}`;
}
