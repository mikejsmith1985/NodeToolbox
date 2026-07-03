# Feature Specification: Canvas Surface Scoping & AI-Tools Access Hardening

**Feature short name**: `canvas-scope-access`
**Created**: 2026-07-03
**Status**: Draft — all clarifications resolved (Q1=A, Q2=A, Q3=work-as-designed); ready for `/speckit-plan`

## Summary

This is a **fix/adjustment** specification bundling the outstanding items raised in review of
the Feature Canvas (feature 009). It covers **two independent areas** that can be planned,
implemented, and released separately:

- **Area 1 — Canvas Surface scoping.** Stage 1 ("Surface") currently pulls a fixed set of
  features (the active team + Program Increment) with no way for the user to say *what* to pull
  in. This adds a **deterministic scope control** — the user defines the query that surfaces
  features — plus, as a hidden accelerator only, a **natural-language → query** helper for the
  one operator who has unlocked AI Assist.

- **Area 2 — Hide the AI tools from Admin, and restore the Admin credential gate.** Two separate
  pre-existing behaviors are fixed: (a) the Admin Hub exposes a **"Hidden prompt tools" checkbox**
  (and other AI references) — a second way to enable the AI tools and, worse, a way for anyone in
  admin to *learn they exist*; the AI tools must be enabled **only** by the owner's Ctrl+Alt+Z
  passphrase and be invisible everywhere else. And (b) Admin Access currently unlocks silently on
  empty/default credentials, so its hidden **admin** features (SNow access + Dev Panel) open with
  no password; admin must go back to its **designed** behavior of requiring entered credentials.
  These two are unrelated: admin gating protects SNow/Dev Panel (operational), while the AI tools
  are protected solely by the passphrase (owner-only).

A third item from the same review — **deleting a container box on Stage 5** — has already been
implemented and shipped, and is therefore out of scope here (noted for traceability).

## Scope Boundary (explicit non-goals)

- **Out of scope**: The Stage 5 "delete a box" fix — already implemented (`removeContainer` +
  the box ✕ control). Listed only so this spec's reviewers know it is intentionally absent.
- **Out of scope**: Replacing the Feature Canvas's feature-first node model (feature 009,
  Q2). Surface scoping changes *which* features appear, not *what a node is*.
- **Out of scope**: Any dependency on AI to complete either area. Every requirement is fully
  operable with no AI unlocked; AI remains an optional, hidden accelerator (Area 1) and is the
  subject of tighter gating (Area 2).
- **Out of scope**: A full role-based access-control system, multi-user admin accounts, or an
  external identity provider. Area 2 hardens the *existing* single-operator gate; it does not
  redesign authentication.
- **Out of scope**: Changing what the AI tools *do* once unlocked. Area 2 governs *who can
  reach the enable switch*, not the tools' behavior.

## Clarifications

### Session 2026-07-03

- **Q1 — Surface scope width**: Resolved → **Full query (Option A)**. The scope control accepts an
  arbitrary feature query; results are enriched with health/hygiene. See FR-1.
- **Q2 — Admin AI toggle**: Resolved → **Remove it (Option A), strengthened**. The Ctrl+Alt+Z
  passphrase is the *sole* enable path, and **all AI references are removed from the Admin Hub** so
  that browsing admin gives no hint the AI tools exist. See FR-4.
- **Q3 — Admin hardening**: Resolved → **Work as designed**. Admin unlock must require the user to
  *enter* credentials (fixing today's silent unlock on empty/default fields); on success the hidden
  **admin** features (SNow access + Dev Panel) unlock exactly as designed. **No default-credential
  warning** is added, and no custom-credential setup is forced — admin gating is operational
  (SNow/Dev Panel), not the mechanism protecting the AI tools. See FR-5.

The original options are retained below for context.

### Q1 — How wide is the Surface scope control? (Area 1)

**Context**: Features are surfaced today via the team + PI rollup, which also computes each
feature's health/completion. A free-form query is more powerful but the health rollup is
currently PI-scoped.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Full query.** The user defines an arbitrary feature query (e.g. by PI, label, project, status). The canvas surfaces exactly what matches and enriches each result with health/hygiene. | Matches the stated vision ("find all features for PI 26.3 with the ENCUC label"); requires a per-result enrichment path rather than a single PI rollup. |
| B | **Refine within the current PI.** Keep the team + PI rollup as the base; the control only *narrows* it (label / text / status filters). | Ships faster and keeps the existing rollup intact; but cannot surface across PIs or express arbitrary queries. |

**Recommendation: A.** The user explicitly wants arbitrary, query-driven surfacing.

### Q2 — What happens to the admin "Hidden prompt tools" checkbox? (Area 2)

**Context**: The AI/prompt tools have two independent enable paths today: the Ctrl+Alt+Z
passphrase (the intended owner-only path) and an admin-panel checkbox.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Remove the checkbox.** The Ctrl+Alt+Z passphrase becomes the *sole* enable path for the hidden prompt tools. | Directly satisfies "hidden from everyone except me"; one fewer surface to secure. Anyone previously relying on the admin toggle uses the passphrase instead. |
| B | **Keep it, but only behind properly-hardened admin.** The checkbox stays, gated by the tightened admin access from Q3. | Preserves the admin toggle as a convenience; but leaves a second enable path whose secrecy depends entirely on the admin credential. |

**Recommendation: A.** Fewest doors; matches the owner-only intent.

### Q3 — How hard to tighten Admin Access? (Area 2)

**Context**: Admin unlock currently accepts default credentials when none are configured, and
the entry form auto-submits those defaults on blank input, so admin effectively opens with no
password on an unconfigured install.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Stop the silent unlock + warn.** Require the user to actually enter a non-empty username and password (no auto-submitting defaults on blank), and show a clear warning whenever admin is running on default/unconfigured credentials, with a one-step way to set a custom admin credential. | Closes the "clicks Unlock with empty fields → in" hole and makes the weak state visible/fixable, without locking anyone out of a fresh install. |
| B | **Require a configured credential (no default fallback).** Admin cannot unlock at all until a custom credential is set; the built-in default is removed. | Strongest lockdown; but a fresh install must configure a credential before any admin action, which changes first-run onboarding. |

**Recommendation: A.** Removes the silent-unlock behavior and surfaces the weakness while
keeping first-run usable; the owner can then set a real credential to fully close it.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Scrum Master (surface the work I actually want):**
As a Scrum Master starting a canvas session, I want to define which features get pulled onto the
canvas — by PI, label, project, or status — instead of only the fixed team+PI set, so the canvas
shows exactly the slice of the backlog I'm triaging.

**Story B — Scrum Master (a sensible starting query):**
As a user who doesn't want to write a query from scratch, I want the scope control pre-filled with
my current team + PI as a working default, so I can surface immediately and refine only if I want to.

**Story C — Owner with AI unlocked (describe it in words):**
As the operator who has unlocked AI Assist, I want to type "find all features for PI 26.3 with the
ENCUC label" and have it produce the exact query to run, so I can scope the canvas conversationally —
while knowing the query box works entirely by hand for anyone without AI.

**Story D — Owner (the AI tools stay secret):**
As the owner, I want the hidden prompt tools reachable only through my Ctrl+Alt+Z passphrase and
referenced *nowhere* in the Admin Hub, so a colleague who unlocks admin can neither enable them nor
even discover they exist.

**Story E — Owner (admin gates SNow + Dev Panel, as designed):**
As the owner, I want Admin Access to work the way it was designed — the user *enters* admin
credentials and the hidden **admin** features (SNow access and the Dev Panel) unlock — instead of
opening silently when someone clicks "Unlock" with empty fields.

### Acceptance scenarios

- **Query-driven surface (Q1=A)**: Given a scope query for PI "26.3" and label "ENCUC", when the
  user runs Surface, then only features matching that query appear as nodes, each with its health
  and hygiene indicators, and the node count matches the query's result count.

- **Default prefill**: When the user opens Surface for the first time in a session, then the scope
  control is pre-filled with a working query for their active team + PI, and running it as-is
  surfaces the project+PI Feature/Epic set (see A8 on how this relates to the previous canvas).

- **Re-surface preserves arrangement (FR-1.4)**: Given features already arranged on the canvas,
  when the user edits the query and re-surfaces to a narrower set, then features still in scope keep
  their position, size, priority, and box, while features no longer matched simply drop off the
  canvas — their saved arrangement is retained for when a later query brings them back.

- **Invalid query is safe**: Given a malformed or unauthorized query, when the user runs Surface,
  then the canvas surfaces nothing, shows a clear error, and leaves any previously surfaced
  arrangement untouched (no partial/garbage state).

- **Manual-only integrity (Area 1)**: Given a user who has *not* unlocked AI Assist, when they use
  the scope control end to end, then every capability is available and no AI-related control or
  instruction appears.

- **NL→query accelerator (owner)**: Given AI Assist is unlocked, when the owner describes the scope
  in words and runs the accelerator, then it produces a query the owner can review and place into
  the scope control; rejecting it leaves the manual query box exactly as it was.

- **No AI on admin unlock (Q2=A)**: Given a user unlocks Admin Access with the admin password and
  inspects every admin-gated section, then there is **no** control, label, or hint referencing AI /
  prompt tools; the tools are reachable only after the separate Ctrl+Alt+Z passphrase.

- **Passphrase is the sole AI path (Q2=A)**: Given AI tools are disabled, when a user unlocks admin
  (password) and does anything in the Admin Hub, then the AI tools remain disabled; they become
  available only after the Ctrl+Alt+Z passphrase is entered.

- **No silent admin unlock (Q3)**: Given Admin Access is locked, when the user clicks "Unlock" with
  empty username/password, then admin does **not** unlock and the user is prompted to enter
  credentials.

- **Designed admin unlock (Q3)**: Given the user enters valid admin credentials, when they submit,
  then admin unlocks and the hidden **admin** features — SNow access configuration and the Dev
  Panel — become available, exactly as originally designed.

## Functional Requirements

### Area 1 — Canvas Surface scoping

**FR-1: Deterministic scope control**
1.1 Stage 1 (Surface) provides a **scope control** in which the user defines the query that
    determines which features are surfaced onto the canvas.
1.2 The control is **pre-filled** with a working default derived from the active team + Program
    Increment, so a user can surface immediately without composing a query.
1.3 Running the scope control surfaces exactly the features the query matches; each surfaced
    feature retains its health/completion and hygiene indicators (per FR-1.5).
1.4 The user can edit and re-run the scope at any time; re-surfacing updates the node set while
    preserving the arrangement (position/size/priority/box) of features that remain in scope.
1.5 Per Q1=A, the scope may express arbitrary feature criteria (PI, label, project, status, etc.).
    Each surfaced feature is enriched with the same health and hygiene signals the canvas already
    uses, computed for whatever set the query returns.
1.6 A malformed or unauthorized query surfaces nothing, reports a clear error, and never corrupts
    or discards the existing arrangement.

**FR-2: Convenience filters (optional, deterministic)**
2.1 The scope control offers simple, discoverable filters (e.g. label, free-text, status) for users
    who do not want to hand-write a full query; applying a filter refines the surfaced set
    deterministically.

**FR-3: Hidden natural-language → query accelerator**
3.1 For sessions with AI Assist unlocked (the existing passphrase gate), the scope control offers a
    hidden helper that turns a natural-language description of the desired scope into a query the
    user can review and place into the scope control.
3.2 The accelerator only **proposes** a query; the user accepts or edits it. The scope control is
    fully usable without the accelerator, and rejecting a proposal changes nothing.
3.3 No scope-control guidance references AI; the helper is invisible and inert unless AI Assist is
    unlocked, following the established copy-paste-and-ingest pattern.

### Area 2 — Hide AI tools from Admin; restore the Admin credential gate

**FR-4: No AI is reachable through Admin unlock; the passphrase is the sole AI path (per Q2=A)**
4.1 The **only** way to enable the hidden prompt/AI tools is the Ctrl+Alt+Z passphrase gate.
4.2 **Nothing visible after unlocking Admin Access (with the admin password) references AI.**
    Concretely, the "Hidden prompt tools" checkbox is removed, so a user who unlocks admin sees no
    AI control, label, or hint.
4.3 The underlying "AI features visible" flag has **no other consumers in the product** and is
    removed entirely; no surface loses functionality and nothing needs to be re-wired.
4.4 The Ctrl+Alt+Z passphrase mechanism and the **owner-only** surfaces it reveals (including the
    AI Assist automation tab, which appears *only* after the passphrase — never on admin unlock)
    are **preserved** — that passphrase *is* the intended owner-only path. Removing the admin
    checkbox does not change what the AI tools do once enabled.

**FR-5: Admin unlock works as designed — requires entered credentials (per Q3)**
5.1 Admin Access unlock requires a **non-empty** username and password actually entered by the
    user; clicking "Unlock" with empty fields does not unlock admin.
5.2 The client does not pre-fill or auto-submit built-in default credentials on the user's behalf;
    the user must enter the credentials.
5.3 Credential verification remains server-side and unchanged; a correct credential (including the
    designed built-in default on an unconfigured install) unlocks admin. No default-credential
    warning is shown and no custom-credential setup is forced.
5.4 On a successful unlock, the admin-gated operational features become available exactly as
    designed (SNow / GitHub proxy configuration, service-connectivity credentials, advanced feature
    controls, developer utilities). Admin gating governs only these operational features, never AI.
5.5 *(Confirmed 2026-07-03)* The **Dev Panel**, which is currently always-accessible (not
    admin-gated), is placed **behind admin unlock** to match the intended admin scope — "admin
    unlocks SNow access and the Dev Panel". When admin is locked, the Dev Panel is not reachable;
    after a valid unlock, it is.

## Success Criteria

1. **SC-1 — Query-scoped surfacing**: A user can surface a feature set defined by an arbitrary
   query (e.g. a specific PI + label) and see only matching features, with node count equal to the
   query's result count.

2. **SC-2 — Zero-config start**: With no query editing, a first-time user can surface their active
   team + PI **Feature/Epic set** in one action (the pre-filled default runs as-is). This is the
   project+PI feature/epic population and may include items the previous canvas hid (see A8) — it is
   a superset, not an exact match, of the old surfacing.

3. **SC-3 — Manual parity (Area 1)**: A user with no AI unlocked can define, run, and refine any
   scope; the NL→query helper changes only the time to build a query, never the achievable result.

4. **SC-4 — Safe failure**: For any malformed/unauthorized query, the number of features surfaced is
   zero and the prior arrangement is unchanged (no corruption), with a visible error.

5. **SC-5 — Single AI door**: After this change, the number of ways to enable the hidden prompt
   tools is exactly one (the passphrase).

6. **SC-6 — No AI on admin unlock**: A user who unlocks admin (password) and inspects every
   admin-gated section finds zero references to AI / prompt tools; unlocking admin enables the AI
   tools zero times. (The AI surfaces appear only after the separate Ctrl+Alt+Z passphrase.)

7. **SC-7 — No empty-field unlock**: Attempting to unlock admin with empty credentials succeeds
   zero times; a correctly entered credential still unlocks it.

8. **SC-8 — Designed admin scope intact**: After unlocking admin with valid credentials, the SNow
   access configuration and Dev Panel are available (no regression to the designed admin features).

## Key Entities

| Entity | Area | Description |
|--------|------|-------------|
| Surface Scope Query | 1 | The user-defined (or pre-filled) criteria that determine which features are surfaced onto the canvas |
| Scope Filter | 1 | A simple, deterministic refinement (label / text / status) layered on the scope query |
| NL→Query Suggestion | 1 | An optional, passphrase-gated proposed query produced from a natural-language description; always user-accept/reject |
| AI-Tools Enable Gate | 2 | The single passphrase (Ctrl+Alt+Z) path that enables the hidden prompt tools; the removed admin "AI features visible" flag is folded into this gate |
| Admin Credential | 2 | The credential a user must enter to unlock Admin Access (the built-in designed default on an unconfigured install, or a configured credential) |
| Hidden Admin Features | 2 | The operational features admin unlock reveals — SNow access configuration and the Dev Panel |

## Assumptions

- **A1**: The canvas continues to surface **feature/epic-level** nodes; the default pre-filled query
  targets feature/epic issue types, and users querying other types accept feature-first semantics.
- **A2** *(confirmed — Q1=A)*: Surface scope is a full query (not only a PI refinement); per-result
  health and hygiene enrichment is applied to whatever the query returns.
- **A3**: Health/completion for surfaced features is derived the same way the canvas already derives
  it (feature child rollup); hygiene indicators reuse the existing per-issue checks.
- **A4** *(confirmed — Q2=A)*: The hidden prompt tools' sole enable path is the existing Ctrl+Alt+Z
  passphrase. Everything AI that is visible **on admin (password) unlock** — the "Hidden prompt
  tools" checkbox and its orphan "AI features visible" flag — is removed. The passphrase-gated
  surfaces (the ⚡ AI Assist tab), which appear only after the passphrase and never on admin unlock,
  are preserved as the owner-only path (per FR-4.4).
- **A5** *(confirmed — Q3)*: Admin unlock requires real entered credentials (no auto-submit of
  blanks/defaults); it otherwise works as designed — the built-in default still unlocks on an
  unconfigured install, no warning is shown, and unlocking reveals SNow access + the Dev Panel.
- **A6**: The NL→query accelerator reuses the existing passphrase gate and copy-paste-and-ingest
  mechanism already present in the product; it introduces no always-on outbound AI channel.
- **A7**: Admin credential verification is unchanged (a server-side, non-reversible check). This
  spec adds no new credential-setting UI; configuring a custom admin credential remains the existing
  out-of-band mechanism, and is not required for this change.
- **A8** *(I1 resolution)*: The default query surfaces **all Feature/Epic issues in the active
  project + PI** — a **superset** of the previous canvas, whose PI rollup silently excluded features
  with no child stories. Surfacing those childless items is **intentional**: an unpointed / empty
  feature is exactly the kind of gap a triage canvas should expose. Users wanting the old, narrower
  set can add a clause to the query. The default is not claimed to be an exact byte-for-byte match of
  the pre-change surfacing.
- **A9** *(I2 resolution)*: The default query targets the configured PI custom field **by id**
  (`cf[<number>]`, derived from the ART PI field setting, default `customfield_10301`), **not** the
  literal field name — so the default works regardless of the PI field's display name on a given Jira
  instance. Users may hand-edit the query to the readable `"Program Increment"` form if their field is
  named that way.

## Dependencies

- The Feature Canvas (feature 009) Surface stage and its existing feature-fetch + hygiene/health
  enrichment.
- The existing Jira query/search access used elsewhere in the product for feature retrieval.
- The existing AI Assist passphrase gate and copy-paste-and-ingest accelerator pattern.
- The existing Admin Access verification flow and its credential store.
