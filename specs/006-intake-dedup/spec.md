# Feature Specification: Intake Deduplication (Phase 2A)

**Feature Branch**: `006-intake-dedup`

**Created**: 2026-07-01

**Status**: Draft

**Input**: Phase 2A of the Teams→Jira intake (feature 005): bulletproof, ingestion-independent
deduplication so a submission is never turned into more than one Jira issue — even across different
machines, re-imports, or a lost/reset local ledger.

## Summary

The Teams→Jira intake importer (feature 005) prevents duplicates today with a **local processed
ledger** keyed by submission `id`. That ledger is fast but fragile: it lives only in Toolbox's
shared store, so a reset ledger, a second machine, or an issue that was created just before the
ledger write failed can all lead to the **same submission becoming two Jira issues**.

This feature makes **Jira itself the source of truth** for "already created." When Toolbox creates
an issue from a submission it **stamps the submission id onto the issue** (as a label
`intake-<id>`). Before creating any issue, Toolbox **asks Jira** whether an issue already carries
that stamp; if so, it treats the submission as already-imported (shows the existing key, marks the
row Imported) and never creates a duplicate. The local ledger remains as a fast cache to avoid a
lookup for rows already known locally, but correctness no longer depends on it.

This is **additive** to the existing importer: parsing, convention mapping, per-row project routing,
reporter resolution + fallback origin note, the auto-create/review toggle, manual create, and retry
all stay exactly as they are — they just gain a reliable pre-create existence check and a stamp.

## Scope Boundary (explicit non-goals)

- **In scope**: stamping the submission id on created issues; a pre-create existence check against
  Jira by that stamp; reconciling the queue/ledger from what Jira reports; making dedup hold across
  machines, re-imports, and a missing local ledger.
- **Out of scope (2A)**: the SharePoint List relay pull / automated ingestion (that is Phase 2B).
- **Out of scope (2A)**: writing `Imported`/status back to the Excel/SharePoint store.
- **Out of scope**: changing the field mapping, project routing, or reporter behavior from 005.
- **Out of scope**: back-filling stamps onto issues created before this feature (they were tracked
  only by the local ledger; a documented one-time note covers the transition).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No duplicates even without the local ledger (Priority: P1)

A Toolbox user (possibly on a different machine, or after the shared ledger was cleared) imports a
file whose submissions were already turned into Jira issues by an earlier run. Toolbox must not
create a second copy of any of them.

**Why this priority**: This is the core promise of the feature — the one failure the current design
can't prevent. Everything else supports it.

**Independent Test**: With an empty local ledger, import a file whose rows were already created
(issues exist in Jira carrying `intake-<id>`). Confirm Toolbox marks every row Imported with the
existing Jira key and creates **zero** new issues.

**Acceptance Scenarios**:

1. **Given** an issue in Jira already carries `intake-<id>` for submission X and the local ledger is
   empty, **When** the user imports a file containing X and creates, **Then** Toolbox finds the
   existing issue, shows its key, marks X Imported, and does **not** create a new issue.
2. **Given** submission X has never been created (no stamped issue, not in the ledger), **When** the
   user creates it, **Then** Toolbox creates exactly one issue **stamped** with `intake-<id>` and
   records X locally.
3. **Given** two Toolbox instances import the same file, **When** both attempt to create X, **Then**
   the pre-create check prevents a second issue (at most one issue carries `intake-<id>`).

### User Story 2 - Recover from a mid-create failure (Priority: P1)

An issue was successfully created in Jira, but Toolbox crashed or the ledger write failed before the
submission was recorded locally. On the next import the submission looks "new" locally.

**Why this priority**: This is the concrete gap that motivated the feature; it must be closed.

**Independent Test**: Simulate a created-but-not-recorded submission (issue stamped in Jira, absent
from the ledger). Re-import and create; confirm no duplicate is created and the row reconciles to
the existing key.

**Acceptance Scenarios**:

1. **Given** submission X's issue exists and is stamped but X is missing from the local ledger,
   **When** X is processed again, **Then** Toolbox detects the existing issue and reconciles (marks
   Imported with the existing key, adds X to the local ledger) instead of creating a duplicate.

### User Story 3 - Fast path for already-known submissions (Priority: P2)

Re-importing a large file that is mostly already-processed should stay responsive and not hammer
Jira with a lookup for every row.

**Why this priority**: Keeps the guarantee affordable at scale; a correctness feature that is too
slow won't be used.

**Independent Test**: Re-import a file where most rows are already in the local ledger; confirm
those rows are shown Imported without a per-row Jira lookup, and only not-locally-known rows incur a
check.

**Acceptance Scenarios**:

1. **Given** submission X is already in the local ledger with a key, **When** the file is
   re-imported, **Then** X is shown Imported from the cache without a Jira existence check.
2. **Given** a batch of not-locally-known rows, **When** they are checked, **Then** the existence
   checks are batched so the queue stays responsive (no unbounded per-row round-trips).

### Edge Cases

- **Stamp exists but Jira lookup fails/times out**: the create is not attempted blindly — the row is
  surfaced as needing attention (not silently created and not silently skipped), so the user can
  retry rather than risk a duplicate.
- **Multiple issues somehow carry the same `intake-<id>`** (pre-existing data): Toolbox reports the
  ambiguity for that submission and does not create another; it shows the matching keys.
- **A submission id that is blank/malformed**: handled as today (row flagged invalid); no stamp
  check is attempted.
- **Label already present from a prior tool/manual edit**: treated as a valid existing stamp (the
  submission is considered already-created) — the stamp's meaning is "an issue for this submission
  exists."
- **Very large id / label formatting**: the id is used verbatim as `intake-<id>`; if an id cannot
  form a valid label, the row is flagged rather than mis-stamped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When creating an issue from a submission, the tool MUST stamp the created issue with a
  Jira label that encodes the submission id, of the form `intake-<id>`.
- **FR-002**: Before creating an issue for a submission, the tool MUST check Jira for an existing
  issue carrying that submission's stamp, and MUST NOT create a new issue when one already exists.
- **FR-003**: When an existing stamped issue is found, the tool MUST treat the submission as
  already-imported: show/record the existing Jira key, mark the row Imported, and reconcile the
  local ledger to match.
- **FR-004**: Deduplication MUST hold independently of the local ledger — i.e. with an empty or
  reset ledger, or on a different machine, no submission that already has a stamped issue is created
  again.
- **FR-005**: The local processed ledger MUST remain as a fast cache: submissions already recorded
  locally MAY be shown Imported without a Jira existence check; only rows not known locally require
  a check.
- **FR-006**: Existence checks for not-locally-known submissions MUST be batched/efficient so a
  large re-import remains responsive (no unbounded one-request-per-row pattern).
- **FR-007**: When the existence check cannot be completed (Jira unreachable/ambiguous), the tool
  MUST NOT create the issue and MUST surface the row for user attention/retry, making no partial
  change.
- **FR-008**: The behavior MUST apply uniformly to every create path: auto-create-on-import, the
  manual bulk "create" action, per-row create, and retry of a failed row.
- **FR-009**: All existing intake behavior (parsing, convention mapping, project routing, reporter
  resolution and fallback origin note, queue display) MUST be unchanged by this feature.
- **FR-010**: The stamp MUST be visible/queryable on the created issue so a human can also confirm
  provenance in Jira (e.g. by searching for the label).

### Key Entities *(include if feature involves data)*

- **Submission stamp**: The durable mark placed on a created Jira issue that encodes the originating
  submission id (`intake-<id>`). The authoritative "this submission was already turned into an
  issue" record.
- **Existence check result**: For a given submission id, whether Jira already holds a stamped issue,
  and if so which key(s) — drives the create/skip/reconcile/attention decision.
- **Processed ledger (existing)**: The local fast cache mapping submission id → created Jira key;
  now reconciled from Jira results rather than being the sole source of truth.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across any number of imports, machines, or ledger states, a given submission results
  in **at most one** Jira issue (0 duplicates).
- **SC-002**: With the local ledger emptied, re-importing a fully-processed file creates **0** new
  issues and reconciles **100%** of rows to their existing keys.
- **SC-003**: A created-but-not-recorded submission (mid-failure) produces **0** duplicates on the
  next run and reconciles to the existing key.
- **SC-004**: Re-importing a file that is already mostly processed stays responsive — already-known
  rows resolve from the cache with no per-row Jira lookup, and unknown-row checks are batched.
- **SC-005**: When Jira cannot be reached for the check, **0** issues are created and every affected
  row is clearly flagged for retry.
- **SC-006**: Every issue Toolbox creates carries its `intake-<id>` stamp and is findable in Jira by
  that stamp.

## Assumptions

- Jira is **Data Center**; issues support labels and label-based JQL search via the existing Toolbox
  Jira proxy.
- Submission ids are unique per submission (GUIDs from the Teams flow) and form valid Jira labels
  (`intake-<guid>` — no spaces; hyphens allowed).
- The existing Jira proxy account has permission to set labels on create and to search issues.
- Issues created before this feature were tracked only by the local ledger; they will not be
  retroactively stamped (documented transition note). Going forward every created issue is stamped.
- This feature reuses the feature 005 importer end to end and only adds the stamp + pre-create check
  + reconciliation.

## Dependencies

- The existing feature 005 JiraIntake importer (create path, local ledger, queue).
- The existing Jira proxy (`/jira-proxy`) for issue search (JQL) and issue create with labels.
- No dependency on Phase 2B (SharePoint relay) or on any write-back to the source store.
