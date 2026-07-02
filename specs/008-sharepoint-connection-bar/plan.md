# Implementation Plan: SharePoint Relay in the Connection Bar

**Branch**: `feature/sharepoint-connection-bar` (to be created) | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-sharepoint-connection-bar/spec.md`

## Summary

Move the SharePoint relay **connect** experience into the shared Connection Bar and make relay
status **per-system** so ServiceNow and SharePoint don't clobber each other. The connection store
gains a `relayStatusBySystem` map (keyed by relay system); `setRelayBridgeStatus` records into it by
`status.system` and keeps the legacy `relayBridgeStatus` mirroring **snow** only (zero change for
existing SNow consumers). `App.tsx` adds a second `useRelayBridge('sharepoint')` poll alongside the
snow one. The Connection Bar gets a **SharePoint** indicator + inline panel (status + draggable
`BookmarkletInstallLink` + the same guidance the SNow panel uses). The Jira Intake pull panel is
slimmed to **status + Pull + a pointer to the Connection Bar** — its bookmarklet/connect steps are
removed. The pull flow, dedup (006), and create pipeline are untouched.

## Technical Context

**Language/Version**: TypeScript 5.x (client), React 18.

**Primary Dependencies**: `connectionStore` (Zustand), `useRelayBridge`, `relayBridgeApi`,
`ConnectionBar`, `BookmarkletInstallLink`, the SharePoint bookmarklet + `useSharePointPull` (feature
007). No server change (the bridge already supports `sharepoint`).

**Storage**: No persisted storage. In-memory store gains a per-system relay status map.

**Testing**: Vitest, co-located `*.test.ts(x)`. Store test for per-system tracking + snow
back-compat; ConnectionBar test for the SharePoint indicator/panel; intake panel test for the slimmed
UI. Build gate: `cd client && npm run build`.

**Target Platform**: NodeToolbox client (Chromium).

**Project Type**: Web application — client-only change (store, App, ConnectionBar, intake panel/view).

**Performance Goals**: SharePoint status reflects connect/disconnect within one poll cycle (the
existing 3s relay cadence). No new network beyond a second lightweight status poll.

**Constraints**: Must NOT regress ServiceNow relay (shared bridge/store) — the legacy
`relayBridgeStatus` stays snow-only. No app registration/premium/inbound (unchanged). Jira DC.

**Scale/Scope**: Two relay systems today (snow, sharepoint); the map generalizes to more.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; merge via release pipeline | ✅ |
| IV — Code Quality | Self-documenting names, verb-first fns <40 lines, doc comments | ✅ Enforced in tasks |
| V — Testing (TDD) | Failing co-located test precedes impl; unit mocks I/O <10ms | ✅ |
| VI — Documentation | `CHANGELOG.md` updated; `specs/008-*` exempt | ✅ |
| VII — Framework-First | Reuse ConnectionBar pattern, BookmarkletInstallLink, relay bridge/store, feature-007 pull; build custom only for the per-system status + SharePoint panel | ✅ Justified below |
| VIII — Release | `scripts\local-release.ps1` when shipping | ✅ |
| X — Verification | Prove: both relays connected independently; intake panel has no connect UI; SNow unaffected | ✅ Quickstart |

**Framework-First justification (Article VII):** No new connection mechanism — the ConnectionBar,
its indicator/panel pattern, `BookmarkletInstallLink`, `useRelayBridge`, and the relay bridge all
exist. The only new logic is the store's per-system status map (a small generalization of a single
field) and a SharePoint indicator/panel that mirrors the existing SNow one. The intake pull flow is
reused unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/008-sharepoint-connection-bar/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/connection-bar-contracts.md
└── tasks.md   # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
client/src/store/connectionStore.ts        # + relayStatusBySystem map; setRelayBridgeStatus records
   (+ connectionStore.test.ts)              #   by status.system; legacy relayBridgeStatus stays snow-only
client/src/App.tsx                           # + useRelayBridge('sharepoint') alongside 'snow'
client/src/components/ConnectionBar/
├── ConnectionBar.tsx                        # + SharePoint indicator + SharePointPanel (reuses BookmarkletInstallLink)
└── ConnectionBar.test.tsx                   # SharePoint indicator/panel + snow-unaffected
client/src/views/JiraIntake/
├── components/SharePointPullPanel.tsx       # slim: remove bookmarklet/steps; status + Pull + pointer to the bar
├── components/SharePointPullPanel.test.tsx  # updated
├── JiraIntake.tsx                            # isConnected from store relayStatusBySystem.sharepoint
└── JiraIntake.test.tsx                       # updated
```

**Structure Decision**: Client-only. The store generalizes to per-system relay status while keeping
snow back-compat; the Connection Bar adds a SharePoint indicator/panel mirroring SNow; the intake
panel loses its connect UI and reads connection status from the shared store. `useSharePointPull`'s
`pull()` is unchanged (keeps its defensive pre-pull status check).

## Complexity Tracking

No constitution violations — section intentionally empty.
