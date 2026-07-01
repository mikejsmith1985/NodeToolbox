// resolveProjectKey.ts — Resolves which Jira project a submission targets. The submission's
// "project" column carries a friendly project NAME (e.g. "Cleanup Crew"); Toolbox maps it to a Jira
// project key (e.g. "ENCUC") via the configured project mappings. A blank value falls back to the
// default project. Pure (no I/O). See data-model.md.

import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

/** The outcome of resolving a submission's target project. */
export type ProjectResolution =
  | { ok: true; projectKey: string }
  | { ok: false; kind: 'unmapped-project' | 'no-project'; reason: string };

/**
 * Resolves the target Jira project key for a submission. A project name that isn't mapped is an
 * `unmapped-project` failure (a data/config gap the user must fix); a blank value with no default
 * project is a `no-project` failure (the settings are incomplete).
 */
export function resolveProjectKey(submission: IntakeSubmission, config: IntakeConfig): ProjectResolution {
  const projectName = submission.fields.project.trim();

  if (projectName !== '') {
    const mapping = (config.projectMappings ?? []).find(
      (candidate) => candidate.projectName.trim().toLowerCase() === projectName.toLowerCase() && candidate.projectKey.trim() !== '',
    );
    if (mapping) {
      return { ok: true, projectKey: mapping.projectKey.trim().toUpperCase() };
    }
    return {
      ok: false,
      kind: 'unmapped-project',
      reason: `No Jira project mapping for "${projectName}" — add it in Intake settings.`,
    };
  }

  if (config.projectKey.trim() !== '') {
    return { ok: true, projectKey: config.projectKey.trim().toUpperCase() };
  }
  return { ok: false, kind: 'no-project', reason: 'Set a default target project before creating issues.' };
}
