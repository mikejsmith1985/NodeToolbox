# Feature Specification: Component (Repo) Mapping & Repo-Only Story Generation

**Feature Branch**: `feature/031-component-repo-mapping`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "We have the component import section which I used to import the currently known 68 repos. Could we also have the AI assist attempt to map the required components (repos) to the Feature? This way the components are always there, never empty, but still always require a HITL review. In some cases there may be other components like 'Enrollment' or 'Transformers' which could map to the appropriate team (e.g. a Transformers component assigned to all Features for the Transformers team). Both of my teams are Enrollment, so the Enrollment component could always be set — however I never want to generate a story for that. I only want to generate stories based on the repo touched, which is housed in the component field, and I have no way to enforce that only repos get put into the component field."

## Context

Jira's `components` field on a Feature is doing **two different jobs at once**, and nothing tells them apart:

- **Repo components** — the ~68 repositories imported as component values. These are meant to indicate *which
  codebases a Feature touches*, and each repo touched should become **one story** during PI planning.
- **Domain / team components** — organisational tags such as "Enrollment" or "Transformers". These classify
  *which team or product area* a Feature belongs to. They must **never** generate a story.

Because Jira offers no way to mark a component as "a repo" versus "a tag", any tool that generates stories from
the component field cannot tell which components are repos. Today this is unenforceable on the Jira side. This
feature moves the distinction into Toolbox: **each imported component is classified `repo` or `domain` at import
time**, that classification becomes the authoritative allowlist, and every downstream behaviour keys off it.

On top of that classification, this feature adds two capabilities the Product Owner asked for:

1. A **propose-only, human-reviewed AI mapping** that suggests which **repo** components a Feature touches — from
   the Feature's own content and the repo allowlist — so the component field is **never empty** yet is **always
   reviewed** before anything is written. The mapping is constrained to the repo allowlist by construction, so a
   non-repo tag can never be proposed as a repo.
2. A **repo-only story generation** rule: PI planning creates **one story per repo component** on a Feature and
   **never** a story for a domain component. Domain components can still be present on the Feature (set by a
   deterministic per-team rule), but they are excluded from story generation by construction.

The feature must not bend the project's **AI rules**: the mapping is **propose-only** (a prompt the operator runs
in their own assistant, a structured reply pasted back — **no automated or background AI**), **gated** behind the
AI unlock, applied **per item on explicit accept**, and it **never attributes content to AI**. The domain-component
rule is **deterministic** — never AI.

## Clarifications

### Session 2026-07-27

- Q: How is a component known to be a repo versus a domain/team tag? → A: **Tagged explicitly at import time** in the
  Component Manager — each component is classified `repo` or `domain`; the tool does not guess from names.
- Q: Where does the AI component mapping run? → A: **Both surfaces** — Feature Composition (when authoring a Feature)
  and the PI Planner (before story generation).
- Q: How many stories does a Feature get? → A: **One story per repo component** on the Feature (deterministic from the
  mapped repo set), each reviewable/editable before creation; domain components never produce a story.
- Q: How do domain/team components get onto a Feature? → A: By a **deterministic per-team rule** ("these teams always
  get these domain components") — applied automatically, never by AI, and never story-generating.
- Q: How does repo-story generation relate to the PI Planner's existing AI Feature→Story breakdown (feature 028)? →
  A: The deterministic **one-story-per-repo IS the story set** for repo-driven Features; the 028 AI breakdown is not
  used to decide story count or identity for them (it remains available for other uses, unremoved).
- Q: When a Feature has no repo components mapped, what does story generation produce? → A: **Zero stories**, with an
  honest "map repos first" prompt — no fallback to the AI breakdown, no guessing.
- Q: How is a generated repo-story named, and how is its repo recorded? → A: Title = **`{Feature summary} ({Repo})`**
  (repo in parentheses, per the org convention in GH #220), **PO-editable** before creation; **and** each Story's own
  `components` field is set to its single repo (so it is filterable/sortable by component).
- Q: Which "team" does the deterministic domain-component rule attach to? → A: The **saved Dashboard Team profile**
  the PO Tool / PI Planner already select (no new team concept).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Classify components as repo or domain at import (Priority: P1)

An admin/PO importing or reviewing the known components in the Component Manager marks each component as either a
**repo** (a codebase that should drive a story) or a **domain** tag (an organisational label that must not). The
classification is saved and becomes the authoritative list the rest of the feature uses. Components that already
exist can be (re)classified without re-importing them.

**Why this priority**: Nothing else in this feature can be correct without knowing which components are repos.
The classification is the allowlist that makes the AI mapping safe and makes story generation repo-only. It is the
foundation and the MVP's first half.

**Independent Test**: In the Component Manager, classify a set of components (some repo, some domain), reload the
tool, and confirm each component's classification persisted and is shown; confirm an unclassified component is
clearly surfaced as "not yet classified" rather than silently treated as either kind.

**Acceptance Scenarios**:

1. **Given** a list of components (imported or fetched), **When** the admin classifies each as repo or domain,
   **Then** the classification is saved and shown against each component.
2. **Given** a saved classification, **When** the tool is reopened, **Then** every component's repo/domain
   classification is exactly as left.
3. **Given** a component that has not been classified, **When** the list is shown, **Then** it is clearly marked
   "not yet classified" and is treated as **neither** repo nor domain until a human classifies it (never guessed).
4. **Given** an existing component, **When** the admin changes its classification, **Then** the change is saved and
   immediately reflected everywhere the classification is used.

---

### User Story 2 - AI-propose the repo components a Feature touches (Priority: P1)

While authoring or refining a Feature (in Feature Composition), the PO unlocks AI, generates a prompt that carries
the Feature's content and the **repo allowlist**, runs it in their assistant, and pastes the structured reply back.
The tool proposes the repo components the Feature appears to touch — **only** from the allowlist — and the PO
reviews, adjusts, and accepts them. On accept, those components are written to the Feature's component field. The
component field is never left empty for a Feature that has been through this step, yet nothing is set without human
review.

**Why this priority**: This is the "never empty, always HITL" capability the PO asked for, and it produces the repo
set that story generation consumes. With US1 it forms the MVP.

**Independent Test**: On a Feature with descriptive content, unlock AI, generate the prompt, paste a reply naming
some allowlist repos plus one non-allowlist value; confirm the allowlist repos are proposed for review, the
non-allowlist value is rejected with a reason, and accepting writes the chosen repo components to the Feature.

**Acceptance Scenarios**:

1. **Given** an unlocked AI session and a Feature, **When** the PO generates the mapping prompt, **Then** the prompt
   contains the Feature's content and the **repo allowlist**, and instructs a structured reply naming components
   only from that allowlist.
2. **Given** a reply, **When** it is ingested, **Then** each proposed component that is on the repo allowlist is
   offered for review, and any value **not** on the allowlist (e.g. a domain tag or an unknown string) is
   **rejected with a reason** and never proposed.
3. **Given** proposed components, **When** the PO accepts, **Then** those components are written to the Feature via
   the standard field mapping (resolved by the app's field ids, never a hardcoded field name) and nothing is
   written until the explicit accept.
4. **Given** AI is locked, **When** the PO opens the Feature, **Then** the mapping prompt/ingest is unavailable and
   no trace of it is shown; every other part of the Feature remains usable.
5. **Given** any mapping, **When** it is produced, **Then** nothing about the components or the Feature is attributed
   to AI.

---

### User Story 3 - Generate one story per repo, never per domain tag (Priority: P1)

When the PO runs PI planning for a Feature, the tool proposes **one story per repo component** on that Feature and
**no** story for any domain component, even though domain components may be present on the Feature. The PO reviews
and edits the proposed stories before any are created, and only repo-driven stories are created.

**Why this priority**: This is the payoff — the reason the repo/domain distinction exists. It depends on US1's
classification and US2's mapped repos, and it delivers "only generate stories based on the repo touched".

**Independent Test**: Take a Feature whose components include several repos and at least one domain tag (e.g.
Enrollment); run story generation; confirm exactly one story is proposed per repo component and **zero** stories
are proposed for the domain tag; create them and confirm the same.

**Acceptance Scenarios**:

1. **Given** a Feature whose components include repo components and domain components, **When** story generation
   runs, **Then** it proposes exactly one story per **repo** component and **no** story for any domain component.
2. **Given** a domain component on a Feature, **When** story generation runs, **Then** that component never appears
   as a story and is never counted toward the story total.
3. **Given** proposed repo-stories, **When** the PO reviews them, **Then** each can be edited or removed before
   creation, and only accepted stories are created.
4. **Given** a Feature with a component that is **not yet classified**, **When** story generation runs, **Then**
   that component is **not** turned into a story and is surfaced as needing classification (never guessed as a repo).
5. **Given** a repo-story is proposed, **When** the PO reviews it, **Then** its title is `{Feature summary} ({Repo})`
   (editable) and its own `components` field is set to that single repo, so it can be filtered/sorted by component.
6. **Given** a Feature with **no** repo components, **When** story generation runs, **Then** zero stories are proposed
   and the PO is prompted to map repos first (no fallback to the AI breakdown).

---

### User Story 4 - Auto-apply a team's domain components by rule (Priority: P2)

For a team that always belongs to a domain (both of the PO's teams are "Enrollment"), the PO configures a rule so
that Features for that team always carry the team's domain component(s). The rule is applied deterministically —
never by AI — and the applied domain components never generate a story.

**Why this priority**: It removes repetitive manual tagging and guarantees the organisational tag is present, while
the repo-only story rule (US3) ensures it stays story-free. It builds on the classification (US1) and complements
the mapping (US2) but is not required for the MVP.

**Independent Test**: Configure a team → domain-component rule (e.g. Enrollment); open/plan a Feature for that team;
confirm the domain component is present without manual entry and that it produces no story.

**Acceptance Scenarios**:

1. **Given** a team→domain-component rule, **When** a Feature for that team is authored or planned, **Then** the
   team's domain component(s) are applied to the Feature automatically, without AI.
2. **Given** an auto-applied domain component, **When** story generation runs, **Then** it produces no story from it.
3. **Given** a domain component already present, **When** the rule runs again, **Then** it is not duplicated.
4. **Given** a rule that references a component classified as `repo` (a misconfiguration), **When** the rule is
   saved or applied, **Then** the tool flags it rather than silently applying a repo as a domain tag.

---

### User Story 5 - Map repo components from the PI Planner too (Priority: P2)

The same propose-only, allowlist-constrained AI mapping is available in the PI Planner, so a PO who starts from
planning (rather than composition) can populate a Feature's repo components there before generating stories. The
behaviour, gating, allowlist constraint, and no-AI-attribution are identical to the Composition surface.

**Why this priority**: "Both surfaces" was requested. It makes the repo set available wherever the PO works, but the
Composition surface (US2) already proves the mapping, so this extends rather than establishes it.

**Independent Test**: In the PI Planner, on a Feature with no repo components, run the mapping, accept proposals, and
confirm the repo components are set and immediately available to story generation — with the same allowlist rejection
and gating behaviour as Composition.

**Acceptance Scenarios**:

1. **Given** the PI Planner and an unlocked AI session, **When** the PO runs the mapping on a Feature, **Then** it
   behaves identically to Composition — repo-allowlist-constrained, propose-only, per-item accept, never
   AI-attributed.
2. **Given** repo components accepted in the Planner, **When** story generation runs next, **Then** it uses those
   repo components (one story each).
3. **Given** AI is locked in the Planner, **When** the PO looks for the mapping, **Then** it is unavailable, and
   planning/story-generation for already-mapped Features still works.

---

### Edge Cases

- **Unclassified component on a Feature**: never treated as a repo and never as a domain — it produces no story and
  is surfaced as needing classification, so the gap is visible rather than silently resolved.
- **AI proposes a value not on the repo allowlist** (a domain tag, a typo, an unknown repo): rejected with a reason,
  never offered; the valid allowlist proposals still stand.
- **AI proposes nothing / an empty mapping**: the component field is left as it was (not blanked); the Feature is
  surfaced as "no repo components mapped yet" rather than silently empty.
- **A repo component is later re-classified as domain (or vice versa)**: existing Features keep whatever components
  they already carry, but story generation re-evaluates against the **current** classification (a component now
  classified domain stops generating a story; one now classified repo starts).
- **A Feature already has stories for some repos**: story generation proposes stories only for repo components that
  do not already have a corresponding story, so re-running does not duplicate stories.
- **A team→domain rule names a component that does not exist / is unclassified / is a repo**: flagged, not applied
  blindly.
- **AI is locked**: mapping prompt/ingest is unavailable on both surfaces; classification, the deterministic domain
  rule, and story generation from already-mapped repos remain usable.
- **The component list cannot be reached (Jira unreachable)**: the saved classification is still shown from local
  state; the tool says the live list could not be refreshed rather than showing an empty, unclassified list.

## Requirements *(mandatory)*

### Functional Requirements — Component classification (the allowlist)

- **FR-001**: The tool MUST let a human classify each component as **`repo`** or **`domain`** at import time and at any
  later time, and MUST persist that classification across sessions.
- **FR-002**: A component that has not been classified MUST be treated as **neither** repo nor domain (it drives no
  story and is not auto-applied) and MUST be surfaced as "not yet classified" — the tool MUST NOT infer a
  classification from the component name.
- **FR-003**: The set of components classified `repo` MUST be usable as an **allowlist** by the AI mapping and by
  story generation; the classification MUST be the single source of truth both consume (they cannot disagree).
- **FR-004**: Re-classifying a component MUST take effect everywhere the classification is used (mapping allowlist,
  story generation, domain rule validation) without requiring a re-import.

### Functional Requirements — AI repo-component mapping (propose-only, HITL)

- **FR-010**: The tool MUST generate a prompt that carries the Feature's content and the **repo allowlist**, and
  instructs a **structured reply** naming components **only from that allowlist**, following the project's
  propose-only AI pattern — a prompt the operator runs in their own assistant and pastes back; there MUST be **no
  automated or background AI channel**.
- **FR-011**: AI mapping prompt-generation and reply-ingest MUST be **gated behind the existing AI unlock** and MUST
  render nothing when AI is locked.
- **FR-012**: On ingest, every proposed component MUST be validated against the repo allowlist; a value not on the
  allowlist MUST be **rejected with a reason** and never offered — so a domain tag or unknown value can never be
  proposed as a repo (agree-by-construction with FR-003).
- **FR-013**: Proposed repo components MUST be **reviewable and adjustable** by the PO, and MUST be written to the
  Feature's component field **only on an explicit accept**, using the standard field mapping resolved by the app's
  field ids (never a hardcoded field name). Nothing MUST be written to Jira without that accept.
- **FR-014**: The mapping MUST **never attribute** the components or the Feature content to AI, and MUST NOT blank an
  existing component field when it has nothing to propose.
- **FR-015**: The mapping MUST be available on **both** the Feature Composition and PI Planner surfaces with identical
  gating, allowlist constraint, per-item accept, and no-AI-attribution behaviour.

### Functional Requirements — Repo-only story generation

- **FR-020**: Story generation MUST create **one story per `repo` component** on a Feature and MUST create **no**
  story for any `domain` component or any **unclassified** component. This deterministic per-repo generation **is the
  story set** for repo-driven Features — the 028 AI Feature→Story breakdown MUST NOT determine story count or identity
  for them (it remains available for other uses and is not removed).
- **FR-025**: Each generated repo-story MUST be titled **`{Feature summary} ({Repo})`** (the repo component name in
  parentheses, per the GH #220 convention) and MUST be **editable before creation**.
- **FR-026**: Each generated repo-story MUST have its own **`components` field set to the single repo** it represents
  (so stories are filterable/sortable by component), written via the app's resolved field id (never a hardcoded name).
- **FR-027**: When a Feature has **no** repo components, story generation MUST produce **zero** stories and surface a
  "map repos first" prompt — it MUST NOT fall back to another breakdown and MUST NOT guess.
- **FR-021**: A domain (or unclassified) component MUST NOT count toward the Feature's story total in any planning
  count or capacity calculation.
- **FR-022**: Repo-driven stories MUST be **proposed for review** — editable and removable — before any is created;
  only accepted stories are created (propose-only; explicit accept before any Jira write).
- **FR-023**: Story generation MUST be **idempotent** with respect to repos already storied — re-running MUST NOT
  create a duplicate story for a repo component that already has its story.
- **FR-024**: Story generation MUST evaluate repo/domain status against the **current** classification at generation
  time (so a re-classification changes what generates a story going forward).

### Functional Requirements — Deterministic team → domain-component rule

- **FR-030**: The tool MUST let the PO configure, **per saved Dashboard Team profile** (the team identity the PO Tool
  and PI Planner already select — no new team concept), a set of **domain** components that are always applied to that
  team's Features, and MUST apply them **deterministically — never via AI**.
- **FR-031**: Auto-applied domain components MUST never generate a story (by FR-020) and MUST NOT be duplicated when
  already present.
- **FR-032**: A team→domain rule that references a component that is **classified `repo`**, unclassified, or
  nonexistent MUST be **flagged** rather than applied, so a repo can never be silently applied as a domain tag.

### Key Entities

- **Component Classification**: the persisted mapping of a component (by its stable name) to `repo` | `domain` |
  `unclassified`; the authoritative allowlist source consumed by the mapping and by story generation.
- **Repo Allowlist**: the derived set of components classified `repo`; the only values the AI mapping may propose and
  the only components that generate a story.
- **Feature Component Mapping**: the AI-proposed, human-accepted set of repo components for one Feature, written to
  the Feature's component field on accept.
- **Team Domain Rule**: a per-team list of domain components always applied to that team's Features, deterministically.
- **Repo Story Plan**: the proposed one-story-per-repo breakdown for a Feature, reviewed/edited before creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every imported component can be classified `repo` or `domain`, and 100% of classifications survive
  closing and reopening the tool.
- **SC-002**: A Feature that has been through the mapping step never has an empty component field, yet 0 components are
  written without an explicit human accept.
- **SC-003**: The AI mapping proposes only components on the repo allowlist; in 100% of cases a non-allowlist value in
  a reply is rejected and never written.
- **SC-004**: Story generation produces exactly one story per repo component and **zero** stories for domain or
  unclassified components, in 100% of Features.
- **SC-005**: 0 components, Features, or stories are attributed to AI, and the AI mapping is unavailable whenever AI
  is locked, on both surfaces.
- **SC-006**: A team's configured domain component(s) are present on that team's Features without manual entry, and
  never appear as a generated story.
- **SC-007**: Re-running story generation on a Feature creates no duplicate stories for repos that already have one.

## Assumptions

- **The imported components are the source list**: the ~68 repos already imported via the Component Manager are the
  starting population to classify; classification is added on top of the existing import/list capability rather than
  replacing it. The live component list is read from Jira as today; the **classification** is Toolbox-held state.
- **Component identity**: components are identified by **name** (the stable identity a repo carries across projects);
  the per-project component id is resolved at write time from the name.
- **Story-generation model** (resolved in Clarifications): stories are driven **deterministically, one per repo
  component**, and this **replaces** the 028 AI Feature→Story breakdown as the story set for repo-driven Features (028
  is not removed; it stays available for other uses). The AI's role is the component *mapping*, not deciding how many
  stories a repo gets. Each proposed story is **editable before creation**, is titled `{Feature summary} ({Repo})` per
  the GH #220 convention, and carries its **single repo in its own `components` field** (the filter/sort mechanism). A
  Feature with no repo components yields **zero** stories and a "map repos first" prompt (no fallback, no guess).
- **Domain rule is deterministic** (resolved in Clarifications): a rule **keyed to the saved Dashboard Team profile**
  (the identity the PO Tool already selects — no new team concept) applies domain components with no AI involved; the
  repo-only story rule keeps them story-free.
- **Both surfaces reuse one mapping** (resolved in Clarifications): the Composition and PI Planner mapping consume the
  same repo allowlist and the same gated, propose-only, allowlist-constrained ingest, so they cannot diverge.
- **AI rules**: mapping is propose-only, gated, per-item accept, nine-section rules do not apply here (this maps a
  structured field, not prose), and nothing is AI-attributed. There is no automated or background AI.
- **Field-id correctness**: the component field is written by the app's resolved field id (as other structured-field
  writes are), never by a hardcoded field name.
- **Reuse & agree-by-construction**: the allowlist-constrained AI ingest mirrors the existing composition AI pattern
  (allowed-values seeded into the prompt, non-allowlist values rejected on ingest), so a domain tag cannot be
  proposed as a repo; and the mapping and story generation consume one classification, so they cannot disagree.

## Out of Scope

- Any automated, scheduled, or background AI — all AI use is on-demand, gated, manual prompt-out/reply-in, and
  propose-only.
- Enforcing component values on the Jira side, or preventing anyone from adding arbitrary components in Jira directly
  (the distinction is enforced in Toolbox by classification + allowlist-filtered generation, not by locking Jira).
- Inferring repo-vs-domain from component names or any heuristic — classification is always an explicit human action.
- Creating or renaming components (that is the existing Component Manager import); this feature classifies and
  consumes them.
- Generating sub-tasks or scheduling for the repo-stories beyond what PI planning already does; this feature governs
  **which** stories exist (one per repo), not the existing sub-task scaffold or capacity scheduling.
- AI setting any field other than the component mapping (e.g. it never sets ownership, estimates, or dates here).
