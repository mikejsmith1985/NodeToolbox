# Quickstart — PI Delivery Framework (032)

End-to-end validation that the framework plans a PI once and then supports monitoring. Requires a live Jira (VPN up)
and the AI unlock (Ctrl+Alt+Z). Uses a throwaway test PI / project where possible.

## Prerequisites

- Features **committed** on the PI Review surface for the target PI, each with repo components **classified** (031:
  Component Manager → repo/domain). At least one Feature touching **multiple** repos (to prove parallel coding).
- Roster populated with capabilities, including at least one **SL-test (internalTest)** capable member.
- The PI's board sprints present (or let the planner derive the missing ones).

## Steps

1. **Open** PO Tool / ArtView → **PI Delivery Planner** tab. Confirm the **Fact Sheet** panel renders: committed
   Features + their repo/domain components, roster (roles), the 5 sprints with the Sprint-5 Week-1 **delivery
   deadline**, and the release schedule. → *Proves the query layer (FR-018).*
2. **Unlock AI** (Ctrl+Alt+Z). Click **Generate delivery-plan prompt**. Confirm the prompt embeds the fact sheet
   verbatim and asks only for Story decomposition + mitigations (no dates/assignments). Copy it.
3. **Paste** into your own AI with the fact sheet, get the `{kind:'piDeliveryPlan'}` reply, paste it back.
4. **Ingest**. Confirm: each Feature shows Stories bridging its repos; each Story shows **one coding sub-task per
   repo**, **one SL-test** sub-task, and **INT/REL/PROD** deploy sub-tasks; a multi-repo Story shows multiple coding
   sub-tasks with **different** load-balanced assignees. → *US1, US2, SC-004.*
5. **Hallucination check**: hand-edit the reply to name a repo **not** in the allowlist and re-ingest. Confirm that
   story is **rejected** with a reason and nothing writes. → *SC-003, FR-020.*
6. **Dates/capacity check**: confirm every Story's Target End (code-in-INT) is **on/before Sprint-5 Week-1**, REL =
   INT + 5 working days, PROD on a fixVersion, and no person's sprint load exceeds **80%**. Confirm nothing is
   scheduled in Sprint-5 Week-2. → *US3, SC-005, SC-006.*
7. **Bottlenecks**: confirm the plan flags an **SL-test throughput** bottleneck for any sprint where dev output
   exceeds SL capacity (with figures), plus any **key-person** / **dependency** / **PROD-carry** flags, and that each
   AI **mitigation** is attached to a flagged bottleneck id. → *US4, SC-007.*
8. **Accept** a subset per-item. Confirm only accepted items are written: Stories under Features, coding sub-tasks
   (repo on the component field) + SL-test + deploys under Stories, with Target Start/End+due, sprint assignment, and
   fixVersion. Re-run: confirm **idempotency** (existing children not duplicated). → *FR-005, FR-028.*
9. **Monitor**: open the **Monitor** view. Confirm it reports burn-up, sub-task aging, SL-test queue depth, freshness
   (from GitHub-intake comments), and commit-vs-complete against the plan; simulate a slipped Story and confirm the
   `storySlipped` replan trigger fires. → *US5, SC-008.*

## Expected outcomes

- A complete 5-sprint plan generated from **one** prompt/paste cycle; **no date hand-entered**.
- 100% of dates/capacity/assignment/bottlenecks are rule-derived; AI-supplied ones ignored.
- Unknown repos/keys rejected before any write.
- After acceptance, on-track/off-track is readable entirely from the Monitor view.

## Regression gate

Run the 028 tests. The **capacity/date/scheduling behaviour** assertions (`buildCapacityPlan`, `piPlanDates`,
`piPlanBreakdown` effort-split) must pass **unchanged** — a behaviour change there means the restructure drifted and
must be reconciled, not the test edited. Assertions referencing the renamed `SubTaskKind` (`internalTest`→`slTest`)
or the `[IT]`→`[SL]` label are **expected** to change. Full client `vitest run` green; `tsc -b` clean; eslint clean.
