# Feature Specification: Structured Feature Documentation in Feature Composition

**Feature Branch**: `feature/029-composition-doc-sections`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "I would like modify the build out of features so that the description field gets filled out with these sections when using ai to enhance or document a feature in the 'Feature Composition' page of the agile hub tool: Description: Benefit Hypothesis: Acceptance Criteria: Assumptions: Dependencies: In Scope: Out of Scope: Risks: Non Functional Requirements (NFR): -- Acceptance criteria still needs to be written to the AC field and risks should be linked when possible if there is a ticket already for that risk otherwise just documenting within the description will be sufficient. If the agent doesn't have sufficient information from the provided data to document all of this it can recommend something but needs to format it so that it is clearly indicated that the section of material REQUIRES Business and or Technical validation, it should NEVER say that it was documented by AI though."

## Clarifications

### Session 2026-07-26

- Q: Should the description's "Acceptance Criteria" section carry the full AC text or just point to the AC field? → A: Full AC text in both the description section and the dedicated Acceptance Criteria field.
- Q: How is an existing risk ticket identified, and what link type? → A: Link only when the provided material explicitly references an existing Jira issue key; use the "relates to" link type. The tool does not search Jira for matching risk tickets.
- Q: Format for flagging under-supported sections? → A: A clear inline marker at the top of the section — "⚠ REQUIRES BUSINESS VALIDATION" / "⚠ REQUIRES TECHNICAL VALIDATION" / "⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION" — chosen by the section's nature.
- Q: Scope? → A: The Feature Composition AI only (both create-new and update-existing Feature); not the Feature Splitter, PI Review, or other AI surfaces.

## Context

The Feature Composition page (part of the Agile Hub / PO Tool) already has an AI assist that, from uploaded spreadsheets, fetched Confluence pages, pasted notes, and referenced Jira keys, proposes a Feature — a summary, a description, and acceptance criteria — for the Product Owner to review and commit. Today the **description is free-form**, so the quality and completeness of a documented Feature depends entirely on the material and the model's discretion, and a reader cannot tell which parts are grounded in real input versus inferred.

This feature makes the AI compose the Feature **description as a fixed, SAFe-style nine-section document** every time — Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, and Non-Functional Requirements — in that order, with every section always present. Where the provided material is insufficient to substantiate a section, the AI still proposes content but **clearly flags that section as requiring Business and/or Technical validation**, so nothing inferred is mistaken for fact. The acceptance criteria are additionally written to the dedicated **Acceptance Criteria field**, and a risk that references an existing Jira ticket is **linked ("relates to")** rather than only described. Critically, the composed output must **never state or imply that it was written by AI**.

The change is scoped to the Feature Composition AI's create-new and update-existing flows; it remains **propose-only** — the Product Owner reviews and commits, nothing is written to Jira without acceptance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compose a complete nine-section Feature document (Priority: P1)

A Product Owner on the Feature Composition page provides material (spreadsheets, Confluence pages, notes, Jira keys) and runs AI assist. The proposed Feature's description contains all nine sections in the fixed order, each with its label, populated from the material. The Product Owner reviews and commits; the Feature's description is written with the nine sections and the acceptance criteria are also written to the Acceptance Criteria field.

**Why this priority**: This is the core value — turning free-form output into a consistent, complete, reviewable Feature document. It is the MVP; nothing else matters without it.

**Independent Test**: Provide material for a Feature, run AI assist, and confirm the proposed description contains all nine labeled sections in order and that committing writes both the description and the Acceptance Criteria field.

**Acceptance Scenarios**:

1. **Given** material for a new Feature, **When** AI assist composes it, **Then** the proposed description contains exactly these sections, in this order, each clearly labeled: Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, Non-Functional Requirements (NFR).
2. **Given** a composed proposal with acceptance criteria, **When** the Product Owner commits it, **Then** the acceptance criteria text is written both inside the description's "Acceptance Criteria" section and to the dedicated Acceptance Criteria field.
3. **Given** an existing Feature being updated via AI assist, **When** it composes, **Then** the same nine-section structure is produced for the Product Owner to review before it replaces the description.
4. **Given** any composed output, **When** it is read, **Then** it contains no statement or phrasing indicating it was authored, generated, or drafted by AI.

---

### User Story 2 - Flag under-supported sections for validation (Priority: P1)

When the provided material does not contain enough information to substantiate a section, the AI still proposes reasonable content but marks that section as requiring Business and/or Technical validation, so a reviewer immediately sees what must be confirmed and never mistakes an inference for an established fact.

**Why this priority**: Honesty about what is grounded versus inferred is what makes the document safe to circulate. Without it, a plausible-but-unverified section reads as truth — the exact risk the Product Owner called out. It is as essential as US1.

**Independent Test**: Provide deliberately thin material and confirm that sections the AI could not substantiate carry a clear validation-required marker of the correct kind, while well-supported sections do not.

**Acceptance Scenarios**:

1. **Given** material that does not substantiate a section, **When** the AI proposes that section, **Then** the section opens with a clear marker — "⚠ REQUIRES BUSINESS VALIDATION", "⚠ REQUIRES TECHNICAL VALIDATION", or "⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION" — matching the section's nature.
2. **Given** a section that IS fully substantiated by the material, **When** the AI proposes it, **Then** it carries no validation marker.
3. **Given** any flagged section, **When** it is read, **Then** the flag attributes the need for validation to missing information — never to AI authorship.

---

### User Story 3 - Link risks that already have a ticket (Priority: P2)

When the provided material references an existing Jira issue key for a risk, committing the Feature links that issue to the Feature with a "relates to" link, rather than only mentioning it. Risks with no referenced ticket are documented in the Risks section.

**Why this priority**: Linking makes risks traceable and actionable in Jira, but the document is still complete and useful with risks documented in text alone. It refines rather than blocks the core flow.

**Independent Test**: Provide material describing two risks — one that references an existing Jira key and one that does not — and confirm that committing links the first ("relates to") and documents the second in the Risks section.

**Acceptance Scenarios**:

1. **Given** a risk whose material references an existing Jira issue key, **When** the Feature is committed, **Then** a "relates to" link is created from the Feature to that issue.
2. **Given** a risk with no referenced ticket, **When** the Feature is committed, **Then** the risk is documented in the Risks section and no link is attempted.
3. **Given** a referenced key that cannot be linked (e.g., it does not exist or the link fails), **When** committing, **Then** the risk still appears in the Risks section and the failure is surfaced without blocking the rest of the commit.

---

### Edge Cases

- **No material for a section at all**: the section still appears, with proposed content and a validation-required marker — never omitted, never left blank.
- **Acceptance criteria absent from the material**: the AC section and AC field carry proposed criteria flagged for validation rather than being empty.
- **A referenced Jira key is malformed or unresolvable**: the risk is documented in text; the link is skipped and the issue surfaced, not silently dropped.
- **Update of a Feature that already has a description**: the proposed nine-section document is shown for review before it replaces the existing description; the Product Owner is never surprised by a silent overwrite.
- **Model returns a description missing a section or out of order**: the ingest normalizes to the fixed nine sections in the fixed order (a missing one becomes a validation-flagged placeholder) so the committed document is always complete and consistent.
- **Model attempts AI self-attribution**: any such phrasing is treated as invalid output and stripped/rejected so it never reaches Jira.

## Requirements *(mandatory)*

### Functional Requirements — Document structure

- **FR-001**: The Feature Composition AI MUST compose the Feature description as these nine sections, always all present and in this exact order, each with its label: **Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, Non-Functional Requirements (NFR)**.
- **FR-002**: The AI MUST populate each section from the provided material (uploaded files, fetched pages, notes, referenced Jira issues) rather than generic boilerplate.
- **FR-003**: The composed output MUST NOT contain any statement or phrasing that attributes its authorship to AI (no "generated by", "drafted by AI", "AI-composed", etc.).
- **FR-004**: When the model returns a description that is missing a section or out of order, the ingest MUST normalize it to the fixed nine sections in the fixed order, inserting a validation-flagged placeholder for any missing section, so the committed document is always complete.

### Functional Requirements — Acceptance criteria

- **FR-010**: The acceptance criteria MUST appear as the full text of the description's "Acceptance Criteria" section **and** be written to the dedicated Acceptance Criteria field on commit (the same text in both places).
- **FR-011**: Acceptance criteria MUST be written so each criterion is independently checkable by a tester without further clarification.

### Functional Requirements — Validation flagging

- **FR-020**: For any section the provided material does not sufficiently substantiate, the AI MUST still propose content and MUST prefix that section with a clear marker: **"⚠ REQUIRES BUSINESS VALIDATION"**, **"⚠ REQUIRES TECHNICAL VALIDATION"**, or **"⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION"**, chosen by the section's nature.
- **FR-021**: A section that IS fully substantiated by the material MUST NOT carry a validation marker.
- **FR-022**: A validation marker MUST frame the need for validation as arising from incomplete/unconfirmed information — never as a disclaimer that the content is AI-authored.

### Functional Requirements — Risk linking

- **FR-030**: When the provided material references an existing Jira issue key associated with a risk, committing the Feature MUST create a **"relates to"** link from the Feature to that issue.
- **FR-031**: A risk with no referenced existing ticket MUST be documented in the Risks section, with no link attempted.
- **FR-032**: A referenced key that cannot be linked (unresolvable or link failure) MUST NOT block the commit; the risk MUST remain documented in the Risks section and the failure MUST be surfaced to the Product Owner.
- **FR-033**: The tool MUST NOT search Jira for candidate risk tickets — linking happens only against keys explicitly present in the provided material.

### Functional Requirements — Flow & scope

- **FR-040**: This behavior applies to the Feature Composition AI's **create-new and update-existing** flows only; the Feature Splitter, PI Review, and other AI surfaces are unchanged.
- **FR-041**: The feature MUST remain **propose-only** — the composed Feature (summary, nine-section description, acceptance criteria, proposed risk links) is presented for the Product Owner to review and commit; nothing is written to Jira without acceptance.
- **FR-042**: On an update, the proposed nine-section document MUST be shown for review before it replaces the existing description; there MUST be no silent overwrite.

### Key Entities

- **Feature Document**: the composed description — an ordered set of the nine Sections plus the Feature summary.
- **Section**: one labeled part of the document — its label, its proposed content, and an optional validation requirement (Business / Technical / Both / none).
- **Acceptance Criteria**: the checkable criteria — carried both in the document's AC section and the dedicated AC field.
- **Risk Item**: a documented risk — its text and, when the material references one, the existing Jira issue key to link ("relates to").
- **Composition Proposal**: the reviewable output the Product Owner commits (extends the existing composition proposal with the structured document and proposed risk links).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of AI-composed Feature descriptions contain all nine sections, each labeled, in the fixed order.
- **SC-002**: Whenever acceptance criteria are produced, the same AC text appears in both the description's AC section and the dedicated Acceptance Criteria field.
- **SC-003**: Every section not fully substantiated by the provided material carries a correct validation-required marker, and no fully-substantiated section carries one.
- **SC-004**: 0 AI-composed outputs contain any statement attributing authorship to AI.
- **SC-005**: Every risk whose material references an existing Jira key results in a "relates to" link on commit; every risk without one is documented in the Risks section — with 0 commits blocked by a failed link.
- **SC-006**: A reviewer can tell, at a glance, which sections are grounded in the material and which require validation, without asking the person who ran the tool.

## Assumptions

- **Surface**: the feature modifies the existing Feature Composition AI assist (propose-only, gated behind the AI unlock) rather than adding a new surface; it reuses the current composition prompt/ingest/commit path.
- **Description format**: the nine section labels are rendered using the Jira instance's description markup so they read as clear headings; the exact markup is an implementation detail — the requirement is labeled sections in the fixed order.
- **Risk-ticket detection**: an "existing ticket for a risk" is detected from an explicit Jira issue key present in the provided material or notes; the tool does not infer or search for tickets (per clarification 2).
- **Link type**: risk links use the "relates to" issue link type.
- **Validation kind**: the AI assigns Business, Technical, or Business & Technical to a flagged section based on the section's nature (e.g., Benefit Hypothesis → Business; NFR → Technical); the Product Owner can edit before committing.
- **Update semantics**: on update, the composed document is the proposed replacement description; the Product Owner reviews and decides (no automatic merge with prior free-form text beyond what the material provides).
- **AC field availability**: the dedicated Acceptance Criteria field is discoverable on the instance (via the existing field-name discovery); when it is not, the AC still appears in the description section and the missing field is surfaced honestly.

## Out of Scope

- The Feature Splitter, PI Review, hygiene, and every other AI surface — unchanged.
- Actively searching Jira for candidate risk tickets, or creating new risk tickets.
- Any automated (non-propose) writing of the Feature or its links.
- Enforcing the nine-section structure on Features authored by hand (this governs the AI-composed output only).
- Back-filling or reformatting existing Features not being composed/updated through this tool.
