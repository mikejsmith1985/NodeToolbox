// resolveProjectKey.ts — Resolves which Jira project a submission targets. The submission's
// "project" column carries a team NAME (e.g. "Cleanup Crew"); Toolbox maps it to a project key
// (e.g. "ENCUC") via the configured team→project mappings. A blank team falls back to the default
// project. Pure (no I/O). See data-model.md.

import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

/** The outcome of resolving a submission's target project. */
export type ProjectResolution =
  | { ok: true; projectKey: string }
  | { ok: false; kind: 'unmapped-team' | 'no-project'; reason: string };

/**
 * Resolves the target project key for a submission. A team name that isn't mapped is an
 * `unmapped-team` failure (a data/config gap the user must fix); a blank team with no default
 * project is a `no-project` failure (the settings are incomplete).
 */
export function resolveProjectKey(submission: IntakeSubmission, config: IntakeConfig): ProjectResolution {
  const teamName = submission.fields.project.trim();

  if (teamName !== '') {
    const mapping = (config.teamProjectMappings ?? []).find(
      (candidate) => candidate.teamName.trim().toLowerCase() === teamName.toLowerCase() && candidate.projectKey.trim() !== '',
    );
    if (mapping) {
      return { ok: true, projectKey: mapping.projectKey.trim().toUpperCase() };
    }
    return {
      ok: false,
      kind: 'unmapped-team',
      reason: `No project mapping for team "${teamName}" — add it in Intake settings.`,
    };
  }

  if (config.projectKey.trim() !== '') {
    return { ok: true, projectKey: config.projectKey.trim().toUpperCase() };
  }
  return { ok: false, kind: 'no-project', reason: 'Set a default target project before creating issues.' };
}
