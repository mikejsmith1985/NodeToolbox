// useSnowIssues.ts — React hook that fetches all ServiceNow work items assigned
// to the current user across all supported record types.
//
// Uses the SNow relay (bookmarklet) via snowFetch() — the relay must be active
// for these calls to succeed. If the relay is offline the hook surfaces a clear
// error rather than silently returning empty data.
//
// Record types fetched:
//   incident        — IT support incidents
//   problem         — Root-cause problem records (also carries the Jira link field)
//   sc_task         — Service catalog fulfillment tasks
//   change_request  — IT change requests

import { useCallback, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowMyIssue, SnowIssueType, SnowTableResponse } from '../../../types/snow.ts';

// ── SNow API constants ──

/**
 * Server-side GlideScript expression that resolves to the currently
 * authenticated user's sys_id. SNow evaluates this expression at query time,
 * so we never need to hard-code or look up the user's sys_id ourselves.
 */
const SNOW_CURRENT_USER_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';

/**
 * Fields requested from each SNow record type.
 * `problem_statement` is included so we can detect appended Jira keys on Problems.
 */
const SNOW_ISSUE_FIELDS =
  'sys_id,number,short_description,state,priority,sys_class_name,opened_at,problem_statement';

/** Maximum records to fetch per record type. Keeps response times reasonable. */
const MAX_SNOW_RECORDS_PER_TYPE = 50;

/** All SNow table names that My Issues surfaces. */
const SNOW_RECORD_TYPES: SnowIssueType[] = ['incident', 'problem', 'sc_task', 'change_request'];

// ── Hook return type ──

export interface SnowIssuesState {
  /** All SNow issues across all record types, sorted by opened_at descending. */
  snowIssues: SnowMyIssue[];
  /** True while any of the parallel SNow fetches are in flight. */
  isLoadingSnowIssues: boolean;
  /** Error message if any fetch failed, or null when all succeeded. */
  snowFetchError: string | null;
  /** Triggers a fresh fetch of all SNow issues. */
  fetchSnowIssues(): Promise<void>;
}

// ── Helpers ──

/**
 * Builds the SNow Table REST API path for a given record type.
 * The query returns only records assigned to the current user.
 */
function buildSnowTablePath(recordType: SnowIssueType): string {
  const encodedQuery = encodeURIComponent(SNOW_CURRENT_USER_QUERY);
  return (
    `/api/now/table/${recordType}` +
    `?sysparm_query=${encodedQuery}` +
    `&sysparm_fields=${SNOW_ISSUE_FIELDS}` +
    `&sysparm_limit=${MAX_SNOW_RECORDS_PER_TYPE}` +
    `&sysparm_display_value=true`
  );
}

/**
 * Fetches a single SNow record type and stamps `sys_class_name` on each result
 * so consumers can distinguish record types without inspecting the number prefix.
 */
async function fetchSnowRecordType(recordType: SnowIssueType): Promise<SnowMyIssue[]> {
  const path = buildSnowTablePath(recordType);
  const response = await snowFetch<SnowTableResponse<SnowMyIssue>>(path);
  return response.result.map((issue) => ({ ...issue, sys_class_name: recordType }));
}

/**
 * Sorts SNow issues newest-first so the most recently opened items appear at the
 * top of the My Issues list — consistent with how Jira issues are ordered.
 */
function sortByOpenedAtDescending(issueA: SnowMyIssue, issueB: SnowMyIssue): number {
  return new Date(issueB.opened_at).getTime() - new Date(issueA.opened_at).getTime();
}

// ── Hook ──

/**
 * Fetches all ServiceNow work items assigned to the currently authenticated user.
 *
 * Fires parallel requests for all 4 supported record types so the total wait
 * time equals the slowest single request, not the sum of all requests.
 * Requires the SNow relay bookmarklet to be active.
 */
export function useSnowIssues(): SnowIssuesState {
  const [snowIssues, setSnowIssues] = useState<SnowMyIssue[]>([]);
  const [isLoadingSnowIssues, setIsLoadingSnowIssues] = useState(false);
  const [snowFetchError, setSnowFetchError] = useState<string | null>(null);

  const fetchSnowIssues = useCallback(async () => {
    setIsLoadingSnowIssues(true);
    setSnowFetchError(null);

    try {
      // Fire all 4 record-type fetches in parallel — Promise.allSettled means
      // a single failing type won't suppress results from the others.
      const settledResults = await Promise.allSettled(
        SNOW_RECORD_TYPES.map((recordType) => fetchSnowRecordType(recordType)),
      );

      const combinedIssues: SnowMyIssue[] = [];
      const errorMessages: string[] = [];

      for (const settledResult of settledResults) {
        if (settledResult.status === 'fulfilled') {
          combinedIssues.push(...settledResult.value);
        } else {
          errorMessages.push(settledResult.reason instanceof Error
            ? settledResult.reason.message
            : String(settledResult.reason));
        }
      }

      combinedIssues.sort(sortByOpenedAtDescending);
      setSnowIssues(combinedIssues);

      if (errorMessages.length > 0) {
        setSnowFetchError(`Some SNow record types failed to load: ${errorMessages.join('; ')}`);
      }
    } catch (unexpectedError) {
      setSnowFetchError(
        unexpectedError instanceof Error
          ? unexpectedError.message
          : 'Failed to fetch ServiceNow issues',
      );
    } finally {
      setIsLoadingSnowIssues(false);
    }
  }, []);

  return { snowIssues, isLoadingSnowIssues, snowFetchError, fetchSnowIssues };
}
