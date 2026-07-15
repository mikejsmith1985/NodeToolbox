# Specification Quality Checklist: PO Tool — Feature Splitter & Feature Composition

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — **all 3 resolved 2026-07-15**
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

**Status: PASS — ready for `/speckit-plan`.**

## Notes

### Clarifications resolved (Session 2026-07-15)

| Q | Decision | Encoded at |
|---|----------|-----------|
| Q1 | **Independent** team/PI selection; explicit context input, backward-compatible | FR-005, FR-005a–c, A2, SC-015 |
| Q2 | Split → **smaller peer Features**; original **kept + linked**, never closed/transitioned/deleted | FR-016, FR-016a–c, A16, A17, SC-016 |
| Q3 | Ingestion = **file upload + Confluence fetch-by-URL + paste** (+ live Jira keys) | FR-023, FR-023a–d, A14, A15, SC-017–019 |

### Deliberate defaults (documented, not asked)

Per the max-3 limit, resolved by informed default and recorded in Assumptions:

- Draft persistence = client-side, scoped, versioned/self-healing, survives sessions until commit (A4) — reads
  the requester's "persist in memory till written to Jira" against the established overlay/draft pattern.
- AI = existing passphrase gate + copy-paste validated-JSON round-trip, unaccepted-by-default, local-only until
  commit (A5); the automated dispatch-and-poll path is explicitly *not* assumed (A6).
- Hygiene = consume the **client** rules as source of truth (A7).
- Creation follows the established create path incl. required-field pre-flight (A9).

### Framework-First gate (Article VII) — passed, with a notable finding

The spec commits to reusing the existing AI gate, JSON-ingest primitive, hygiene engine, draft pattern, Jira
proxy, and create path rather than rebuilding any of them.

**Q3=C is far cheaper than it appeared, and the gate is what surfaced it.** Before writing file upload as a new
build, a dependency check found the capability already present:

- **SheetJS (`xlsx`) already ships as a client dependency** and is already loaded via **dynamic import** in three
  places specifically to keep it out of the main bundle.
- **A drag-and-drop / click-to-pick dropzone** accepting `.xlsx/.xls/.csv` already exists (Jira Intake importer).
- **A `File` → workbook → header-keyed-rows parser** with a typed, user-facing error class already exists, with
  tests.

So FR-023a adds **no new library** (A14, SC-019). Whether the existing components are lifted to a shared location
or re-implemented against the same primitives is a **planning** decision, deliberately left to `/speckit-plan`.
Confluence retrieval likewise reuses the existing server-side proxy and its configured credentials (A15) — no new
credential, no browser OAuth.

The genuinely new build is the two authoring surfaces themselves — a documented gap.

### Risks carried into planning

- **A2 / FR-005c is the schedule risk.** Independent selection is the right call, but "which team is selected" is
  currently one app-wide value, and at least one shared team-scoped store keeps only **one** live team profile at
  a time. Lifting the tabs' two store reads into props is small and backward-compatible; making *both tools open
  at once on different teams* genuinely correct may be larger. `/speckit-plan` must size this explicitly — it is
  the one place where "just mount the tabs" could quietly become a refactor.
- **Q3=C is still the largest new surface** even after the reuse finding — three ingestion paths plus a
  workspace/reference UI.

### Findings surfaced during specification (flagged, out of scope)

Both are pre-existing conditions this feature neither worsens nor repairs, recorded so they are not mistaken for
new risk introduced here:

- **Hygiene client/server rule drift is real** (A7): differing check ids (`stale` vs `stale-issue`), differing
  severities (`missing-feature-link`, `no-assignee`, `target-end-overdue`, `due-date-overdue`), a server-side
  no-op check, and an off-by-one on the 30-day boundary — despite an in-code instruction never to diverge.
  Consuming the client rules sidesteps this; reconciling it deserves its own effort.
- **The AI Assist gate is cosmetic** (A8): it is a client-side SHA-256 passphrase check, and the underlying
  `/api/ai-assist/*` endpoints have no authorization at all (one also returns the webhook secret in cleartext).
  This feature relies on the gate only for discoverability, never for security. **Recommend a separate security
  effort**; it is out of scope here.

### Constitution alignment

- Article VI — no auxiliary status docs created; artifacts live only under `specs/017-po-feature-tools/`.
- Article VII — see the Framework-First gate above; the one new-build area is a documented gap.
- Article X — Success Criteria are behavioral and evidence-based (e.g. SC-006 is verified by observing zero write
  calls across a full AI cycle; SC-016 by inspecting the original's unchanged state after a split).
