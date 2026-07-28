# Contract — AI Delivery Plan (`ai/deliveryPlanPrompt.ts`, `ai/deliveryPlanIngest.ts`)

Propose-only, gated behind `useAiAssistStore`, per-item accept, never AI-attributed. The AI's job is **narrow**:
group repos into Stories (+ name + AC hints) and write a mitigation narrative. Everything checkable is the engine's.

## Prompt (`buildDeliveryPlanPrompt(factSheet, bottlenecks): string`)

- Embeds the **PI Planning Fact Sheet verbatim** as compact tables (Features + their repo components, roster + roles,
  sprints + delivery deadline, release schedule) and the **engine-flagged bottlenecks** (id + statement + figures).
- States the event vocabulary and asks for exactly:
  1. per-Feature **Story decomposition** — which repo(s) each Story covers, a Story summary, optional AC hints;
  2. a **mitigation** per bottleneck id.
- Explicitly instructs: **do not** return dates, capacity, assignments, or sprints (they are computed); use **only**
  repos/keys/people/sprints present in the fact sheet.
- Chunk automatically when the Feature set is too large for one reply (FR-021), each chunk self-contained.

## Reply envelope

```json
{
  "kind": "piDeliveryPlan",
  "stories": [
    { "featureKey": "DENP-100", "summary": "Member enrollment enhancement",
      "repos": ["enrollment-api", "enrollment-ui"], "acHints": ["…"] }
  ],
  "mitigations": [
    { "bottleneckId": "sl-throughput-s3", "mitigation": "Time-box SL test to 20 pts in Sprint 3; add dev unit tests." }
  ]
}
```

## Ingest (`parseDeliveryPlanReply(reply, factSheet, bottlenecks): DeliveryPlanIngestResult`)

Through `extractJsonPayload` + `repairJsonPayload` (auto-repair malformed JSON), then:

- **Reject** a story whose `featureKey` is not a fact-sheet Feature, or that references a **repo not in
  `repoAllowlist`** — with an explicit reason; write nothing for it (FR-020, mirrors 031 allowlist-reject).
- **Reject** a mitigation whose `bottleneckId` is not an engine-flagged bottleneck (FR-026).
- **Ignore** any `dates`, `assignee`, `sprint`, `points` fields if present (FR-017).
- Return `{ stories: AcceptedStory[], mitigationsById: Record<string,string>, rejected: {item, reason}[] }`.
- Result is **propose-only** — nothing writes until per-item accept (FR-027, FR-028).

## Test obligations (vitest, TDD)

- A reply naming a repo not in `repoAllowlist` → that story rejected with reason; others survive — SC-003.
- A reply naming an unknown `featureKey` → rejected.
- A mitigation with an unknown `bottleneckId` → rejected; a matching one retained.
- Any AI-supplied date/assignee/sprint is ignored (not present on the accepted story).
- A prose-wrapped / lightly-malformed reply is repaired and parsed (reuse `repairJsonPayload`).
- The prompt embeds the fact sheet and asks only for decomposition + mitigations (no date/assignment request).
