# Contract: Release Date Resolution

**Module**: `views/SprintDashboard/forecast/releaseDateResolve.ts`

Nothing in the codebase reads a release date out of a fix-version **name** (research R-9). Without this, every release
whose date lives only in its name drops silently out of the forecast — which reads as "nothing to forecast" rather
than "the date is missing."

---

## Interface

```ts
export interface FixVersionLike {
  name: string;
  releaseDate?: string | null;
  released?: boolean;
}

export interface ReleaseDateResolution {
  versionName: string;
  fieldDateIso: string | null;
  nameDateIso: string | null;
  resolvedDateIso: string | null;
  source: 'field' | 'name' | 'none';
  hasDisagreement: boolean;
  hasAmbiguousName: boolean;
  isReleased: boolean;
}

/** Reads the date out of a version name. Exported for its own tests. */
export function parseReleaseDateFromName(versionName: string): { dateIso: string | null; isAmbiguous: boolean }

/** Field first, name second, and it says which it used. */
export function resolveReleaseDate(fixVersion: FixVersionLike): ReleaseDateResolution

export function resolveReleaseDates(fixVersions: readonly FixVersionLike[]): ReleaseDateResolution[]
```

---

## Name parsing (FR-032)

**Pattern**: `M/D/YY`, `M/D/YYYY`, `MM/DD/YY`, `MM/DD/YYYY` — one or two digit month and day, two or four digit year,
separated by `/`, appearing **anywhere** in the name.

| Rule | Behaviour |
|---|---|
| Order | Always month/day/year (US), per the stated convention |
| Century window | `00`–`79` → `20xx`; `80`–`99` → `19xx` |
| Delimiter | `/` only. `-` is not accepted — it collides with the ISO form and would read `2026-08-20` as month 2026 |
| Boundaries | Not preceded or followed by a digit, so `1234/5/6789` is not a match |
| Calendar validity | `13/45/2026` and `2/30/2026` are **not** matches — a value that is not a real day is not a date |
| Leap year | `2/29/2024` matches; `2/29/2026` does not |
| Multiple matches | The **first** wins; `isAmbiguous: true` |
| No match | `{ dateIso: null, isAmbiguous: false }` |
| Output | Always `YYYY-MM-DD`, zero-padded |

**Why `-` is rejected**: a version named `Release 2026-08-20` would otherwise parse as month 2026. Restricting to `/`
means an ISO-looking name yields no name date and falls through to the field — which is the right answer, because a
version named in ISO almost certainly has its field set too.

---

## Resolution (FR-031, FR-033, FR-034)

| Field present | Name yields a date | `resolvedDateIso` | `source` | `hasDisagreement` |
|---|---|---|---|---|
| ✅ | ✅ same | field | `field` | `false` |
| ✅ | ✅ different | **field** | `field` | **`true`** |
| ✅ | ❌ | field | `field` | `false` |
| ❌ | ✅ | name | `name` | `false` |
| ❌ | ❌ | `null` | `none` | `false` |

The field always wins (FR-033). A version name that lies about its own date is a real data defect, and reporting it is
more useful than silently preferring either value.

**Field reading**: the release-date field may arrive as `2026-08-20` or as a UTC-midnight datetime. The leading
`YYYY-MM-DD` is taken as-is — the same rule `issueDateRules.readDateFieldDay` documents, and for the same reason: a
date field names the day written on its face, and converting it to a local day yields the day before west of
Greenwich.

**Undated version** ⇒ `source: 'none'`, and every issue carrying only that version becomes `unforecastable` in
`issueForecast.ts`, never `on-track` (FR-034).

---

## Tests

### `parseReleaseDateFromName`

| # | Given | Expect |
|---|---|---|
| 1 | `Release 08/20/2026` | `2026-08-20` |
| 2 | `Release 8/20/2026` | `2026-08-20` (US7-2) |
| 3 | `Release 8/20/26` | `2026-08-20` |
| 4 | `Release 08/20/26` | `2026-08-20` |
| 5 | `R1 12/1/26 hotfix` | `2026-12-01` |
| 6 | `Legacy 3/15/95` | `1995-03-15` (80–99 → 19xx) |
| 7 | `Edge 1/1/79` | `2079-01-01` |
| 8 | `Edge 1/1/80` | `1980-01-01` |
| 9 | `Release 2026-08-20` | `null` — `-` not accepted |
| 10 | `Release 13/45/2026` | `null` — not a real day |
| 11 | `Release 2/30/2026` | `null` |
| 12 | `Release 2/29/2024` | `2024-02-29` |
| 13 | `Release 2/29/2026` | `null` |
| 14 | `Sprint 5` | `null` |
| 15 | `Merge 1/2/26 into 3/4/26` | `2026-01-02`, `isAmbiguous` true |
| 16 | `Build 1234/5/6789` | `null` |
| 17 | `''` | `null` |

### `resolveReleaseDate`

| # | Given | Expect |
|---|---|---|
| 18 | Field `2026-09-01`, name `Release 08/20/2026` | `2026-09-01`, source `field`, `hasDisagreement` true (US7-3) |
| 19 | No field, name `Release 08/20/2026` | `2026-08-20`, source `name` (US7-1) |
| 20 | Field `2026-08-20`, name `Release 08/20/2026` | source `field`, no disagreement |
| 21 | Field `2026-08-20T00:00:00.000+0000` | `2026-08-20` — leading day taken as-is |
| 22 | Field `''`, name `Sprint 5` | `null`, source `none` (US7-4) |
| 23 | Field absent, name absent | `null`, source `none`, no throw |
| 24 | `released: true` | Passed through unchanged |
| 25 | `resolveReleaseDates` over a mixed list | One resolution per input, order preserved |
