# Quickstart: Validating Single AI Unlock + PI Review AI Assistance

**Feature**: `016-pi-review-ai-assist` | **Date**: 2026-07-15

How to prove this feature works. Scenarios A–B (Part 1) and C–H (Part 2) are the acceptance run. Article X applies:
"it builds" is not proof — each scenario names an observable outcome.

## Prerequisites

| Need | Notes |
|---|---|
| NodeToolbox running | `.\scripts\run-dev-clean.ps1` |
| Jira + Confluence reachable | An empty PI Review pull usually means VPN, not a bug |
| A Team Dashboard team with a PI Review page | Settings → Saved Dashboard Teams → PI Review Pages |
| A PO flagged in the roster | Required by **Pull Features from Jira** |
| The AI Assist passphrase | Ctrl+Alt+Z; see `useAiAssist.ts` |
| AI Assist automation configured | Only for the **automatic** path (Scenario F). Scenarios C–E, G, H work without it |

## Automated checks (run these first)

```powershell
cd C:\ProjectsWin\NodeToolbox\client

# Part 1 — the surviving gate, unchanged
npx vitest run src/components/AiAssistUnlockGate/

# Part 1 — the views that lost their duplicate gates
npx vitest run src/views/SprintDashboard/ src/views/SnowHub/

# Part 2 — pure core (must be fast; no React, no I/O)
npx vitest run src/views/ArtView/ai/

# Part 2 — the tab wiring
npx vitest run src/views/ArtView/PiReviewTab.test.tsx
```

Then the full sweep, because this feature touches shared files:

```powershell
cd C:\ProjectsWin\NodeToolbox
cd client; npx vitest run; npx eslint src; npx vite build; cd ..
npx jest              # server — must be untouched by this feature
npm run test:dom      # engine invariants — must be untouched by this feature
```

The last two matter as much as the first: `piReviewJira.ts` is bundled into the server engine that feature 015 runs.
Exporting `appendUniqueNoteLine` must not disturb it.

---

## Scenario A — One prompt, everywhere *(FR-001…FR-003, SC-001)*

The defect this feature was reported for.

1. Open the app, AI Assist **locked**.
2. Go to **Team Dashboard → PI Review**. Press **Ctrl+Alt+Z**.
   - ✅ **Exactly one** passphrase prompt. (Before this feature: two — the app gate plus Risk Management's.)
3. Dismiss. Repeat on each of:
   - Team Dashboard → **Pointing**  *(before: two)*
   - Team Dashboard → **Release Notes**  *(before: two)*
   - **SnowHub → Create CHG**  *(before: two)*
   - **Admin Hub**  *(already one — must stay one)*
   - ✅ Exactly one prompt each time.
4. On the Sprint Dashboard, confirm no second modal is hiding **behind** the first — dismiss the visible one and
   check nothing remains.
   - ✅ Nothing behind it.

## Scenario B — Unlock still works, and still unlocks everything *(FR-004…FR-006, SC-002)*

1. Press **Ctrl+Alt+Z**, enter the **wrong** passphrase.
   - ✅ Error shown; stays locked.
2. Enter the **correct** passphrase.
   - ✅ Prompt closes; AI Assist unlocked.
3. Without re-entering it, visit each surface and confirm its AI affordance is present:
   - Pointing → **⚡ Run via AI Assist (auto)**
   - Release Notes → **⚡ Run via AI Assist (auto)** (both)
   - Risk Management → **⚡ Run via AI Assist (auto)**
   - SnowHub Create CHG → **⚡ Run via AI Assist (auto)**
   - Admin Hub → the **⚡ AI Assist Automation** tab
   - ✅ All present. *(This is the regression that would matter most — the point of Part 1 is to delete prompts, not
     features.)*
4. Press **Ctrl+Alt+Z** again.
   - ✅ Re-locks; every affordance disappears.

---

## Scenario C — The panel appears only when it should *(FR-007, FR-008, FR-009)*

1. AI Assist **locked**, PI Review tab, **edit mode on**.
   - ✅ No AI Assistance affordance.
2. Unlock (Scenario B), stay in **view mode**.
   - ✅ Still no affordance — it is an authoring tool.
3. Enter **edit mode**.
   - ✅ The affordance appears.
4. Open a PI Review page with **no Features**.
   - ✅ The panel explains there is nothing to size and does not dispatch.

## Scenario D — Read the prompt before anything is sent *(FR-010, FR-013…FR-017)*

1. Unlocked, edit mode, a page with several Features. Open **AI Assistance**.
2. Read the prompt.
   - ✅ Full prompt visible and copyable **before** anything is sent.
   - ✅ Contains, per Feature: issue key, summary, priority, description, acceptance criteria, linked issues.
   - ✅ A Feature lacking a description or AC says so **explicitly** — not an empty label.
   - ✅ The T-shirt scale is embedded and matches the sizing card exactly (same constant).
   - ✅ It asks for a **size**, not a point number.
3. ✅ The panel states — **before** any Accept is reachable — that an accepted estimate can update Jira. *(FR-030 —
   look for this specifically; it is the feature's sharpest edge.)*

## Scenario E — Manual path, review, accept *(FR-018…FR-024, FR-032, SC-003…SC-005)*

1. Copy the prompt into your AI tool. Paste the reply back.
2. ✅ Suggestions appear per Feature — each showing its size, the derived points, and the notes proposed.
3. ✅ **Nothing in the table has changed yet.**
4. Accept **one** suggestion.
   - ✅ That row's **Point Estimate** and **Implementation Notes** update.
   - ✅ **Dependency, Risks, Priority, Carry-Over, Committed are untouched.** *(The Q1 guarantee — check this
     explicitly.)*
   - ✅ Notes gained labelled lines: `Risk note: …` / `Dependency note: …` / `Implementation note: …`.
   - ✅ The page shows **Unsaved changes**; nothing was written to Confluence.
   - ✅ Every other suggestion is still pending — accepting one accepted only one.
5. Reject another.
   - ✅ Dismissed; that row untouched.
6. On a Feature that **already has** an estimate:
   - ✅ Current vs proposed are both visible; your value stands unless you choose the suggestion.
7. Click **Save to Confluence**, then **Reload from Confluence**.
   - ✅ The notes are still there and nothing moved between columns. *(Scenario 14 — an AI run and a reload do not
     disagree.)*

## Scenario F — Automatic path, and its failure *(FR-011, FR-012)*

1. With the automation configured, click **⚡ Run via AI Assist (auto)**.
   - ✅ Progress shown; suggestions arrive; identical review UI to the manual path.
2. Break it (clear the webhook in Admin Hub → AI Assist Automation) and retry.
   - ✅ A clear failure message.
   - ✅ The **manual copy/paste path still works**. A broken automation must not strand the feature.

## Scenario G — The awkward replies *(FR-020, FR-021, FR-024, SC-006, SC-007)*

Paste each of these by hand. This is where a feature like this earns trust.

| Paste | Expect |
|---|---|
| `size: "HUGE"` for a Feature | Size dropped, **row survives** with its notes. No coerced value |
| `{"kind":"agingTriage",...}` (a reply from another surface) | **Whole reply rejected** — a wrong reply is not a partial one |
| An item keyed `GHOST-9` (not on the page) | Reported as unknown; **no row appended**; other items unaffected |
| A reply covering only 2 of 11 Features | Those 2 offered; the rest reported. No row corrupted |
| Prose with no JSON | Clear error; nothing changes |
| `size: "XXL"` | Shown as `XXL (100+) — set a value`; **cannot be accepted** until you enter a number |
| The same reply pasted twice, accepting both times | Notes **not** duplicated (dedupe); estimate unchanged |

## Scenario H — Sizing guidance for manual sizing *(FR-033…FR-035, SC-008)*

1. **Lock** AI Assist (Ctrl+Alt+Z). Open the PI Review tab.
   - ✅ The T-shirt scale is **still visible** — it serves manual sizing, so it does not hide with the AI feature.
   - ✅ Shows XS 10 · S 20 · M 40 · L 60 · XL 80 · XXL 100+.
   - ✅ Links to the [Confluence guidance](https://zilverton.atlassian.net/wiki/spaces/MAGrowthDelivery/pages/222039893/Feature+Template+for+Jira+Feature+Sizing+Guidance).
2. ✅ It matches the scale embedded in the prompt (Scenario D) — one constant, two readers.

---

## Regression checks *(FR-036…FR-038, SC-009)*

The feature must be invisible to everything it did not set out to change.

1. **Manual authoring** — type into cells, **Pull Features from Jira**, **Save to Confluence**.
   - ✅ Unchanged.
2. **Reconciliation on load** — open a page whose Jira data moved.
   - ✅ The `Jira updated N fields …` banner behaves exactly as before.
   - ✅ Description and acceptance criteria do **not** appear in it. *(They must never become Jira-owned columns —
     research R-2, CW-5.)*
3. **The 015 scheduler** — Admin Hub → 🗓️ PI Review Sync → **Run now**.
   - ✅ Behaves exactly as before; no AI involved.
   - ✅ `npm run test:dom` still 13/13 — the engine `piReviewJira.ts` feeds is undisturbed.
4. **Page-load cost** — description/AC are fetched **on demand**, never on load.
   - ✅ Opening a PI Review page issues no extra Jira traffic versus before.

## Sign-off

| Scenario | Covers | ✅ |
|---|---|---|
| A | One prompt on all five surfaces | ☐ |
| B | Unlock works; every affordance survives | ☐ |
| C | Panel gated by unlock + edit mode | ☐ |
| D | Prompt readable first; Jira disclosure present | ☐ |
| E | Review → accept; only two cells move | ☐ |
| F | Auto path; failure leaves manual working | ☐ |
| G | Malformed/unknown/XXL replies | ☐ |
| H | Sizing card visible while locked | ☐ |
| Regression | Manual + scheduled flows unchanged | ☐ |
