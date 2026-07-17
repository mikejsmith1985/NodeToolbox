# Feature Specification: Agile Hub Home — honest gating and a job-shaped tool catalog

**Feature short name**: `agile-hub-home-ux`
**Created**: 2026-07-17
**Status**: Draft — awaiting clarification #1, then `/speckit-plan`
**Builds on**: the Home view card catalog and its drag-to-reorder grid, the Admin Hub unlock (session-scoped), the
existing-but-unwired Admin Hub "Tool Visibility" toggles, and the shared-tab reuse already in place (Feature Review /
PI Review / Hygiene are single components mounted by multiple tools).

## Summary — the master-UX read of today's home page

The home page presents **14 tool cards in 5 sections**, and the sections no longer describe the product:

| Section today | Cards | Problem |
|---|---|---|
| 🏃 Agile & Delivery | **9** — Feature Canvas, Team Dashboard, PO Tool, ART View, My Issues, Personal Toolbox, Business Helper, Jira Template Maker, Jira Intake | One bucket holds 64% of the product; "agile" has stopped meaning anything as a filter |
| ❄️ SNow Hub | 1 — SNow Hub | A section that exists to hold one card (the reporter's complaint) — and the card shows even when ServiceNow connectivity is admin-gated and locked |
| 🛠 Text Tools | 1 — Text Tools | Second single-card section |
| 🛡️ Administration | 2 — Reports Hub, Admin Hub | — |
| 📖 Documentation | 1 — Code Walkthrough | Third single-card section |

Beneath the taxonomy problem sit two structural findings:

1. **Gating is not honest.** The SNow Hub card is always visible, but its capability is admin-controlled. Worse, the
   Admin Hub already ships a **Tool Visibility** panel with a toggle per card — and it is persistence-only: switching
   a tool off changes nothing anywhere. Controls that do nothing erode trust in every control.
2. **Three cards are one product.** Team Dashboard, PO Tool, and ART View each mount the same shared tabs (Feature
   Review, PI Review) with their own team/PI selection; Hygiene renders in Team Dashboard and My Issues; releases
   appear in Team Dashboard, ART View, and SNow Hub. The components are already shared (no code duplication), but the
   **navigation** duplicates: the same job appears behind three doors, each remembering its own scope, and a user must
   know the org-chart ("is PI Review a team thing, a PO thing, or a train thing?") to pick a door.

This feature reshapes the surface in three steps, smallest first: honest gating (wire the visibility system, gate
SNow), a job-shaped catalog (sections describe what you're doing, no single-card sections), and a consolidation path
for the three-doors-one-product problem (the "Agile Hub" direction).

## User Scenarios & Testing

### US1 (P1) — Honest gating: SNow behind the admin unlock, visibility toggles that work

1. With Admin Hub locked, the home page shows **no SNow Hub card** and no ServiceNow section; typing the SNow route
   directly lands on the home page, not the tool.
2. The user unlocks Admin Hub. The SNow Hub card appears (in its new section — see US2) without a reload; locking
   again (or a fresh browser tab, since the unlock is session-scoped) hides it again.
3. An admin switches a tool off in Admin Hub → Tool Visibility. The corresponding card disappears from the home page
   immediately and its recent-used chip no longer appears. Switching it back on restores it.
4. Safety rails: Admin Hub itself can never be hidden (the toggle that would lock you out of the toggles does not
   exist), and a hidden tool's direct route behaves like the SNow rule — home, not a broken page.

### US2 (P2) — A job-shaped catalog

1. The home page presents every visible tool in sections named for the job, not the org:
   - **🙋 My Work** — My Issues, Personal Toolbox
   - **🏃 Team & Sprint** — Team Dashboard, Feature Canvas, Jira Intake, Jira Template Maker, Business Helper
   - **🧭 Product & Train** — PO Tool, ART View
   - **📈 Insights & Admin** — Reports Hub, Admin Hub, SNow Hub (only while unlocked), Code Walkthrough, Text Tools
2. No section ever renders with a single card by design; a section with zero visible cards (everything toggled off)
   renders nothing at all — no empty divider (the same omit-when-empty rule the rest of the app follows).
3. Card drag-to-reorder and the Recently Used strip keep working exactly as today, within the new sections.

### US3 (P3) — The Agile Hub consolidation path

1. The three-doors-one-product overlap (Team Dashboard / PO Tool / ART View sharing Feature Review and PI Review) is
   consolidated so a user finds each job in exactly one place, and each shared tab renders from exactly one mount
   with a scope choice — not three tools each remembering their own.
2. [NEEDS CLARIFICATION: How deep should the US3 consolidation go in this feature? (a) full merge — one "Agile Hub"
   tool replaces the Team Dashboard, PO Tool, and ART View cards, with audience spaces (Team / Product / Train)
   inside it and existing routes redirecting in; (b) umbrella — a new Agile Hub card that hosts the shared tabs
   once, while the three existing cards remain during a transition; (c) defer — ship US1+US2 now, and produce the
   Agile Hub consolidation as its own follow-up spec informed by usage of the new home layout.]

### Edge cases

- **Everything in a section hidden** → the section header does not render (no empty shells).
- **Unlock expires with the SNow tool open** — the session-scoped unlock only gates entry; an open workspace is not
  yanked away mid-task. Next navigation to it applies the gate.
- **A saved card order references hidden tools** — order is preserved for when they return; hidden cards are simply
  not rendered (the existing saved-order reconciliation already tolerates missing cards).
- **Recently Used contains a now-hidden tool** — the chip is suppressed while hidden, returns when visible.
- **First-run user (nothing configured, nothing unlocked)** — sees the catalog minus SNow Hub; nothing looks broken
  or "missing", because no empty section hints at withheld content.

## Requirements

### Functional — honest gating (US1)

- **FR-001**: The SNow Hub card and any ServiceNow-specific home content MUST be visible only while the Admin Hub
  unlock is active in the current browser tab; lock/unlock reflects without a page reload.
- **FR-002**: Direct navigation to the ServiceNow tool while locked MUST land on the home page (no broken or
  half-functional tool shell).
- **FR-003**: The Admin Hub Tool Visibility toggles MUST take effect on the home page (card hidden/shown) and on the
  Recently Used strip, immediately on change.
- **FR-004**: The Admin Hub card MUST NOT be hideable, and hiding a tool MUST NOT disable any deep link another tool
  legitimately makes into it (visibility is a home-surface concern; cross-tool flows keep working).
- **FR-005**: A tool hidden by the visibility toggles MUST behave like FR-002 on direct navigation.

### Functional — job-shaped catalog (US2)

- **FR-006**: Home sections MUST follow the four-job taxonomy above; no configuration of section membership is
  offered (one shared mental model, not another setting).
- **FR-007**: A section MUST render only when it has at least one visible card; single-card *sections* are
  acceptable only as a transient result of visibility toggles, never by design of the default catalog.
- **FR-008**: Existing personalization (drag order, Recently Used) MUST survive the reorganization unchanged,
  including saved orders created under the old sections.

### Functional — consolidation (US3, shape depends on clarification #1)

- **FR-009**: After consolidation, each shared capability (Feature Review, PI Review, release visibility) MUST be
  reachable through exactly one primary navigation path, with scope (team / PI / train) chosen inside it.
- **FR-010**: Every existing route MUST keep working — retired entry points redirect to where the job now lives
  (the app's established retirement pattern).

### Non-functional

- **NFR-001**: No new dependencies; the reorganization reuses the existing card grid, stores, and gating patterns.
- **NFR-002**: The home page renders correctly at every text-size mode and narrow widths (standing responsive
  directive), with the new sections wrapping like the old ones.
- **NFF-003**: Gating states are never communicated by empty space — a locked capability is absent, not greyed.

## Key Entities

- **Tool card catalog** — the card definitions plus, per card: section assignment (new taxonomy), gate kind
  (`none` / `admin-unlock` / `visibility-toggle`), and route.
- **Visibility state** — the existing persisted per-tool map (admin-controlled) finally bound to the surface.
- **Gate state** — the existing session-scoped admin unlock, now also read by the home surface and routing.

## Success Criteria

- **SC-001**: With Admin Hub locked, no ServiceNow entry point is discoverable anywhere on the home page, and the
  direct route lands home — verified in a real browser both locked and unlocked.
- **SC-002**: Toggling any tool's visibility in Admin Hub changes the home page within one second, no reload.
- **SC-003**: No section on the default home page contains exactly one card; no empty section shell ever renders.
- **SC-004**: A user looking for Feature Review, PI Review, Hygiene, or releases can name the single place to go
  (post-consolidation), and reach it in at most two clicks from home.
- **SC-005**: Every pre-existing bookmark/route still lands somewhere sensible (tool or its successor) — zero dead
  routes after the change.

## Assumptions

- "Unlocked enabling the ability to connect to SNow" is read verbatim: the gate is the **session-scoped Admin Hub
  unlock**, not a persisted "SNow configured" flag — each new tab starts with SNow hidden until unlocked. If a
  persisted capability flag is preferred later, the gate kind is a per-card property and can change in one place.
- The four-section taxonomy is fixed (not user-configurable); personal expression stays in drag order + visibility.
- Text Tools and Code Walkthrough are utilities, not products — they live under Insights & Admin rather than
  earning sections.
- US1 and US2 ship regardless of the clarification outcome; only US3's depth is open.

## Out of Scope

- Any change to the tools' internal features; this reshapes surfacing and gating only.
- Role/permission systems beyond the existing admin unlock (no user accounts, no RBAC).
- Server-side anything.
- Retiring the Personal Toolbox concept (its overlap with consolidation is real, but it is the user's personal
  composition space — reassessed after the Agile Hub direction is settled).
