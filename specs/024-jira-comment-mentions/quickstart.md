# Quickstart & Validation: Jira-Native @-Mentions in Toolbox Comments

**Feature**: `024-jira-comment-mentions` | **Plan**: [plan.md](./plan.md)

How to run the feature and prove it works. **Test 0 is a prerequisite for design, not just verification** — run it
before implementing FR-013 either way.

---

## Prerequisites

- Repo on `feature/024-jira-comment-mentions`.
- Jira reachable. **If results come back empty, check VPN first** — an unreachable Jira looks exactly like a
  topology bug from inside the app.
- A colleague willing to confirm whether they received a notification (Test 0 only).
- A scratch Jira issue you may comment on freely.

```powershell
cd C:\ProjectsWin\NodeToolbox
.\scripts\run-dev-clean.ps1        # never test against a built exe
```

---

## Test 0 — The R3 deciding test ⚠️ RUN FIRST

**Settles**: FR-013 vs FR-013a — whether the composer can show a readable mention.
**Why it cannot be skipped**: no amount of documentation reading substitutes for observing a notification
(Article X). This is the feature's only unverified assumption ([research R3](./research.md#r3)).

1. Find your colleague's identifier — search for them in any existing assignee picker (Hygiene fix, Feature Review)
   and note the flavour: `accountId:…`, `name:…`, or `key:…`.
2. On the scratch issue, post **comment A** in Jira's own comment box using the plain form:
   - `accountId` → `[~accountid:<value>]`
   - `name` / `key` → `[~<value>]`
3. Confirm with your colleague that they were notified. *(Establishes the baseline — if this fails, the identifier or
   flavour is wrong, not the form.)*
4. Post **comment B** using the aliased form: `[Their Display Name|~<value>]`
5. Ask two things: **were they notified for comment B**, and how does B render in Jira's UI?

| Outcome | Decision |
|---|---|
| B notified **and** renders as a mention | ✅ Implement **FR-013** — add the display-name prefix in `buildMentionToken`. One function changes. |
| B did not notify, or renders as a plain link | ❌ **FR-013a** stands permanently. Plain token + the `MentionDraftSummary` companion line. |
| Ambiguous / cannot confirm | ❌ Treat as failure. FR-012 outranks FR-013 — never ship a mention that might not notify. |

Record the outcome in `research.md` under R3 before writing `buildMentionToken`.

---

## Test 1 — Mentions read as names (US1, SC-001)

1. Open any issue with comments that tag people — Hygiene finding, DSU Board card, or F2 quick lookup.
2. Read the thread.

**Expected**: every tagged person appears as a display name. **Zero** `[~accountid:…]` or `[~jsmith]` strings.

**Regression case (FR-002 — the data-loss bug)**: find a comment posted from Jira Cloud's rich editor (an ADF body).
Today the mention is **missing entirely** — the sentence reads as though a word were deleted. It must now show the
name. Compare the same comment in Jira side by side; the sentences must match.

---

## Test 2 — Loading is not the same as unidentifiable (FR-005a, Q4)

1. Throttle the network (DevTools → Slow 3G) and open a thread mentioning several people not otherwise on screen.

**Expected**:
- Comment text appears **immediately** — never blocked on names (FR-005).
- Each unresolved mention shows a **loading marker**, visibly different from `@unknown user`.
- Markers resolve to names; **none spins forever** (SC-007 structural guarantee).

**Failure to watch for**: if a slow mention shows `@unknown user` and *then* becomes a name, the two states have been
conflated — the exact bug FR-005a exists to prevent.

---

## Test 3 — Unresolvable renders honestly (FR-004, SC-006)

1. Open a thread mentioning a deactivated or departed colleague.

**Expected**: `@unknown user`. Never a blank, never a raw identifier, no error over the thread. The sentence still
reads. Per Q3 the identifier is deliberately **not** recoverable — that is the accepted trade, not a bug.

---

## Test 4 — Tag a colleague without leaving Toolbox (US2, SC-002, SC-003)

1. Open any issue's comment box. Type `Thanks @` then a few letters of a colleague's name.
2. Pick them from the list. Finish the sentence. Post.

**Expected**:
- The picker opened on `@` and filtered as you typed.
- Focus returned to the box, caret after the inserted mention — typing continues naturally.
- **"Tagging: Their Name"** appears beneath the box (R10).
- The comment posts and, viewed **in Jira**, shows a real mention.
- **Your colleague confirms they were notified.** SC-002 requires this — a successful POST is not proof
  (Article X).
- You never opened Jira to do it (SC-003).

---

## Test 5 — The picker stays out of the way (SC-008, FR-014)

| Type this | Expected |
|---|---|
| `mike@example.com` | Picker **never opens** (FR-009a word-boundary rule) |
| `@` then Escape | Closes; `@` remains as plain text; you keep typing |
| `@zzzznobody` | "No people found"; nothing inserted; not a dead end |

---

## Test 6 — Every comment box behaves the same (US3, SC-005)

Walk all four and repeat Test 4's first two steps:

| # | Surface | Where |
|---|---|---|
| 1 | Issue detail panel | Hygiene finding, or F2 quick lookup |
| 2 | DSU Board overlay | DSU Board → open a card |
| 3 | DSU Daily | DSU Daily view |
| 4 | Bulk comment | My Issues → select issues → bulk comment |
| 5 | Mentions reply | My Issues → Mentions *(inherits #1)* |

**Expected**: identical trigger, keyboard behaviour, and appearance everywhere.

**Bulk case (US3 acceptance 4)**: compose one mention, post to 3 issues, confirm all 3 carry a working mention.

---

## Test 7 — Keyboard only (NFR-003)

Without touching the mouse: focus the box → `@` → type → `↓` `↓` → `Enter` → finish → post.

**Expected**: every step reachable; focus never lost; the active option is announced by a screen reader.

---

## Test 8 — Self-mention emphasis (US4, FR-021)

Open a thread where you are tagged.

**Expected**: your mention is visually distinct from others, **and distinguishable in greyscale** (NFR-001 — never
colour alone). Take a greyscale screenshot to confirm.

---

## Test 9 — Nothing else moved (NFR-005, FR-022, Q1)

The highest-value regression sweep — these paths deliberately share code with the ones being changed.

| Check | Expected |
|---|---|
| **My Issues → Mentions** | Same mentions detected as before (FR-022) |
| **Issue descriptions** | Still render as today — raw identifiers included. Q1 scoped this out; the inconsistency is **accepted, not a bug** |
| **PO Tool** Feature Composition / Splitter | Description text unchanged (`normalizeRichTextToPlainText` untouched — R7) |
| **Sprint Dashboard** release window | INT-deploy / Day-4 detection unchanged (`normalizeCommentBody` is keyword matching, not display — R4) |
| **Feature Canvas** story inspector, **SNow Hub** fields | Unchanged |
| **Assignee pickers** (Hygiene fix, Readiness fix, Feature Review, field editors) | Still work — the shared shell extraction must not regress its four existing callers |

---

## Automated suites

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm test                      # vitest — format module, store, trigger rule, components

cd C:\ProjectsWin\NodeToolbox
npm test                      # jest — server; must stay green (nothing server-side changed)
npm run test:dom              # engine bundles; must stay green
npx playwright test test/e2e/comment-mentions.spec.js
```

**All green plus Tests 0 and 4 confirmed by a real person** is the definition of done. The automated suites cannot
prove SC-002 — only a colleague saying "yes, I got the notification" can.
