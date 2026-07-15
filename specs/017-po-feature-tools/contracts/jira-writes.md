# Contract: Jira & Confluence Access (PO Tool)

Every read and write goes through the existing **Jira proxy** / **Confluence proxy** with the server's configured
credentials. **No new authentication path, no browser OAuth, no credential in client code** (FR-040, Article IX).

**The cardinal rule**: no write occurs outside an explicit, human-initiated commit from the review step (FR-014,
FR-021, SC-006).

---

## Reads

### Load the source Feature (FR-007, R4)

```text
GET /rest/api/2/issue/{key}?fields=project,issuetype,summary,description,status,assignee,duedate,
                                   fixVersions,parent,issuelinks,self,<hygiene field ids>
```

Both `fields.project.key` **and** `fields.issuetype.id` are captured in this **one** call:

- `issuetype.id` — increments echo the original's **own** type; "Feature" is never hard-coded (A17, FR-016).
- `project.key` — required-field discovery is keyed by project key; fetching it here avoids a second round-trip.

Not found / no permission / not Feature-like → a clear message; the tab stays usable and **no draft is destroyed**.
An empty or failed result must be reported as a **connectivity** failure where applicable — **never** rendered as
"no data" (spec A11).

### Discover projects, issue types, required fields (FR-034, FR-035, FR-037)

```text
GET /rest/api/2/issue/createmeta/{projectKey}/issuetypes?maxResults=200
GET /rest/api/2/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}?maxResults=200
```

Reuse the existing client wrappers and their caching hook. The modern two-step endpoints are mandatory — the classic
bulk `createmeta?projectKeys=` call is removed on Cloud and DC 10+. **Only instance-reported projects and types are
offered** (FR-037).

### Discover issue link types (R3, FR-037)

```text
GET /rest/api/2/issueLinkType
```

Flatten to a unique name list (the existing reader does this). Default selection `'relates to'`. **Link type names
are never hard-coded** — instances differ.

### Fetch a Confluence page by URL (FR-023b)

```text
GET /confluence-proxy/wiki/rest/api/content/{pageId}?expand=body.storage%2Cversion
```

Reuse `resolveConfluencePageIdFromReference` + `fetchConfluencePageByReference` — both already handle a bare numeric
id, a `?pageId=` query param, and a pretty `/pages/12345/Title` URL. Unresolvable → the existing "paste the full
Confluence page URL or the numeric page ID" error.

> **Envelope trap**: on the **client** the proxy is a transparent pipe returning raw Confluence JSON — read
> `page.body.storage.value`. (The **server** helper wraps in `{status, body}`, i.e. `result.body.body.storage.value`.
> This feature is client-side; use the client shape.)

Content is passed through the client storage-HTML→text util (new; ported from the server's stripper) and stored as
**plain text**. It is **never** injected as HTML — no `dangerouslySetInnerHTML` on remote content (R2c).

**Failure taxonomy (FR-023b, SC-018)** — these four must be **distinct**:

| Condition | Signal | PO-facing meaning |
|-----------|--------|-------------------|
| Not found | upstream 404 | "That page doesn't exist." |
| No permission | upstream 401/403 | "The configured Confluence account can't see that page." |
| Unreachable | proxy 502 / DNS failure | "Confluence is unreachable — check VPN." |
| Not configured | proxy 502 `Confluence not configured` | "Confluence isn't set up on this server." |

**This requires a small extension** (R2b): the shared client error helper currently **discards** `response.status`,
collapsing all four into one message. Attach the status to the thrown error and branch on it. The change is
**additive** — existing consumers keep reading `.message` unchanged.

---

## Writes — only from an explicit commit

### Create a Feature / increment (FR-016, FR-034, FR-035)

```text
POST /rest/api/2/issue
{ "fields": { "project": { "key": "ABC" }, "issuetype": { "id": "10001" }, "summary": "…", … } }
```

Reuse the existing `createIssue` and the established payload convention: **project by key, issue type by id**, empty
optionals **omitted** so an unset field is never sent.

**Required-field pre-flight is a hard gate** (FR-034, SC-008): compare the payload against the instance's createmeta
descriptors; if any required field is unsatisfied, **name each and block the write**. No partial issue is ever
produced. Reuse the existing `findMissingRequiredFields` + the build→validate→**block**→create→browse-url sequence.

### Update an existing Feature (FR-036, FR-038)

Reuse the **instance-correct** field-write helpers rather than hand-rolling payloads — they resolve option/user/link/
version shapes against the instance's own metadata, which is what keeps both **Cloud and Data Center** working:

| Field kind | Helper behavior |
|---|---|
| simple | `PUT /rest/api/2/issue/{key}` `{fields:{[id]:value}}` |
| option | resolves the allowed value from editmeta (`{id}` → `{value}` → `{name}` → `{key}`), array-wraps when the schema says array |
| user | emits `{accountId}` (Cloud) / `{key}` / `{name}` (DC) |
| issue-link field / parent | special-cases `parent` → `{parent:{key}}` |
| fix version | uses the `update`/`set` shape, not `fields` |
| story points | writes the configured points field, retrying the legacy id on failure |

An update **must not** create a duplicate (FR-036, SC-012).

### Link an increment to the original (FR-016a, R3)

```text
POST /rest/api/2/issueLink
{ "type": { "name": "relates to" }, "inwardIssue": { "key": "NEW-1" }, "outwardIssue": { "key": "ORIG-1" } }
```

**New client wrapper** (~3 lines over the existing `jiraPost`); the body shape ports **verbatim** from the server's
proven create-then-link implementation. Jira answers `201` with **no body** — the existing response parser already
returns `undefined` for an empty body, so a `void` post is safe.

**Links are best-effort.** A link failure is **reported per item** and **never thrown** — it must not orphan an
already-created issue. Jira has no transaction across create+link; a thrown link error would strand a created issue
with no record. This mirrors the server precedent exactly.

### What the PO Tool NEVER does

- ❌ **Never deletes** an issue.
- ❌ **Never closes or transitions** the original Feature after a split — that stays a deliberate human act in Jira
  (FR-016b, A16, SC-016).
- ❌ **Never writes** during load, editing, coaching, prompt generation, or AI ingest (FR-014, FR-021, SC-006).
- ❌ **Never invents** a project, issue type, field, or link type (FR-037).
- ❌ **Never writes** while any required field is unsatisfied (FR-034).

---

## Commit semantics

**Order**: creates → links → updates. Every step contributes a `CommitOutcome.items[]` entry.

**Per-item reporting** (FR-015, FR-041, SC-011): each write's outcome is reported individually, carrying the
instance's **actual** rejection reason — never a generic error.

**Partial failure** (FR-045, SC-011): successes are retained (`createdJiraKey` stamped so a retry never
double-creates); failures keep the draft alive and re-committable. The draft is cleared **only** on full success.

**Source drift** (spec edge case): the original is **re-read** at commit; any change since load is surfaced in
`sourceDriftWarnings` **before** writing. The PO's authored draft is never silently overwritten.

---

## Invariants

- **INV-J1** — Zero Jira writes occur outside an explicit reviewed commit. *(Verified by observing zero write calls
  across a full unlocked AI draft-and-ingest cycle — SC-006.)*
- **INV-J2** — After a committed split, the original's status, workflow state, and content are **unchanged**, and it
  is linked to every created increment. *(SC-016)*
- **INV-J3** — A create with an unsatisfied required field produces **no** issue in Jira and names every missing
  field. *(SC-008)*
- **INV-J4** — A link failure never undoes or orphans a successful create; it is reported, not thrown.
- **INV-J5** — Increments carry the **original's own** issue type id, never a hard-coded "Feature". *(A17)*
- **INV-J6** — The four Confluence failure conditions produce four **distinct, accurate** messages; none is ever
  presented as "empty". *(SC-018)*
- **INV-J7** — No credential enters client code, a prompt, a draft, or a log. *(Article IX)*
