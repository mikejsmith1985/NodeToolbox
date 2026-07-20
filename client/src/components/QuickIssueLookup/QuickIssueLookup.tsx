// QuickIssueLookup.tsx — The lookup popup body: search, honest states, and the reused detail view.
//
// Owns the current lookup key and drives useIssueByKey. On success it renders the shared
// IssueDetailPanel (read-only in this story) plus a Jira deep-link on the issue key so a user who
// prefers Jira can leave in one click; otherwise it shows a specific, honest state (loading / not
// found / no access / error).

import { useEffect, useState } from 'react';

import IssueDetailPanel from '../IssueDetailPanel/index.tsx';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { useIssueByKey, type IssueLookupStatus } from '../../hooks/useIssueByKey.ts';
import { buildJiraBrowseUrl } from '../../utils/jiraBrowseUrl.ts';
import { fetchFeatureReviewEditMeta } from '../../views/SprintDashboard/featureReviewFixes.ts';
import type { IssueEditMeta } from '../IssueFieldEditors/issueFieldEditing.ts';
import { IssueSearchBar } from './IssueSearchBar.tsx';
import styles from './QuickIssueLookup.module.css';

const LOADING_LABEL = 'Loading issue…';
const OPEN_IN_JIRA_TITLE = 'Open this issue in Jira';
const GENERIC_ERROR_LABEL = 'Something went wrong loading this issue.';

export interface QuickIssueLookupProps {
  /** Ref for the search input so the gate can focus it on open / on F2-while-open. */
  inputRef?: React.Ref<HTMLInputElement>;
}

/** True for the states that render a single honest message line (as opposed to a spinner or panel). */
function isMessageState(status: IssueLookupStatus): boolean {
  return status === 'not-found' || status === 'no-permission' || status === 'error';
}

/** Builds the honest, human-readable message for a non-loaded lookup status. */
function describeLookupState(
  status: IssueLookupStatus,
  lookupKey: string | null,
  errorMessage: string | null,
): string {
  if (status === 'not-found') {
    return `No issue found for ${lookupKey}.`;
  }
  if (status === 'no-permission') {
    return `You don't have access to ${lookupKey}.`;
  }
  return errorMessage ?? GENERIC_ERROR_LABEL;
}

/** Renders the popup body: the search bar plus whichever lookup state currently applies. */
export function QuickIssueLookup({ inputRef }: QuickIssueLookupProps): React.JSX.Element {
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const { issue, status, errorMessage, refetch } = useIssueByKey(lookupKey);
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);

  // Load the issue's edit metadata once it is on screen; it tells the panel which fields are safely
  // editable. Kept tagged with the issue key so a stale fetch never enables editing for another issue.
  const [loadedEditMeta, setLoadedEditMeta] = useState<{ key: string; meta: IssueEditMeta } | null>(null);
  useEffect(() => {
    if (status !== 'loaded' || issue === null) {
      return;
    }
    let isCancelled = false;
    fetchFeatureReviewEditMeta(issue.key)
      .then((meta) => { if (!isCancelled) setLoadedEditMeta({ key: issue.key, meta }); })
      .catch(() => { if (!isCancelled) setLoadedEditMeta({ key: issue.key, meta: {} }); });
    return () => { isCancelled = true; };
  }, [status, issue]);

  const activeEditMeta =
    status === 'loaded' && issue !== null && loadedEditMeta?.key === issue.key ? loadedEditMeta.meta : null;

  return (
    <div className={styles.body}>
      <IssueSearchBar inputRef={inputRef} onSearch={setLookupKey} />

      {status === 'loading' ? (
        <p className={styles.state} role="status">{LOADING_LABEL}</p>
      ) : null}

      {isMessageState(status) ? (
        <p className={styles.state} role="alert">
          {describeLookupState(status, lookupKey, errorMessage)}
        </p>
      ) : null}

      {status === 'loaded' && issue ? (
        <div className={styles.detail}>
          <a
            className={styles.jiraLink}
            href={buildJiraBrowseUrl(issue.key, jiraBaseUrl ?? '')}
            rel="noreferrer"
            target="_blank"
            title={OPEN_IN_JIRA_TITLE}
          >
            {issue.key} ↗
          </a>
          <IssueDetailPanel
            issue={issue}
            isEmbedded
            onIssueUpdated={refetch}
            fieldEditing={activeEditMeta ? { editMeta: activeEditMeta, onFieldSaved: refetch } : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
