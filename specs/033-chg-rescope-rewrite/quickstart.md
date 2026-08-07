# Quickstart & Validation: Rebuild an Existing Change From Scratch

**Feature**: `033-chg-rescope-rewrite` | **Branch**: `feature/033-chg-rescope-rewrite`

Article X: "it compiles" and "returned 204" are not proof. The automated suite proves the units; **Tests 1–7 below
prove the behaviour**, and Test 4 is the one that decides whether the feature shipped correctly.

---

## Prerequisites

- NodeToolbox running locally (`npm start`) or an installed build.
- The **SNow relay bookmarklet active** on a ServiceNow tab — every ServiceNow call in this feature goes through it.
- Jira reachable (VPN on — an empty Feature/issue result is frequently a VPN problem, not a code bug).
- **A disposable open CHG you own**, with content you are willing to lose. Tests 4–6 overwrite it.
- A project key + fix version with issues, and one extra Jira issue key from a different fix version.

---

## Automated checks

```powershell
cd C:\ProjectsWin\NodeToolbox\client

# Feature suites
npx vitest run src/views/SnowHub/hooks/crgStorageKeys.test.ts
npx vitest run src/views/SnowHub/hooks/useCrgState.test.ts
npx vitest run src/views/SnowHub/tabs/CreateChgTab.test.tsx
npx vitest run src/views/SnowHub/tabs/ModifyChgTab.test.tsx

# Regression bar — must be >= 390 passing, with NO existing test modified
npx vitest run src/views/SnowHub

# Type check
npx tsc --noEmit
```

**Regression rule**: if an existing `CreateChgTab`, `ConfigurationTab`, or `useCrgState` test needs editing to pass,
the `mode` / `storageKey` additions stopped being additive. **Revert the change — do not adjust the test.**

---

## Test 0 — Existing behaviour is untouched (run first)

1. Open **SNow Hub → CHG → Create New CHG**. Build a change as you normally would.
2. Open **Configuration** mode.

**Expected**: Both are exactly as before this feature. No target-number banner, no Start Over, no wording changes.

*If this fails, stop — the additive guarantee is broken and nothing below matters.*

---

## Test 1 — Entry point availability (FR-001, FR-002)

1. **CHG → Modify Existing CHG**. Before loading anything, look for **Start Over**.
   **Expected**: absent.
2. Fetch your disposable change by number.
   **Expected**: Start Over now offered, beside the existing edit steps.
3. Press **Load My Open Changes** and pick a change from the dropdown.
   **Expected**: Start Over offered here too.

---

## Test 2 — The confirmation actually guards (FR-003, FR-004, SC-006)

1. With a change loaded, press **Start Over**.
   **Expected**: a confirmation naming the change number and stating its current content will be discarded and
   rebuilt. It is not auto-confirmed and not the default action.
2. **Cancel.**
   **Expected**: you are back on the loaded change, its fields unchanged, existing edit steps working as before.
3. Open the change in ServiceNow.
   **Expected**: completely untouched.

---

## Test 3 — Blank on entry, bound throughout (FR-005, FR-006, FR-007, SC-008)

1. Press Start Over and **confirm**.
2. Walk every step: scope, change details, planning, environments, review.

**Expected**:

- Every field is **blank** — no content, planning answer, environment tick, or date carried over from the change.
- Your saved short-description config and any pinned values **do** apply (they would for a new change too).
- The **target change number is visible on every step**.
- The **Create CHG** button is nowhere in the flow. The review step's primary action reads **Update `<CHG NUMBER>`**.
- There is no "Existing CHG number" text box — the number is bound, not typed.

---

## Test 4 — 🔑 The deciding test: rebuild and save (FR-028, FR-029, SC-003, SC-004)

**Before you start**, note the change's current short description, and run this in ServiceNow to record how many
changes exist for your user:

```text
change_request.list  →  filter: Requested by = <you>, Created = Today
```

1. In the rebuild, fetch a fix version. Confirm the issues load with all selected.
2. Complete change details, planning, and **exactly one** environment with valid dates.
3. Review, then press **Update `<CHG NUMBER>`**.

**Expected**:

- Success message naming **that same change number**.
- Open the change in ServiceNow: short description, description, justification, risk & impact, planning answers,
  environment, config item, and dates all reflect the **new** scope. No fragment of the old content remains.
- 🔑 **The change count is unchanged. No second CHG was created.** This is SC-003 — if a new change appeared, the
  feature has failed regardless of everything else.
- If the verification read found mismatches, the result says "updated with verification warnings (N)" — not a clean
  success.

---

## Test 5 — Fix version plus one extra story (FR-011, FR-012, FR-013, SC-002)

1. Start a fresh rebuild on the same change.
2. Fetch a fix version.
3. Switch to **Custom JQL**, enter `key = ABC-123` for an issue outside that fix version, and press
   **+ Add to Loaded Issues**.

**Expected**: both the fix version's issues **and** the added issue are in the list; nothing was cleared; a notice
reports how many were added.

4. Run the same add again.
   **Expected**: no duplicate; the notice says it was already present.
5. Untick one issue and regenerate.
   **Expected**: that issue does not appear in the generated content.

---

## Test 6 — The one-environment guard (FR-029)

1. In a rebuild, reach the review step with **no** environment enabled.
   **Expected**: update button disabled, message says an environment must be enabled. **No** ServiceNow call.
2. Enable **two** environments and return to review.
   **Expected**: update button disabled, message **names both** and states a rebuild writes to one change number.
   **No** ServiceNow call.
3. Enable exactly one.
   **Expected**: update button enabled.

*This is the feature's main correctness risk — a rebuild that silently kept only the first environment would lose
the other without a word.*

---

## Test 7 — Draft isolation and survival (FR-033, SC-005)

1. In **Create New CHG**, start a change and type a distinctive short description. Do not submit.
2. Switch to **Modify Existing CHG**, load a change, Start Over, confirm, and enter some scope.
3. Switch back to **Create New CHG**.
   **Expected**: your original draft is **intact** — same distinctive short description, untouched.
4. Return to Modify, load the **same** change, Start Over.
   **Expected**: the rebuild resumes where you left it (this is the relay-reconnect case).
5. Load a **different** change and Start Over.
   **Expected**: blank — the other change's rebuild draft is not visible here.
6. Reload the page mid-rebuild.
   **Expected**: the rebuild is restored, but **no environment is pre-ticked** (the v0.137.1 rule holds for rebuild
   drafts too).
7. Abandon a rebuild entirely and check the change in ServiceNow.
   **Expected**: byte-identical to how you found it.

---

## Test 8 — Failure paths (FR-015, FR-032)

| Do this | Expect |
|---|---|
| Drop VPN, fetch a fix version | Failure reported as a **Jira** lookup problem; the rebuild in progress is preserved |
| Deactivate the relay bookmarklet, press Update | ServiceNow failure surfaced; **the rebuild is preserved** — you can retry without rebuilding |
| Rebuild a closed/cancelled change | Warned **before** the rebuild starts, not at the save |

---

## Sign-off

- [ ] Test 0 — existing Create and Configuration modes untouched
- [ ] Tests 1–3 — entry, confirmation, blank + bound
- [ ] **Test 4 — same change number, no second CHG created**
- [ ] Test 5 — fix version + quick key add
- [ ] Test 6 — one-environment guard refuses 0 and ≥2
- [ ] Test 7 — Create draft survives; rebuilds isolated per change number
- [ ] Test 8 — failure paths preserve work
- [ ] `npx vitest run src/views/SnowHub` ≥ 390 passing, no existing test modified
- [ ] `npx tsc --noEmit` clean
- [ ] `CHANGELOG.md` updated in the same commit (pre-commit hook requires it)
