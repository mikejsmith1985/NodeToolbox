// intakeTypes.ts — Shapes for the Teams→Jira intake importer: parsed submissions, the (minimal)
// intake configuration, per-row queue state, and the local dedup ledger. No I/O lives here.
//
// The Teams submission contract is fixed, so mapping is by convention (summary→summary,
// description→description, priority→priority by name, issueType→issuetype by name from the row,
// acceptanceCriteria→a configured custom field). The only genuine configuration is the target
// project (not carried in the record) plus the auto-create toggle. See data-model.md.

/** The fixed core fields the Teams Adaptive Card captures (the Phase-1 ↔ Phase-2 contract). */
export type CoreFieldKey = 'summary' | 'description' | 'acceptanceCriteria' | 'issueType' | 'priority';

/** Who submitted a request in Teams; drives the Jira reporter resolution. */
export interface IntakeSubmitter {
  displayName: string;
  email: string;
}

/** The core field values from one submission. */
export interface IntakeCoreFields {
  summary: string;
  description: string;
  acceptanceCriteria: string;
  issueType: string;
  priority: string;
}

/** One normalized Teams submission (from one spreadsheet row or JSON record). */
export interface IntakeSubmission {
  id: string;
  submittedAt: string;
  status: string;
  submitter: IntakeSubmitter;
  fields: IntakeCoreFields;
  /** Any columns beyond the known contract, preserved for forward compatibility (FR-5.2). */
  extras: Record<string, string>;
  /** Source row index, used in queue error messages. */
  rowIndex: number;
  /** Non-empty when the row is malformed (e.g. missing id/summary); such rows are never created. */
  parseErrors: string[];
}

/** The Jira custom field that holds Acceptance Criteria on this instance. */
export const DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID = 'customfield_10200';

/**
 * The single active v1 intake configuration. Persisted in the shared Confluence content property.
 * v1 targets one project; issue type + priority come from each submission row, not from here.
 */
export interface IntakeConfig {
  /** Target Jira project key (the one thing not carried in the submission record). */
  projectKey: string;
  /** Jira field id that receives Acceptance Criteria (defaults to customfield_10200). */
  acceptanceCriteriaFieldId: string;
  /** true = create on import; false = review-and-pick (FR-1.3). */
  autoCreateOnImport: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** Whether the submitter resolved to a real Jira user or fell back to the integration account. */
export type ReporterOutcome = 'matched' | 'fallback';

/** One locally-recorded created issue, keyed by submission id — the dedup source of truth. */
export interface ProcessedEntry {
  id: string;
  jiraKey: string;
  createdAt: string;
  reporterOutcome: ReporterOutcome;
}

/** The per-submission view state the queue renders. */
export type QueueEntryState = 'new' | 'invalid' | 'creating' | 'imported' | 'failed' | 'skipped';

/** One row in the intake queue: the submission plus its current processing state. */
export interface QueueEntry {
  submission: IntakeSubmission;
  state: QueueEntryState;
  jiraKey: string | null;
  /** Reasons a row cannot be created (missing required field, malformed row, Jira rejection). */
  blockingReasons: string[];
  reporterOutcome: ReporterOutcome | null;
}

/** The whole intake store persisted under one Confluence content-property key. */
export interface JiraIntakeStore {
  schemaVersion: number;
  updatedAt: string;
  config: IntakeConfig | null;
  ledger: ProcessedEntry[];
}

/** Current intake store schema version; load rejects unknown versions. */
export const JIRA_INTAKE_STORE_SCHEMA_VERSION = 2;
