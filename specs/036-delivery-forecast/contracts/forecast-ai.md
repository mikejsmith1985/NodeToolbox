# Contract: Forecast AI Assistance

**Modules**: `views/SprintDashboard/forecast/ai/forecastAiAssist.ts`,
`views/SprintDashboard/forecast/ai/ForecastAiPanel.tsx`

Propose-only, gated, copy-prompt / paste-reply, per-item accept — the pattern every AI surface in this codebase
already uses. The one design decision specific to this feature is **structural**: the reply schema has nowhere to put
a number.

---

## 0. The rule the schema enforces

Every date, point value, capacity figure and flag is rule-derived (FR-040, H2). The AI writes **narrative and
mitigation only**.

This is not enforced by validation alone — it is enforced by **shape**. A proposal item carries `issueKeys`,
`personKeys` and prose. It has **no numeric field at all**. There is no path by which a model can change a figure,
because the envelope has no slot for one.

Validation then handles the remaining risk: a model naming an issue key or a person the prompt never supplied.

---

## 1. Shell — reuse, not new

```tsx
import { ReportAiPanel } from '../../../ReportsHub/ReportAiPanel.tsx';
```

`ReportAiPanel` already provides `title`, `prompt`, `ingestLabel`, `onIngest`, `error`, `hint`, `children`, and
renders **nothing at all** when AI Assist is locked. That satisfies US8-4 by construction — there is no gate to write.

`ForecastAiPanel.tsx` is a thin wrapper choosing which of the three prompts to render and holding the accept/decline
state. It adds no gate, no unlock, and no copy the gate does not already carry.

---

## 2. The three kinds

| Kind | Question | Prompt inputs |
|---|---|---|
| `forecastDaily` | Who is behind, who is ahead, and what should be said at standup? | Every `IssueForecast` with its state, slack and reason |
| `forecastScopeCut` | Which scope should come out of this release, and why? | `CapacityAssessment` for the code-freeze window + the issues behind it |
| `forecastTestCapacity` | Reduce scope, or add testers — and what would each cost? | `CapacityAssessment` for the external-test window + the SL items |

---

## 3. Prompt shape

```
You are helping a Scrum Master communicate a delivery forecast.

EVERY FIGURE BELOW IS ALREADY CALCULATED AND IS NOT NEGOTIABLE.
Do not compute, adjust, re-estimate or invent any date, point value, day count or percentage.
Reference only the issue keys and people named below. Naming anything else invalidates your reply.

<verbatim engine figures>

Reply with JSON only:
{"kind":"forecastDaily","items":[{"id":"...","headline":"...","narrative":"...","issueKeys":["..."],"personKeys":["..."]}]}
```

| Rule | Requirement |
|---|---|
| Every figure appears **verbatim** as the engine produced it | US8-1 |
| The prompt names every legal issue key and person key | FR-040 |
| The prompt instructs the model to invent nothing | US8-1 |
| No AI-attribution phrasing is requested or accepted | Standing rule |
| Prompt is built by a **pure** function from `ForecastResult` | Testability |

```ts
export function buildForecastDailyPrompt(result: ForecastResult): string
export function buildScopeCutPrompt(assessment: CapacityAssessment, forecasts: readonly IssueForecast[]): string
export function buildTestCapacityPrompt(assessment: CapacityAssessment, forecasts: readonly IssueForecast[]): string
```

---

## 4. Reply shape and ingest

```ts
export type ForecastAiKind = 'forecastDaily' | 'forecastScopeCut' | 'forecastTestCapacity';

export interface ForecastAiItem {
  id: string;
  headline: string;
  narrative: string;
  issueKeys: string[];
  personKeys: string[];
}

export interface ForecastAiIngest {
  kind: ForecastAiKind;
  items: ForecastAiItem[];
  rejectedItems: Array<{ id: string; reason: string }>;
}

export function parseForecastAiReply(
  replyText: string,
  expectedKind: ForecastAiKind,
  allowedIssueKeys: readonly string[],
  allowedPersonKeys: readonly string[],
): ForecastAiIngest
```

Uses `utils/extractJsonPayload.ts` so a fenced or prose-wrapped reply still parses — the same tolerance every other
ingest in this codebase has.

### Rejection rules (FR-040, US8-2)

| # | Condition | Outcome |
|---|---|---|
| 1 | An `issueKeys` entry not in `allowedIssueKeys` | Item rejected, reason names the key |
| 2 | A `personKeys` entry not in `allowedPersonKeys` | Item rejected, reason names the person |
| 3 | The item carries **any** unexpected property | Item rejected, reason names the property |
| 4 | `headline` or `narrative` blank | Item rejected |
| 5 | `kind` ≠ `expectedKind` | Whole reply rejected |
| 6 | Not parseable as JSON | Whole reply rejected with a readable message |
| 7 | Narrative text contains AI self-attribution | Attribution stripped; item kept |

**Rule 3 is the numeric guard.** The schema has no numeric field, so a model that emits `"days": 14` produces an
unexpected property and the item is rejected — precisely the case US8-2 asserts. A rejected item is **named**, never
dropped silently.

### Acceptance (FR-041)

Per item. Accepting copies the narrative into the surface's own display state. **Nothing is written to Jira by any AI
path in this feature** — so `ReportAiPanel`'s default hint (*"advisory only, writes nothing to Jira"*) is accurate and
is not overridden.

---

## 5. Prohibitions (FR-042)

- No scheduler, no background call, no automated channel.
- No network request from any of these modules; the operator carries the text both ways.
- No AI copy in a shared component — only inside `ai/` and the panel it renders.

---

## 6. Tests

### Prompt builders

| # | Given | Expect |
|---|---|---|
| 1 | A result with 3 forecasts | Every issue key appears in the prompt |
| 2 | Same | Every state and slack figure appears verbatim |
| 3 | Same | The do-not-invent instruction is present |
| 4 | Same input twice | Byte-identical prompt (deterministic) |
| 5 | Empty result | A prompt that says there is nothing to report, not an empty string |
| 6 | Any prompt | No AI-attribution phrasing requested |

### Ingest

| # | Given | Expect |
|---|---|---|
| 7 | Valid reply, all keys allowed | Items parsed, `rejectedItems` empty (US8-3) |
| 8 | Reply naming `FAKE-999` | That item rejected, key named (US8-2) |
| 9 | Reply naming an unknown person | That item rejected |
| 10 | Item with `"days": 14` | Rejected — unexpected property (US8-2) |
| 11 | Item with `"targetStart": "2026-09-01"` | Rejected |
| 12 | Blank narrative | Rejected |
| 13 | Wrong `kind` | Whole reply rejected |
| 14 | Non-JSON | Readable error, no throw |
| 15 | Fenced ```json block | Parses |
| 16 | Prose before and after the JSON | Parses |
| 17 | Narrative saying "As an AI, I..." | Attribution stripped, item kept |
| 18 | Mixed valid and invalid items | Valid kept, invalid listed — never all-or-nothing |

### Panel

| # | Given | Expect |
|---|---|---|
| 19 | AI Assist locked | Renders `null` — no affordance, no copy (US8-4) |
| 20 | Unlocked | Copy button and ingest control present |
| 21 | Ingest error | Error rendered, previously accepted items retained |
| 22 | Accept one of three | Only that item marked accepted |
