# Data Model: SNow Hub Wizard

All entities live in the browser of the origin the app runs in, under keys prefixed `snowWizard:`.

## WizardJob

| Field | Type | Rule |
|---|---|---|
| jobId | string | random, stable for the job's life |
| kind | `newChange \| modifyChange \| prbToJira \| reviewChange` | fixed at start |
| stepId | string | current step; **derived** from entries on resume (no step can be ahead of its prerequisites) |
| updatedAt | ISO string | for the "resume?" prompt |
| payloadKey | string | the key holding the job's data (e.g. the `useCrgState` storage key) |

Lifecycle: `started → inProgress → finished | abandoned`. Finished jobs are kept 7 days for the result screen, then
removed. One in-progress job per kind; starting another asks to resume or discard.

## ConnectionState

| Field | Type | Rule |
|---|---|---|
| system | `snow \| jira` | |
| status | `notConnected \| connecting \| connected \| expired` | `connected` only after a live read succeeds |
| identity | string? | the signed-in user's display name, shown on the banner |
| lastCheckedAt | ISO string | |

## CtaskEnvironmentPlan

`Record<ctaskTypeLabel, Record<EnvironmentKey, boolean>>`, `EnvironmentKey = 'REL' | 'PRD' | 'PFIX'`.
Invariants: every selected CTASK has ≥ 1 environment ticked; only enabled environments may be ticked; seeded from
`CTASK_ENVIRONMENT_DEFAULTS` overlaid with the user's saved defaults.

## CheckResult (= 039 `ReadinessItem`)

`{ id, label, state: 'done'|'needsAction'|'notApplicable'|'couldNotCheck', reason, action }` — produced only by the 039
engine. `isReady` ⇔ no `needsAction` and no unacknowledged `couldNotCheck`.

## CoachingNote

| Field | Type | Rule |
|---|---|---|
| changeNumber | string | |
| creatorName | string | from the change's `opened_by`/requested-by |
| items | `{ checkId, missing, whyItMatters, goodExample }[]` | one per `needsAction` item, in engine order |
| notCheckedLabels | string[] | `couldNotCheck` items — never coached |
| reviewerEdits | string? | free text replacing the generated body when edited |

## PrbJiraJob

| Field | Type | Rule |
|---|---|---|
| prbNumber | string | |
| epicKey | string | chosen from a Jira search |
| drafts | `{ role: 'defect'|'sl'|'qe', summary, description, issueType }[3]` | user-editable |
| createdKeys | `Partial<Record<role, string>>` | filled as each create succeeds |
| linkedRoles | role[] | stories whose link to the Defect succeeded |

State: `drafting → creating → complete | partial`. `partial` ⇒ Retry creates only roles missing from `createdKeys`
and links only stories missing from `linkedRoles`.
