# Implementation Plan: SharePoint Relay Pull (Phase 2B)

**Branch**: `feature/sharepoint-relay-pull` (to be created) | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-sharepoint-relay-pull/spec.md`

## Summary

Add a `sharepoint` target to Toolbox's existing browser-relay bridge so a user can **pull intake
submissions directly from the SharePoint `Jira-Intake` List** through their authenticated session
(one bookmarklet click) instead of exporting + dragging a file. Pulled List items are mapped to the
existing submission shape and fed into the **unchanged** queue → dedup (feature 006) → create
pipeline. The reader resolves the List's **internal** field names automatically (via the list
`/fields` REST endpoint) — notably the reserved-`id` GUID column — so the user only deals with
display names. Drag-and-drop stays as a fallback.

Technical approach: extend the relay bridge (`SUPPORTED_SYSTEMS += 'sharepoint'`, widen the client
`RelaySystem` type); add a SharePoint bookmarklet variant to `browserRelay.ts`; a
`sharepointIntakeApi.ts` that issues SharePoint REST reads **through the relay** (list `/fields` to
build a display→internal map, then paginated `/items`); a pure mapper turning a SharePoint item into
the existing flat `RawRow` so `normalizeSubmission` is reused verbatim; a `useSharePointPull` hook
(connect status + pull + refresh); and a small view panel wired into the existing queue/dedup/create
flow. Config gains the SharePoint site-relative URL + list name.

## Technical Context

**Language/Version**: TypeScript 5.x (client), React 18; Node/Express (server) for the one-line
bridge system addition.

**Primary Dependencies**: existing relay bridge (`src/routes/relayBridge.js`, client
`relayBridgeApi.ts`, `useRelayBridge.ts`, `browserRelay.ts`); feature 005 intake queue/create;
feature 006 dedup; `normalizeSubmission` (reused for List items).

**Storage**: No new persisted store. Config gains optional `sharePointSiteRelativeUrl` +
`sharePointListName` on the existing Confluence content-property `IntakeConfig` (schema stays v3 —
new fields are optional, absent = the SharePoint path simply isn't configured yet).

**Testing**: Vitest, co-located `*.test.ts(x)`. Unit tests mock the relay API and the SharePoint
REST responses (fields + paged items). Server test for the added system. Build gate:
`cd client && npm run build`.

**Target Platform**: NodeToolbox client (Chromium) + local Node bridge on `127.0.0.1:5555`.

**Project Type**: Web application — client feature under `client/src/views/JiraIntake/` + client
services, plus a one-line server change (`SUPPORTED_SYSTEMS`).

**Performance Goals**: Pull the full List (all pages) within the working session; a pull of a few
hundred items completes without the UI hanging (paged fetch, progress surfaced).

**Constraints**: Uses the user's SharePoint session via the relay — **no app registration, no
premium connector, no stored SharePoint credentials, no inbound endpoint**. One-click (human tab +
bookmarklet), not fully unattended. GET reads need no form digest (writes would — out of scope).
Jira is Data Center; feature-006 dedup + create pipeline unchanged.

**Scale/Scope**: One active SharePoint List source (matches the single active intake config). Lists
up to low-thousands of items via `$top` + `nextLink` pagination.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; merge via release pipeline | ✅ |
| IV — Code Quality | Self-documenting names, booleans prefixed, verb-first fns <40 lines, doc comments, named constants | ✅ Enforced in tasks |
| V — Testing (TDD) | Failing co-located test precedes impl; unit mocks all I/O <10ms | ✅ TDD sequencing |
| VI — Documentation | `CHANGELOG.md` updated; `specs/007-*` exempt | ✅ |
| VII — Framework-First | Reuse the relay bridge, the intake queue/create, feature-006 dedup, `normalizeSubmission`; build custom only for the SharePoint bookmarklet variant + REST reader + item mapper | ✅ Justified below |
| VIII — Release | `scripts\local-release.ps1` when shipping | ✅ |
| X — Verification | Prove with a real relay pull populating the queue + zero duplicates | ✅ Quickstart |

**Framework-First justification (Article VII):** The relay bridge is generic per-`sys`, so enabling
SharePoint is `SUPPORTED_SYSTEMS += 'sharepoint'` + a type widening — no new transport. The
bookmarklet mechanism, poll/result flow, queue, dedup, and `normalizeSubmission` are all reused. The
only genuinely new code is SharePoint-specific: a bookmarklet variant (hostname + JSON Accept
header), the REST reads (fields + paged items) issued through the relay, and the item→row mapper —
none of which the reused pieces provide.

No violations → Complexity Tracking omitted.

## Project Structure

### Documentation (this feature)

```text
specs/007-sharepoint-relay-pull/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── sharepoint-pull-contracts.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
src/routes/relayBridge.js                 # SUPPORTED_SYSTEMS += 'sharepoint' (+ generalize the
                                          #   snow-specific disconnect message)

client/src/types/relay.ts                 # widen RelaySystem to include 'sharepoint'
client/src/services/browserRelay.ts        # + SHAREPOINT_RELAY_BOOKMARKLET_CODE + open helper
client/src/services/sharepointIntakeApi.ts # resolveListFieldMap() + fetchListItems() via the relay
   (+ .test.ts)                            #   (list /fields → display→internal; paged /items)

client/src/views/JiraIntake/lib/
├── mapSharePointItem.ts                   # SharePoint item (internal keys) → flat RawRow (pure)
└── mapSharePointItem.test.ts

client/src/views/JiraIntake/hooks/
├── useSharePointPull.ts                   # connect status + pull() + refresh; returns RawRow[]/entries
├── useSharePointPull.test.ts
└── useIntakeQueue.ts                       # + ingestRows(rows) sharing ingestFile's row→entries logic

client/src/views/JiraIntake/components/
├── SharePointPullPanel.tsx                # connect relay + Pull/Refresh + status + auto-refresh
└── SharePointPullPanel.test.tsx

client/src/views/JiraIntake/
├── JiraIntake.tsx                          # wire pull → ingestRows → reconcileExisting → create
└── components/IntakeConfigPanel.tsx        # + SharePoint site-relative URL + list name fields

client/src/views/JiraIntake/lib/intakeTypes.ts  # + optional sharePointSiteRelativeUrl / listName on IntakeConfig
```

**Structure Decision**: Additive to the feature 005 `JiraIntake` feature + the shared relay bridge.
Pure logic (`mapSharePointItem`) in `lib/`; relay REST reads in a new `sharepointIntakeApi.ts`; a
`useSharePointPull` hook; a panel component. `useIntakeQueue` gains `ingestRows` so the pull reuses
the exact normalize→dedup-cache→newest-first path that `ingestFile` uses. One-line server change.

## Complexity Tracking

No constitution violations — section intentionally empty.
