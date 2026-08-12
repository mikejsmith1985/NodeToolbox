# Quickstart: Cloned-Feature Sub-Lanes

**Feature**: `specs/035-feature-clone-sub-lanes` | **Date**: 2026-08-12

These are the checks that prove the feature works against **live Jira**. They must be run by the user; no automated
test can substitute, because the behaviour depends on real clone links in a real instance.

## Prerequisites

- NodeToolbox running at the version carrying this feature.
- Team space → **Roll-Up Board** tab, Transformers team, PI 26.4.
- A dev Feature known to be cloned. The reference case: the Feature whose Issue Links panel shows
  `is cloned by DENP-1359` **and** `is cloned by QEINT-610`.

## Setup

1. Open **Board setup → Which Features belong to this team**.
2. In **Other disciplines**, add:
   - Name `QE`, Feature project `QEINT`, story project `<QE's story project>`
   - Name `BT`, Feature project `<BT's Feature project>`, story project `<BT's story project>`
3. Apply, and let the board reload.

---

## Verification

### The core case

| # | Do this | Expect |
|---|---|---|
| **V-01** | Find the reference Feature's lane | A **QE sub-lane** beneath it, labelled `QE` and naming `QEINT-610` |
| **V-02** | Look for a sub-lane for `DENP-1359` | **None.** It is in the dev team's own project, so it is a peer — it keeps its **own top-level lane** on the board. This is the single most important check in this document. |
| **V-03** | Expand the QE sub-lane | QE's stories, sitting in **your** column names |
| **V-04** | Look at a Feature with no clones | Renders exactly as before — no extra band, no extra height, one progress figure |

### Colour and labelling

| # | Do this | Expect |
|---|---|---|
| **V-05** | Compare the QE and BT sub-lanes | Visibly different tones, **and** each named in text |
| **V-06** | Reload the board | Each discipline keeps the same colour |
| **V-07** | Switch between Dark and Light | Both sub-lanes stay legible; no washed-out text |

### Read-only

| # | Do this | Expect |
|---|---|---|
| **V-08** | Try to drag a card in a sub-lane | It does not move, and the sub-lane **said so before you tried** |
| **V-09** | Click a card in a sub-lane | Detail opens in place, exactly like a dev card |
| **V-10** | Drag a card in the **primary** lane | Behaves exactly as it did before this feature. **A regression here fails the release.** |

### The two figures

| # | Do this | Expect |
|---|---|---|
| **V-11** | Find a Feature where dev is complete and QE is not | Two figures shown; the disagreement stated; the Feature **not** presented as finished |
| **V-12** | Check a Feature whose QE stories have no story points | The two figures may use different bases, and the lane does not present them as one comparison |

### The awkward cases

| # | Do this | Expect |
|---|---|---|
| **V-13** | Temporarily remove `QEINT` from the discipline list and reload | The QE clone is **reported as unconfigured**, not silently dropped. Re-add it afterwards. |
| **V-14** | Find a clone you cannot read, or revoke access to one | The sub-lane still appears and says which discipline is missing and why |

---

## What to report back

For any failure, the useful detail is:

1. The Feature key and its clone's key.
2. What the clone's **Issue Links** panel actually says — the exact link phrase and direction.
3. Whether the clone's project is in the discipline list, spelled identically.

Those three answer nearly every failure in this feature without a round trip.

## Known non-issues

- **Discipline statuses landing in Unmapped** is the feature working correctly. Another team's workflow will contain
  statuses your columns have never claimed; the existing unmapped-states notice names exactly which mappings to add.
- **A peer clone getting its own lane** (V-02) is correct, not a miss.
