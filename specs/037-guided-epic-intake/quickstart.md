# Quickstart: Validating Guided Epic Intake

**Feature**: 037-guided-epic-intake | **Plan**: [plan.md](./plan.md)

Live validation needs DENP, which is reachable only in production. Per standing practice, the suites and builds gate
the release, and V-01…V-12 below are run in production afterwards. Validation is never held for a pre-release live
spot-check.

## Prerequisites

- Toolbox is connected to Jira, with create permission in DENP.
- PO Tool → a team is selected → **Feature Composition** is open.
- The GH #387 body is copied to the clipboard (`gh issue view 387 --json body -q .body`).
- For the AI path, the AI assist is unlocked (Ctrl+Alt+Z).

## Automated gates (must be green before release)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/PoTool/intake            # all intake unit + component tests
npx vitest run src/views/PoTool/FeatureCompositionTab.test.tsx src/views/PoTool/poToolWithoutAi.test.tsx
npx vitest run src/views/Hygiene/HygieneFixControl.test.tsx   # must pass UNMODIFIED (R-007 move)
npx vitest run src/services/fieldMappingBoundary.test.ts      # ratchet: no new customfield ids
npx tsc -b                                                     # pre-push parity
cd .. ; npm test                                               # full client + server suites
```

## Live scenarios

| # | Do | Expect | Proves |
|---|---|---|---|
| V-01 | Switch to **Epic Intake**, paste GH #387, **Start intake** | Numbered lines. Baseline items ≈ the 25 top-level bullets. The *New Since OnSite* / *Notes from OnSite* / intro lines are set aside as heading/prose | R-003, FR-003 |
| V-02 | Check *Core Integration* before any AI round | Owner **Enrollment**, badge **Rule**, reason `Stated sizes: Enrollment XL vs Fulfillment M`. Sizes list `Enrollment XL (1.2M) · Fulfillment M · Infra XL · Facets M`. Named key `DENP-632` | US2-1, FR-013 |
| V-03 | Copy the Sort-the-notes prompt, paste the reply | Items show kind, terms and label proposal. Coverage says all lines accounted for, or names the missing ones | US1-2/3 |
| V-04 | Paste a reply with an invented `item-99` and a line claimed twice | Both rejected with reasons; the intake is otherwise unchanged | US1-4, edge cases |
| V-05 | Paste the same broken answer for one item's owner twice | That owner becomes a PO question | FR-007 |
| V-06 | Answer an owner as PO, then paste a reply that changes it | The PO answer stands | FR-008 |
| V-07 | **Check DENP** | Progress counter. `DENP-632` settles **existing** by rule if it is open. Other items show candidates or settle "create new" | US3-1/4 |
| V-08 | Paste a match reply naming a key from another item's list | Rejected: `…was not among the Epics found for item-N` | FR-018 |
| V-09 | Disconnect VPN and run **Check DENP** | Items marked **not checked**; Create is unavailable for them. Reconnect and re-run failed items only | FR-019 |
| V-10 | Confirm labels, draft, accept 2 and decline 1, **Create** | Exactly 2 new DENP Epics, each with one label and a nine-section description, with no sizes or costs in any field. If DENP requires Epic Name it is filled from the summary; any other required field was asked once | US4, FR-020/023 |
| V-11 | Close the browser mid-way and reopen **Epic Intake** → **Resume** | Same step, same answers, and created keys are not re-created | US6-1, US4-6 |
| V-12 | **Copy table**, paste into Outlook and Teams | Pastes as a real table: every work item once, with a key or a reason | US5, SC-006 |
| V-13 | Lock the AI and run V-01 → V-12 by hand | Completes. No "AI", "assistant", "unlock" or ⚡ text anywhere in the mode | FR-026, R-011 |
| V-14 | Toggle back to **Compose one Feature** | The composition draft is exactly as it was left | FR-001 |

## Success-criteria spot checks

- **SC-001**: count the pastes in V-03…V-10. For GH #387, expect **3** (classify, match, draft), and at most 4.
- **SC-004**: count the PO questions other than labels. Expect ≤ 1 per 5 work items.
