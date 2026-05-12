// issueLinking.ts — Types for the Jira ↔ SNow issue linking and health-check system.
//
// A "linked pair" is a Jira Defect or Story that has been associated with a
// ServiceNow Problem record. The association is detected automatically from
// existing field conventions — no new fields are required in either system.
//
// Linking convention:
//   Jira side:  customfield_11203 on the Defect/Story contains the SNow reference.
//   SNow side:  The Jira issue key (e.g. "TBX-123") is appended to the SNow
//               Problem's problem_statement field.

import type { JiraIssue } from './jira.ts';
import type { SnowMyIssue } from './snow.ts';

// ── Health status ──

/**
 * The overall health color for a linked Jira ↔ SNow Problem pair.
 *
 * Calculated by comparing mapped fields (e.g. status) across both systems:
 *   green  = ALL mapped fields match
 *   yellow = SOME mapped fields match (> 0 mismatches, < total mapped fields)
 *   red    = NO mapped fields match
 */
export type HealthStatus = 'green' | 'yellow' | 'red';

// ── Status mapping ──

/**
 * A single user-defined equivalence between a Jira status label and a SNow state label.
 *
 * The fixed system mapping ("To Do" → "New") is always applied and cannot be
 * removed via the UI. User-defined mappings supplement it.
 */
export interface StatusMapping {
  /** Jira status name as returned by the Jira REST API (e.g. "In Progress"). */
  jiraStatus: string;

  /** ServiceNow state display label (e.g. "In Progress", "On Hold"). */
  snowStatus: string;

  /**
   * When true, this mapping was created by the system and cannot be deleted.
   * Currently only "To Do → New" is a system mapping.
   */
  isSystemDefined: boolean;
}

// ── Linked pair ──

/**
 * A matched Jira Defect/Story + SNow Problem pair with computed health status.
 *
 * Pairs are computed at render time by `detectLinkedPairs()` — they are not
 * stored anywhere; the source of truth is always the live Jira/SNow field values.
 */
export interface LinkedIssuePair {
  /**
   * Unique identifier for this pair in React lists.
   * Composed of the Jira issue key + SNow sys_id to guarantee uniqueness.
   */
  pairId: string;

  /** The Jira Defect or Story involved in this link. */
  jiraIssue: JiraIssue;

  /** The SNow Problem matched to the Jira issue. */
  snowProblem: SnowMyIssue;

  /** Overall health computed from the current status mappings. */
  healthStatus: HealthStatus;

  /**
   * How many mapped fields currently match between the two records.
   * Used to display a tooltip like "2 of 3 fields match".
   */
  matchingFieldCount: number;

  /** Total number of fields that were evaluated for the health check. */
  totalMappedFieldCount: number;
}
