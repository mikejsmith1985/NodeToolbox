// evidenceAttachmentFetch.ts — Reading a release's Jira attachments: first the list, then the bytes.
//
// Two separate steps on purpose. The list is one cheap search that tells the operator what the
// bundle WOULD contain and how big it is; the bytes are fetched only once they choose to build it.
// Mirrors cabScopeFetch: one search for the whole key list, and the keys Jira did not return are
// reported rather than silently dropped.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { EvidenceAttachment, EvidenceIssue } from './evidenceBundle.ts';

/** Every request for attachment bytes goes through the local Jira proxy, which holds the credentials. */
const JIRA_PROXY_BASE = '/jira-proxy';
/** The two fields this needs: what the issue is, and what is attached to it. */
const RELEASE_ATTACHMENT_FIELDS = ['summary', 'attachment'];
/** A base only used to parse a path-only content value; its host is never sent anywhere. */
const PATH_PARSE_BASE = 'http://placeholder.invalid';

/** One attachment record as Jira returns it. Loose because Data Center and Cloud disagree on details. */
interface JiraAttachmentRecord {
  id?: string | number;
  filename?: string;
  size?: number | string;
  mimeType?: string;
  created?: string;
  author?: { displayName?: string } | null;
  content?: string;
}

/** How Jira answers the release search. */
interface ReleaseSearchResponse {
  issues?: Array<{
    key: string;
    fields?: {
      summary?: string;
      attachment?: JiraAttachmentRecord[];
    };
  }>;
}

/** What the release search produced, and which keys it could not find. */
export interface ReleaseAttachmentOutcome {
  issues: EvidenceIssue[];
  missingKeys: string[];
}

/** Escapes a key for a quoted JQL list entry. */
function escapeKeyForJql(issueKey: string): string {
  return issueKey.replace(/"/g, '');
}

/** Shapes one Jira attachment record into the planner's input, tolerating absent fields. */
function toEvidenceAttachment(jiraAttachment: JiraAttachmentRecord): EvidenceAttachment {
  const authorName = jiraAttachment.author?.displayName;
  return {
    attachmentId: String(jiraAttachment.id ?? ''),
    filename: jiraAttachment.filename ?? 'attachment',
    sizeBytes: Number(jiraAttachment.size ?? 0) || 0,
    mimeType: jiraAttachment.mimeType,
    created: jiraAttachment.created,
    authorName: authorName === undefined || authorName === '' ? undefined : authorName,
    contentUrl: jiraAttachment.content ?? '',
  };
}

/**
 * Loads the attachment list of every named issue, in one search.
 *
 * An empty key list costs no request and returns an empty outcome — `key in ()` is a JQL syntax
 * error, not an empty answer.
 */
export async function loadReleaseAttachments(issueKeys: readonly string[]): Promise<ReleaseAttachmentOutcome> {
  if (issueKeys.length === 0) {
    return { issues: [], missingKeys: [] };
  }

  const jql = `key in (${issueKeys.map((issueKey) => `"${escapeKeyForJql(issueKey)}"`).join(',')})`;
  const response = await jiraGet<ReleaseSearchResponse>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
    + `&fields=${RELEASE_ATTACHMENT_FIELDS.join(',')}&maxResults=${issueKeys.length}`,
  );

  const issues: EvidenceIssue[] = (response.issues ?? []).map((jiraIssue) => ({
    key: jiraIssue.key,
    summary: jiraIssue.fields?.summary ?? '',
    attachments: (jiraIssue.fields?.attachment ?? []).map(toEvidenceAttachment),
  }));

  const returnedKeys = new Set(issues.map((evidenceIssue) => evidenceIssue.key));
  const missingKeys = issueKeys.filter((issueKey) => !returnedKeys.has(issueKey));

  return { issues, missingKeys };
}

/**
 * Turns Jira's absolute attachment URL into a path on the local Jira proxy.
 *
 * Only the path and query survive: the proxy owns the base URL and the credentials, and a Data
 * Center instance sometimes advertises attachments on a hostname the proxy is not configured for.
 */
export function buildAttachmentProxyPath(contentUrl: string): string {
  const parsedUrl = new URL(contentUrl, PATH_PARSE_BASE);
  return `${JIRA_PROXY_BASE}${parsedUrl.pathname}${parsedUrl.search}`;
}

/**
 * Fetches one attachment's bytes through the proxy.
 *
 * A non-OK response is an error, never content: zipping a Jira login page under the name of a
 * test report would be evidence of nothing and look like evidence of something.
 */
export async function downloadAttachmentBytes(contentUrl: string): Promise<Uint8Array> {
  const proxyPath = buildAttachmentProxyPath(contentUrl);
  const response = await fetch(proxyPath);
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status}) for ${proxyPath}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
