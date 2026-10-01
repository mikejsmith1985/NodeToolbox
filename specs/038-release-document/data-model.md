# Data Model: Release Document (038)

## ReleaseVersion
| Field | Type | Notes |
|---|---|---|
| id | string | Jira version id (team project) |
| name | string | e.g. `10/14/2026` |
| releaseDate | string \| null | ISO date |
| isReleased | boolean | released or archived → never listed or synced |
| pageTitle | string \| null | `YYYYMMMDD` (e.g. `2026Oct14`); null → "needs a release date" |

## ReleaseItem (Jira-synced)
| Field | Type | Notes |
|---|---|---|
| key | string | linked to Jira on the page |
| summary, issueTypeName, statusName, assigneeName | string | assignee empty → "Unassigned" |
| fixVersionNames | string[] | compared by name |
| epicKey | string \| null | via `extractFeatureKeyFromIssueFields` |
| notes | string | **hand-entered**, preserved by key, travels on moves |

## EpicGroup
| Field | Type | Notes |
|---|---|---|
| epicKey | string \| null | null = "No Epic" group, always listed last |
| epic | ReleaseItem-like \| null | null when unreadable → "Epic not readable" |
| items | ReleaseItem[] | children in this release, in Jira order |
| outsideItems | { key, fixVersionNames }[] | team children of this Epic NOT in this release |
| misalignments | Misalignment[] | |

## Misalignment
| kind | Meaning |
|---|---|
| `epic-has-no-version` | a child is in this release; its Epic has no fixVersion |
| `epic-in-other-version` | a child is in this release; its Epic names other versions |
| `child-outside-release` | the Epic is in this release; a team child is in another version or none |

## DeploymentStep (hand-entered, per release)
| Field | Notes |
|---|---|
| id | client-side row id |
| pr, workflowRun | rendered as links when they are URLs |
| repo, branch, jobType, application, environment, repository, tag, task, module, logLevel | free text, kept verbatim |

Order is the user's. Read back from the page on every load.

## ReleaseDocument
`{ version: ReleaseVersion; groups: EpicGroup[]; deploymentSteps: DeploymentStep[]; lastSyncedIso: string }`

## Lifecycle
- **Load**: read page (if any) → parse deployment steps + notes → gather from Jira → merge notes by key.
- **Save**: build storage → update (version + 1; one conflict retry) or create under the parent.
- **Sync all**: read every unreleased page → collect notes by key → gather each release → write each page.
