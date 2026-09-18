# Contract: Deterministic Rules (everything Toolbox decides without AI)

**Modules** (all pure): `intake/notesOutline.ts`, `intake/namedKeys.ts`, `intake/ownershipRule.ts`,
`intake/deferralEvidence.ts`. **Covers**: FR-002, FR-003, FR-011 – FR-015, US2-1…US2-6.

## 1. Notes → numbered lines → outline baseline (`notesOutline.ts`)

```ts
export function numberSourceLines(notesText: string): SourceLine[];
export function buildOutlineBaseline(lines: readonly SourceLine[]): { items: IntakeItem[]; setAsideLines: SetAsideLine[] };
export function proveLineCoverage(intake: Pick<EpicIntake, 'lines' | 'items' | 'setAsideLines'>): { isComplete: boolean; missing: number[]; duplicated: number[] };
export function splitLinesIntoPromptParts(items: readonly IntakeItem[], lines: readonly SourceLine[], maxChars: number): IntakeItem[][];
```

**Input text** is the concatenation of each source's `readSourceText(source)` (`sources/sourceModel.ts:150`), separated
by the source title as an unmarked (level 0) line.

**Markers** (named constants; the first matching marker wins, leading whitespace ignored):

| Level | Markers |
|---|---|
| 1 (top) | `•` `●` `-` `*` `\d+[.)]` |
| 2 (sub) | `o` `◦` `▪` `■` `–` `+` `[a-z][.)]`, **or** any level-1 marker indented ≥ 2 spaces / 1 tab deeper than the previous level-1 line |

An `o` is a marker only when followed by a tab or ≥ 1 space and then text (so "Oregon" is not a sub-bullet).

**Grouping**:

- Level 1 starts a new item.
- Level 2 attaches to the most recent item; with no item yet it becomes its own item.
- Level 0 is set aside, `reason: 'headingOrProse'`, `settledBy: 'rule'`.
- **Unless** no line in the notes has a marker at all → every line is level 1 (a plain list, one item per line).

**Chunking**: parts break only between items. An item larger than `maxChars` goes alone in its own part.

## 2. Named keys (`namedKeys.ts`)

```ts
export const JIRA_KEY_IN_TEXT_PATTERN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})\b/g;
export function extractNamedKeys(lines: readonly SourceLine[], lineNumbers: readonly number[]): NamedKey[];
```

- Keys are upper-cased and de-duplicated per item. `projectKey` is the part before the dash.
- Pure text matching: the lookup (`status: 'notRun'`) is filled by the search step (`duplicate-search.md` §3).
- **False-positive guard**: tokens matching `/^(PI|Q|FY|H)\d/i` and T-shirt/cost tokens are not keys. PI names like
  "PI-26" match the key shape but have a 1–2 letter prefix with no project. The minimum project-prefix length is
  **2 characters, of which the first is a letter**. Anything the search step cannot find is surfaced as `notFound`
  (US3-5), so a false positive costs one PO question, never a wrong create.

## 3. Deferral evidence (`deferralEvidence.ts`)

```ts
export const DEFERRAL_PHRASES: readonly { pattern: RegExp; kind: 'deferred' | 'risk' }[];
export function findDeferralEvidence(itemLines: readonly SourceLine[]): { phrase: string; kind: 'deferred' | 'risk' } | null;
```

Phrases (case-insensitive, whole-phrase):

| Phrase | Kind |
|---|---|
| `future conversation` | deferred |
| `no funding` | deferred |
| `rejected idea card` or `rejected` inside parentheses | deferred |
| `would be funded` | deferred |
| an item whose title is exactly `Risks` | risk |

When found on the item's **own title line**, `kind` is settled `{ settledBy: 'rule', reason: 'Notes say "<phrase>"' }`.
The PO can override. Phrases on sub-lines only become `aiReason` context. This is deliberate: *ID Card Vendor Change
(rejected Idea card)* is a rejected **idea card**, and whether the work is still wanted is exactly the PO call the spec
reserves ("the PO can override"). The rule marks it deferred with the phrase shown, and the PO flips it with one select.

## 4. Area sizes and the ownership rule (`ownershipRule.ts`)

```ts
export const ENROLLMENT_OWNS_AT_SHARE = 60;   // ≥ this % ⇒ Enrollment
export const FULFILLMENT_OWNS_AT_SHARE = 40;  // ≤ this % ⇒ Fulfillment
export function parseAreaSizes(line: SourceLine): AreaSize[];
export function decideOwnerFromSizes(areaSizes: readonly AreaSize[]): OwnerRuleResult;
export function decideOwnerFromShare(enrollmentShare: number): OwnerRuleResult;
```

`OwnerRuleResult = { owner: 'enrollment' | 'fulfillment'; reason: string } | { owner: null; reason: string /* why it goes to the PO */ } | { owner: undefined /* rule does not apply */ }`

**Parsing** — a size token is one of `XS S M L XL XXL` as a whole word, case-insensitive. The area is the nearest
non-filler word on either side, where filler is `size`, `dev`, `effort` or `-`. The patterns this has to handle:

| Line | Parsed |
|---|---|
| `(1.2M) XL Enrollment` | Enrollment XL, cost `1.2M` |
| `Fulfillment M` | Fulfillment M |
| `Infra XL` | Infra XL |
| `Vendor size L` | Vendor L |
| `Fulfilment dev M` | Fulfillment M (alias) |
| `Large for all` | nothing (a word, not a token) |

Cost is a `\(?\$?\d+(\.\d+)?[KMB]\)?` token on the same line. `M` counts as a size only when it stands alone as a
word, so `1.2M` is never read as size M.

**Rule** (`decideOwnerFromSizes`), using the XS…XXL order from `FEATURE_SIZING_SCALE`:

| Stated | Result |
|---|---|
| Enrollment and Fulfillment, different sizes | the larger owns — reason `Stated sizes: Enrollment XL vs Fulfillment M` |
| Enrollment and Fulfillment, equal sizes | `owner: null` → PO question (US2-3) |
| only one of the two | that one owns (US2-2) |
| neither | `undefined` → fall through to share |

**Share** (`decideOwnerFromShare`): `≥ 60` → Enrollment, `≤ 40` → Fulfillment, otherwise `null` → PO. The share must be
an integer from 0 to 100. Anything else counts as an AI rejection for the `owner` slot.

**Precedence**: the size rule runs at the moment the item's lines are known (baseline, and again after any regrouping).
When it settles the owner, an AI share for that item is **recorded but ignored**. The reason shown is the size rule's
(US2-1).
