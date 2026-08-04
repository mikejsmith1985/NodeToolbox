// githubEmailSharePointPull.ts — Pulls GitHub notification emails from a SharePoint document library
// through the browser relay (the user's own session — no credentials, no app registration) and feeds
// them to the server's GitHub Email Intake pipeline. This replaces the blocked Outlook VBA macro: a
// Power Automate flow drops each email into the library, this pull lists the folder, asks the server
// which files it has not yet ingested, downloads only those, and posts them in size-capped batches.
// Read-only against SharePoint — the server's seen-file ledger (not a file move) prevents re-ingest.

import { fetchRelayStatus, postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';
import type { RelayResult } from '../types/relay.ts';

const RELAY_SYSTEM = 'sharepoint' as const;
/** File types the intake engine can parse from a text download ( .msg is binary and unsupported here). */
const EMAIL_FILE_EXTENSIONS = ['.eml', '.txt'];
/** Upper bound on one folder listing — far above any sane library backlog. */
const LISTING_PAGE_SIZE = 2000;
/** Max files per run POST — mirrors the server's per-batch cap. */
const MAX_SOURCES_PER_BATCH = 20;
/** Max accumulated email text per run POST, kept safely under the server's 1 MB JSON body limit. */
const MAX_BATCH_CONTENT_CHARS = 600_000;

const NOT_CONNECTED_MESSAGE =
  'Connect the SharePoint relay first — open the SharePoint site and click the relay bookmarklet.';

/** One downloaded email ready for ingest. */
export interface SharePointEmailSource {
  fileName: string;
  content: string;
}

/** What a completed pull did, for the panel's summary line. */
export interface SharePointEmailPullSummary {
  /** Email-typed files found in the library folder. */
  listedCount: number;
  /** Files the server had not ingested before this pull. */
  newCount: number;
  postedCount: number;
  skippedCount: number;
  errorCount: number;
  /** Run batches sent to the server (each is one Activity Log entry). */
  batchCount: number;
}

/**
 * Normalizes whatever the user pastes for the library folder — a bare server-relative path, a full
 * URL, or a SharePoint SHARE link (`/:f:/r/...` with encoding and query noise) — to the clean
 * server-relative folder the REST calls need. "Paste the address bar and it just works" (the spec
 * 007 List-URL precedent); a production paste of a share link previously broke the pull outright.
 */
export function normalizeSharePointFolderInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    return '';
  }
  let folderPath = trimmed;
  if (/:\/\//.test(trimmed)) {
    try {
      folderPath = new URL(trimmed).pathname;
    } catch {
      // Not URL-parseable — treat it as a path below.
    }
  }
  // Drop query/fragment noise BEFORE decoding, so an encoded path never resurrects a '?' or '#'.
  folderPath = folderPath.split('?')[0].split('#')[0];
  try {
    folderPath = decodeURIComponent(folderPath);
  } catch {
    // Leave the path as-is if it isn't validly encoded.
  }
  // Share links prefix the real path with a type marker (/:f:/r for folders, /:w:/r for docs…).
  folderPath = folderPath.replace(/^\/:[a-z]:\/[a-z]\//i, '/');
  if (!folderPath.startsWith('/')) {
    folderPath = `/${folderPath}`;
  }
  return folderPath.replace(/\/+$/, '');
}

let relayRequestCounter = 0;

/** A unique-enough id to match a relay request with its result. */
function nextRequestId(): string {
  relayRequestCounter += 1;
  return `ghsp-${Date.now()}-${relayRequestCounter}`;
}

/** The managed-path site root (/sites/x or /teams/x) of a folder URL, for the _api base. '' = root web. */
function siteRootOfFolder(folderServerRelativeUrl: string): string {
  const managedPathMatch = /^\/(sites|teams)\/[^/]+/i.exec(folderServerRelativeUrl);
  return managedPathMatch ? managedPathMatch[0] : '';
}

/** Encodes a server-relative path for use inside a quoted REST parameter ('' doubles OData quotes). */
function encodeRestPathParameter(serverRelativePath: string): string {
  return encodeURIComponent(serverRelativePath.replace(/'/g, "''"));
}

/** Parses the raw relay response text as JSON, with an honest failure message. */
function parseRelayJson<ResponseBody>(result: RelayResult): ResponseBody {
  if (typeof result.data === 'string') {
    try {
      return JSON.parse(result.data) as ResponseBody;
    } catch {
      throw new Error('SharePoint returned an unreadable response.');
    }
  }
  return result.data as ResponseBody;
}

/** Executes one relay request and returns the raw result, throwing on a SharePoint-side failure. */
async function executeRelayRequest(path: string): Promise<RelayResult> {
  const requestId = nextRequestId();
  await postRelayRequest({ sys: RELAY_SYSTEM, id: requestId, method: 'GET', path });
  const result = await waitForRelayResult(requestId, RELAY_SYSTEM);
  if (!result.ok) {
    const detail = typeof result.data === 'string' && result.data.trim() !== ''
      ? ` — ${result.data.slice(0, 300)}`
      : (result.error ? ` — ${result.error}` : '');
    throw new Error(`SharePoint request failed (status ${result.status}) for ${path}${detail}`);
  }
  return result;
}

/** True when the file name carries one of the email extensions the intake can parse. */
function isEmailFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return EMAIL_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

/** Lists the email-typed files in the library folder (oldest first, so ingest follows arrival order). */
async function listFolderEmailFiles(folderServerRelativeUrl: string): Promise<string[]> {
  const siteRoot = siteRootOfFolder(folderServerRelativeUrl);
  const listingPath = `${siteRoot}/_api/web/GetFolderByServerRelativeUrl('${encodeRestPathParameter(folderServerRelativeUrl)}')`
    + `/Files?$select=Name,TimeCreated&$top=${LISTING_PAGE_SIZE}`;
  const result = await executeRelayRequest(listingPath);
  const body = parseRelayJson<{ value?: Array<{ Name?: string; TimeCreated?: string }> }>(result);
  return (body.value ?? [])
    .filter((file) => typeof file.Name === 'string' && isEmailFileName(file.Name))
    .sort((first, second) => String(first.TimeCreated ?? '').localeCompare(String(second.TimeCreated ?? '')))
    .map((file) => file.Name as string);
}

/** Downloads one file's raw text through the relay. */
async function downloadFileText(folderServerRelativeUrl: string, fileName: string): Promise<string> {
  const siteRoot = siteRootOfFolder(folderServerRelativeUrl);
  const filePath = `${folderServerRelativeUrl}/${fileName}`;
  const downloadPath = `${siteRoot}/_api/web/GetFileByServerRelativeUrl('${encodeRestPathParameter(filePath)}')/$value`;
  const result = await executeRelayRequest(downloadPath);
  return typeof result.data === 'string' ? result.data : '';
}

/** Asks the server which of the listed files it has not ingested yet. */
async function fetchNewFileNames(fileNames: string[]): Promise<string[]> {
  const response = await fetch('/api/github-email-intake/sharepoint/filter-new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileNames }),
  });
  const body = await response.json() as { ok: boolean; newFileNames?: string[]; message?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.message ?? 'The server could not check which files are new.');
  }
  return body.newFileNames ?? [];
}

/** Posts one batch of sources for ingest; returns the run's counts. */
async function runSourcesBatch(sources: SharePointEmailSource[]): Promise<{ postedCount: number; skippedCount: number; errorCount: number }> {
  const response = await fetch('/api/github-email-intake/sharepoint/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources }),
  });
  const body = await response.json() as {
    ok: boolean;
    message?: string;
    result?: { postedCount?: number; skippedCount?: number; errorCount?: number };
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.message ?? 'The server could not ingest the downloaded emails.');
  }
  return {
    postedCount: body.result?.postedCount ?? 0,
    skippedCount: body.result?.skippedCount ?? 0,
    errorCount: body.result?.errorCount ?? 0,
  };
}

/**
 * Splits downloaded sources into run batches, capped by file count AND accumulated content size, so
 * each POST stays under the server's JSON body limit. Exported for direct unit testing.
 */
export function batchEmailSources(sources: SharePointEmailSource[]): SharePointEmailSource[][] {
  const batches: SharePointEmailSource[][] = [];
  let currentBatch: SharePointEmailSource[] = [];
  let currentBatchChars = 0;
  for (const source of sources) {
    const wouldOverflow = currentBatch.length >= MAX_SOURCES_PER_BATCH
      || (currentBatch.length > 0 && currentBatchChars + source.content.length > MAX_BATCH_CONTENT_CHARS);
    if (wouldOverflow) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }
    currentBatch.push(source);
    currentBatchChars += source.content.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  return batches;
}

/** The listing+download stage shared by pull and preview: only server-confirmed-new email files. */
async function collectNewSharePointSources(
  folderServerRelativeUrl: string,
  onProgress?: (message: string) => void,
): Promise<{ listedCount: number; sources: SharePointEmailSource[] }> {
  // Accept anything the user pasted — share link, full URL, or bare path — and work on the clean path.
  const normalizedFolderUrl = normalizeSharePointFolderInput(folderServerRelativeUrl);
  const relayStatus = await fetchRelayStatus(RELAY_SYSTEM);
  if (!relayStatus.isConnected) {
    throw new Error(NOT_CONNECTED_MESSAGE);
  }

  onProgress?.('Listing the SharePoint folder…');
  const listedFileNames = await listFolderEmailFiles(normalizedFolderUrl);
  const newFileNames = listedFileNames.length > 0 ? await fetchNewFileNames(listedFileNames) : [];

  const sources: SharePointEmailSource[] = [];
  for (const [index, fileName] of newFileNames.entries()) {
    onProgress?.(`Downloading ${index + 1}/${newFileNames.length}: ${fileName}`);
    sources.push({ fileName, content: await downloadFileText(normalizedFolderUrl, fileName) });
  }
  return { listedCount: listedFileNames.length, sources };
}

/**
 * The whole macro-less pull: verify the relay, list the folder, filter to server-confirmed-new files,
 * download each through the relay, and ingest them batch by batch. Progress messages are surfaced via
 * the optional callback so the panel can narrate a long first pull.
 */
export async function pullSharePointEmails(
  folderServerRelativeUrl: string,
  onProgress?: (message: string) => void,
): Promise<SharePointEmailPullSummary> {
  const { listedCount, sources } = await collectNewSharePointSources(folderServerRelativeUrl, onProgress);

  const summary: SharePointEmailPullSummary = {
    listedCount,
    newCount: sources.length,
    postedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    batchCount: 0,
  };
  if (sources.length === 0) {
    return summary;
  }

  const batches = batchEmailSources(sources);
  for (const [index, batch] of batches.entries()) {
    onProgress?.(`Ingesting batch ${index + 1}/${batches.length} (${batch.length} email(s))…`);
    const runCounts = await runSourcesBatch(batch);
    summary.postedCount += runCounts.postedCount;
    summary.skippedCount += runCounts.skippedCount;
    summary.errorCount += runCounts.errorCount;
    summary.batchCount += 1;
  }
  return summary;
}

/** One preview event as the server's dry run reports it (mirrors the intake run event shape). */
export interface SharePointPreviewEvent {
  fileName: string;
  outcome: string;
  eventType?: string;
  jiraKey?: string | null;
  reason?: string;
  message?: string;
}

/** What a completed preview found: folder totals plus the merged dry-run result (null = nothing new). */
export interface SharePointEmailPreviewOutcome {
  listedCount: number;
  newCount: number;
  result: {
    hasRun: boolean;
    mode: string;
    trigger: string;
    postedCount: number;
    skippedCount: number;
    errorCount: number;
    events: SharePointPreviewEvent[];
  } | null;
}

/** Posts one batch to the persist-nothing preview endpoint and returns its dry-run result. */
async function previewSourcesBatch(sources: SharePointEmailSource[]): Promise<{ skippedCount: number; errorCount: number; events: SharePointPreviewEvent[] }> {
  const response = await fetch('/api/github-email-intake/sharepoint/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources }),
  });
  const body = await response.json() as {
    ok: boolean;
    message?: string;
    result?: { skippedCount?: number; errorCount?: number; events?: SharePointPreviewEvent[] };
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.message ?? 'The server could not preview the downloaded emails.');
  }
  return {
    skippedCount: body.result?.skippedCount ?? 0,
    errorCount: body.result?.errorCount ?? 0,
    events: body.result?.events ?? [],
  };
}

/**
 * Previews the SharePoint source: downloads the new files exactly like a pull, but dry-run parses
 * them through a persist-nothing endpoint — no Jira writes, no dedup ledger, no seen-file recording,
 * no Activity Log entry — so the same files still ingest on the next real pull.
 */
export async function previewSharePointEmails(
  folderServerRelativeUrl: string,
  onProgress?: (message: string) => void,
): Promise<SharePointEmailPreviewOutcome> {
  const { listedCount, sources } = await collectNewSharePointSources(folderServerRelativeUrl, onProgress);
  if (sources.length === 0) {
    return { listedCount, newCount: 0, result: null };
  }

  const mergedResult = {
    hasRun: true,
    mode: 'dryRun',
    trigger: 'sharepoint-preview',
    postedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    events: [] as SharePointPreviewEvent[],
  };
  const batches = batchEmailSources(sources);
  for (const [index, batch] of batches.entries()) {
    onProgress?.(`Previewing batch ${index + 1}/${batches.length} (${batch.length} email(s))…`);
    const batchResult = await previewSourcesBatch(batch);
    mergedResult.skippedCount += batchResult.skippedCount;
    mergedResult.errorCount += batchResult.errorCount;
    mergedResult.events.push(...batchResult.events);
  }
  return { listedCount, newCount: sources.length, result: mergedResult };
}
