// useCheckInIssues.ts — Fetching one person's plate, with the fields a status conversation needs.
//
// My Issues already knows WHO — the persona picker settles that, and this reads the same subject the
// rest of the tool does. What it does not have is the detail: the existing report fetch asks for
// nine fields, and a check-in needs the due date, the comment thread, the Feature link and Jira's own
// record of when each item last changed stage.
//
// So this is its own fetch rather than a widening of that one. Adding a comment thread to the field
// list of a tab that renders a list would slow every other tab down for a detail none of them show.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { buildAssigneeJql, type ReportSubject } from '../myIssuesRoleLens.ts';
import {
  featureLinkCandidateFieldIds,
  loadConfiguredFeatureLinkFieldId,
} from '../../../utils/featureLink.ts';
import { resolveStoryPointsFieldIds } from '../../Hygiene/checks/storyPointsField.ts';
import { buildCheckInIssue, sortByConversationUrgency, type CheckInIssue } from './checkInModel.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** Open work only, newest activity first. A check-in is about what is live, not what shipped. */
const CHECK_IN_JQL_SUFFIX = ' AND statusCategory != Done ORDER BY updated DESC';

/**
 * Builds the JQL a check-in runs, from either a person or an arbitrary query.
 *
 * The tab was built around "whose work?", which answers most check-ins and not all of them. "Every
 * defect in this project, whoever holds it" is a real question with no single assignee, and so is any
 * hand-picked set somebody wants summarised. A custom query answers those without needing a second
 * surface that does the same job.
 *
 * The custom clause is bracketed so an OR inside it cannot escape the open-work filter — without it,
 * `a OR b AND statusCategory != Done` returns every issue matching a, closed ones included.
 */
export function buildCheckInJql(assigneeClause: string, customJql: string): string {
  const trimmedCustom = customJql.trim();
  return trimmedCustom === ''
    ? `${assigneeClause}${CHECK_IN_JQL_SUFFIX}`
    : `(${trimmedCustom})${CHECK_IN_JQL_SUFFIX}`;
}

/** More than one person can hold and still have a conversation about. */
const MAX_CHECK_IN_ISSUES = 60;

/** The fields the conversation reads, beyond the configurable ones resolved at call time. */
const CHECK_IN_BASE_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee',
  'updated', 'duedate', 'statuscategorychangedate', 'description', 'comment', 'parent',
];

/** What the tab needs to render: the plate, whether it is loading, and any failure to say plainly. */
export interface CheckInIssuesState {
  issues: CheckInIssue[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/** The Feature summaries behind a set of keys, so a check-in can name an outcome not a key. */
async function loadFeatureSummaries(featureKeys: readonly string[]): Promise<Map<string, string>> {
  if (featureKeys.length === 0) {
    return new Map<string, string>();
  }
  try {
    const keyList = featureKeys.map((featureKey) => `"${featureKey.replace(/"/g, '\\"')}"`).join(',');
    const response = await jiraGet<{ issues?: JiraIssue[] }>(
      `/rest/api/2/search?jql=${encodeURIComponent(`key in (${keyList})`)}`
        + `&maxResults=${featureKeys.length}&fields=summary`,
    );
    return new Map((response.issues ?? []).map((issue) => [issue.key, issue.fields.summary ?? '']));
  } catch {
    // A failed lookup costs the Feature's wording, never the check-in. The keys are already known.
    return new Map<string, string>();
  }
}

/**
 * Loads the assigned, still-open work for whoever the persona picker is pointed at.
 *
 * Story-point and Feature-link field ids are resolved rather than named, so this works on a Jira whose
 * ids differ from ours.
 */
export function useCheckInIssues(
  subject: ReportSubject,
  memberIdentifiers: readonly string[],
  /** The Dashboard's configured story-point field, when there is one. Empty falls back to the
   *  resolver's own defaults, which is the right answer on a Jira that uses them. */
  storyPointsFieldId = '',
  /**
   * A query to use INSTEAD of the person. Empty means check in on whoever the picker holds.
   *
   * Replaces rather than narrows: "every defect in the project" is not a subset of one person's work,
   * and anding the two would silently return nothing whenever they did not overlap.
   */
  customJql = '',
): CheckInIssuesState {
  const [issues, setIssues] = useState<CheckInIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const reload = useCallback(() => setReloadCount((previousCount) => previousCount + 1), []);

  // WHO is being asked about, reduced to plain strings before the effect ever sees it.
  //
  // This is load-bearing, not tidiness. A caller rendering `memberIdentifiers={[]}` inline hands over a
  // NEW array on every render; an effect depending on that array re-runs on every render, and each run
  // sets state, which renders again — a fetch loop that would hammer Jira for as long as the tab is open.
  const subjectKind = subject.kind;
  const subjectAccountId = subject.kind === 'user' ? subject.accountId : '';
  const subjectTeamName = subject.kind === 'team' ? subject.teamName : '';
  const memberSignature = memberIdentifiers.join(',');

  // Rebuilt from those strings rather than closing over `subject`, so the dependency list is honestly
  // complete. The quoting and escaping still belong to buildAssigneeJql, which is the only place that
  // knows how a JQL assignee clause is written.
  const assigneeClause = useMemo(() => {
    if (subjectKind === 'user') {
      return buildAssigneeJql({ kind: 'user', accountId: subjectAccountId, displayName: '' });
    }
    if (subjectKind === 'team') {
      return buildAssigneeJql(
        { kind: 'team', teamName: subjectTeamName },
        memberSignature === '' ? [] : memberSignature.split(','),
      );
    }
    return buildAssigneeJql({ kind: 'viewer' });
  }, [subjectKind, subjectAccountId, subjectTeamName, memberSignature]);

  useEffect(() => {
    let isMounted = true;

    async function loadCheckInIssues(): Promise<void> {
      setIsLoading(true);
      setError(null);

      const featureLinkFieldId = loadConfiguredFeatureLinkFieldId();
      const resolvedStoryPointsFieldIds = resolveStoryPointsFieldIds(storyPointsFieldId);
      const requestedFields = [
        ...CHECK_IN_BASE_FIELDS,
        ...resolvedStoryPointsFieldIds,
        ...featureLinkCandidateFieldIds(featureLinkFieldId),
      ].join(',');

      try {
        const jql = buildCheckInJql(assigneeClause, customJql);
        const response = await jiraGet<{ issues?: JiraIssue[] }>(
          `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
            + `&maxResults=${MAX_CHECK_IN_ISSUES}&fields=${requestedFields}`,
        );
        const fetchedIssues = response.issues ?? [];

        // The Feature summaries come from a second request so a check-in can talk about the outcome
        // rather than reading a key aloud.
        const nowMs = Date.now();
        const provisionalIssues = fetchedIssues.map((issue) => buildCheckInIssue(issue, {
          nowMs,
          storyPointsFieldId: resolvedStoryPointsFieldIds[0] ?? storyPointsFieldId,
          featureLinkFieldId,
          featureSummaryByKey: new Map<string, string>(),
        }));
        const featureKeys = [...new Set(
          provisionalIssues
            .map((checkInIssue) => checkInIssue.featureKey)
            .filter((featureKey): featureKey is string => featureKey !== null),
        )];
        const featureSummaryByKey = await loadFeatureSummaries(featureKeys);

        if (!isMounted) {
          return;
        }
        setIssues(sortByConversationUrgency(provisionalIssues.map((checkInIssue) => ({
          ...checkInIssue,
          featureSummary: checkInIssue.featureKey === null
            ? null
            : featureSummaryByKey.get(checkInIssue.featureKey) ?? null,
        }))));
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        setIssues([]);
        setError(caughtError instanceof Error ? caughtError.message : 'Could not load the assigned work.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCheckInIssues();

    return () => {
      isMounted = false;
    };
  }, [assigneeClause, customJql, storyPointsFieldId, reloadCount]);

  return { issues, isLoading, error, reload };
}
