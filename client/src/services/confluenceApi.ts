// confluenceApi.ts — Typed Confluence REST client routed through the Express Confluence proxy.

const CONFLUENCE_PROXY_BASE = '/confluence-proxy';
const CONFLUENCE_V2_BASE = `${CONFLUENCE_PROXY_BASE}/wiki/api/v2`;
const JSON_CONTENT_TYPE = 'application/json';
const PAGE_EXPAND_QUERY = 'body.storage,version';
const CONFLUENCE_PAGE_ID_PATTERN = /^\d+$/;
const DNS_LOOKUP_FAILURE_PATTERN = /\b(?:getaddrinfo\s+)?ENOTFOUND\b/i;
const SHARED_ART_WORKSPACE_SCHEMA_VERSION = 1;
export const SHARED_ART_DATABASE_PROPERTY_KEY = 'nodetoolbox-shared-art';

export interface ConfluencePageVersion {
  number: number;
}

export interface ConfluencePageStorageBody {
  value: string;
  representation: string;
}

export interface ConfluencePage {
  id: string;
  type: string;
  title: string;
  version: ConfluencePageVersion;
  body: {
    storage: ConfluencePageStorageBody;
  };
}

export interface ConfluenceDatabase {
  id: string;
  type: string;
  title: string;
  spaceId: string;
  parentId?: string;
  version?: ConfluencePageVersion;
}

export interface ConfluenceContentPropertyVersion {
  number: number;
}

export interface ConfluenceContentProperty<TValue> {
  id: string;
  key: string;
  value: TValue;
  version: ConfluenceContentPropertyVersion;
}

export interface SharedArtWorkspaceTeamRecord {
  id: string;
  name: string;
  boardId: string;
  boardName?: string;
  projectKey?: string;
  piReviewPageUrl?: string;
  sosIssueKey?: string;
}

export interface SharedArtWorkspaceSettingsRecord {
  piFieldId?: string;
  spFieldId?: string;
  isSpAutoDetect?: boolean;
  featureLinkField?: string;
  pCodeField?: string;
  depLinkTypes?: string[];
  staleDays?: number;
  piEndDate?: string;
  sprintWindowDays?: number;
  piReviewPageUrl?: string;
}

export interface SharedArtWorkspacePayload {
  schemaVersion: number;
  artKey: string;
  artName: string;
  updatedAt: string;
  teams: SharedArtWorkspaceTeamRecord[];
  settings: SharedArtWorkspaceSettingsRecord;
}

export interface UpdateConfluencePageInput {
  pageId: string;
  pageTitle: string;
  storageValue: string;
  nextVersionNumber: number;
}

export interface CreateConfluenceDatabaseInput {
  spaceId: string;
  title: string;
  parentId?: string;
}

interface ConfluenceContentPropertySummary {
  id: string;
  key: string;
  version: ConfluenceContentPropertyVersion;
}

interface ConfluenceMultiEntityResult<TResult> {
  results?: TResult[];
}

function formatConfluenceErrorDetail(errorDetail: string): string {
  if (!DNS_LOOKUP_FAILURE_PATTERN.test(errorDetail)) {
    return errorDetail;
  }

  return `Could not resolve the configured Confluence host. Check the Confluence base URL, VPN/DNS access, and Atlassian tenant name. Original error: ${errorDetail}`;
}

/** Throws a descriptive error when Confluence returns a non-success response. */
async function assertSuccessfulResponse(response: Response, messagePrefix: string): Promise<void> {
  if (!response.ok) {
    let errorDetail = String(response.status);
    try {
      const errorBody = await response.json() as { message?: string; reason?: string };
      errorDetail = errorBody.message ?? errorBody.reason ?? errorDetail;
    } catch {
      // The HTTP status is still enough to surface the failure meaningfully.
    }

    throw new Error(`${messagePrefix}: ${formatConfluenceErrorDetail(errorDetail)}`);
  }
}

/** Fetches JSON from Confluence and surfaces a descriptive message when the request fails. */
async function fetchConfluenceJson<TResult>(
  requestPath: string,
  messagePrefix: string,
  init?: RequestInit,
): Promise<TResult> {
  const response = await fetch(requestPath, init);
  await assertSuccessfulResponse(response, messagePrefix);
  return response.json() as Promise<TResult>;
}

/** Loads a Confluence page's storage body and version metadata through the authenticated proxy. */
export async function fetchConfluencePage(pageId: string): Promise<ConfluencePage> {
  return fetchConfluenceJson<ConfluencePage>(
    `${CONFLUENCE_PROXY_BASE}/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent(PAGE_EXPAND_QUERY)}`,
    `Confluence GET page ${pageId} failed`,
  );
}

/**
 * Resolves a Confluence content ID from either a raw numeric page ID or a full page URL.
 * This lets users paste the browser URL directly instead of manually extracting the content ID.
 */
export function resolveConfluencePageIdFromReference(pageReference: string): string | null {
  const trimmedReference = pageReference.trim();
  if (trimmedReference === '') {
    return null;
  }

  if (CONFLUENCE_PAGE_ID_PATTERN.test(trimmedReference)) {
    return trimmedReference;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedReference);
  } catch {
    return null;
  }

  const pageIdFromQuery = parsedUrl.searchParams.get('pageId')?.trim();
  if (pageIdFromQuery && CONFLUENCE_PAGE_ID_PATTERN.test(pageIdFromQuery)) {
    return pageIdFromQuery;
  }

  const pagePathMatch = parsedUrl.pathname.match(/\/pages\/(\d+)(?:\/|$)/i);
  if (pagePathMatch) {
    return pagePathMatch[1];
  }

  return null;
}

/** Resolves a Confluence page reference and then loads the page through the authenticated proxy. */
export async function fetchConfluencePageByReference(pageReference: string): Promise<ConfluencePage> {
  const resolvedPageId = resolveConfluencePageIdFromReference(pageReference);
  if (!resolvedPageId) {
    throw new Error(
      'Confluence page URL or ID is invalid. Paste the full Confluence page URL or the numeric page ID.',
    );
  }

  return fetchConfluencePage(resolvedPageId);
}

/**
 * Writes a new storage body to an existing Confluence page.
 * Confluence requires the next page version number on every update to avoid overwriting newer edits.
 */
export async function updateConfluencePage({
  pageId,
  pageTitle,
  storageValue,
  nextVersionNumber,
}: UpdateConfluencePageInput): Promise<ConfluencePage> {
  return fetchConfluenceJson<ConfluencePage>(
    `${CONFLUENCE_PROXY_BASE}/wiki/rest/api/content/${encodeURIComponent(pageId)}`,
    `Confluence PUT page ${pageId} failed`,
    {
      method: 'PUT',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify({
        id: pageId,
        type: 'page',
        title: pageTitle,
        version: { number: nextVersionNumber },
        body: {
          storage: {
            value: storageValue,
            representation: 'storage',
          },
        },
      }),
    },
  );
}

/** Creates a Confluence Database shell that NodeToolbox can use as a shared ART anchor. */
export async function createConfluenceDatabase({
  spaceId,
  title,
  parentId,
}: CreateConfluenceDatabaseInput): Promise<ConfluenceDatabase> {
  return fetchConfluenceJson<ConfluenceDatabase>(
    `${CONFLUENCE_V2_BASE}/databases`,
    'Confluence POST database failed',
    {
      method: 'POST',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify({
        spaceId,
        title,
        ...(parentId ? { parentId } : {}),
      }),
    },
  );
}

/** Loads a specific Confluence Database record by ID. */
export async function fetchConfluenceDatabase(databaseId: string): Promise<ConfluenceDatabase> {
  return fetchConfluenceJson<ConfluenceDatabase>(
    `${CONFLUENCE_V2_BASE}/databases/${encodeURIComponent(databaseId)}`,
    `Confluence GET database ${databaseId} failed`,
  );
}

/** Looks up a content property by key on a Confluence Database. */
export async function fetchConfluenceDatabasePropertyByKey<TValue>(
  databaseId: string,
  propertyKey: string,
): Promise<ConfluenceContentProperty<TValue> | null> {
  const propertyList = await fetchConfluenceJson<ConfluenceMultiEntityResult<ConfluenceContentPropertySummary>>(
    `${CONFLUENCE_V2_BASE}/databases/${encodeURIComponent(databaseId)}/properties?key=${encodeURIComponent(propertyKey)}`,
    `Confluence GET database properties ${databaseId} failed`,
  );
  const matchingProperty = propertyList.results?.find((property) => property.key === propertyKey);
  if (!matchingProperty) {
    return null;
  }

  return fetchConfluenceJson<ConfluenceContentProperty<TValue>>(
    `${CONFLUENCE_V2_BASE}/databases/${encodeURIComponent(databaseId)}/properties/${encodeURIComponent(matchingProperty.id)}`,
    `Confluence GET database property ${databaseId}/${matchingProperty.id} failed`,
  );
}

/** Creates or updates a content property on a Confluence Database. */
export async function upsertConfluenceDatabaseProperty<TValue>(
  databaseId: string,
  propertyKey: string,
  propertyValue: TValue,
): Promise<ConfluenceContentProperty<TValue>> {
  const existingProperty = await fetchConfluenceDatabasePropertyByKey<TValue>(databaseId, propertyKey);

  if (!existingProperty) {
    return fetchConfluenceJson<ConfluenceContentProperty<TValue>>(
      `${CONFLUENCE_V2_BASE}/databases/${encodeURIComponent(databaseId)}/properties`,
      `Confluence POST database property ${databaseId}/${propertyKey} failed`,
      {
        method: 'POST',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify({
          key: propertyKey,
          value: propertyValue,
        }),
      },
    );
  }

  return fetchConfluenceJson<ConfluenceContentProperty<TValue>>(
    `${CONFLUENCE_V2_BASE}/databases/${encodeURIComponent(databaseId)}/properties/${encodeURIComponent(existingProperty.id)}`,
    `Confluence PUT database property ${databaseId}/${propertyKey} failed`,
    {
      method: 'PUT',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify({
        key: propertyKey,
        value: propertyValue,
        version: { number: existingProperty.version.number + 1 },
      }),
    },
  );
}

/** Loads the NodeToolbox shared ART payload stored on a Confluence Database. */
export async function loadSharedArtWorkspace(databaseId: string): Promise<SharedArtWorkspacePayload> {
  const sharedWorkspaceProperty = await fetchConfluenceDatabasePropertyByKey<SharedArtWorkspacePayload>(
    databaseId,
    SHARED_ART_DATABASE_PROPERTY_KEY,
  );
  if (!sharedWorkspaceProperty) {
    throw new Error('This Confluence database does not contain a NodeToolbox shared ART workspace yet.');
  }

  if (sharedWorkspaceProperty.value.schemaVersion !== SHARED_ART_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported shared ART schema version ${sharedWorkspaceProperty.value.schemaVersion}.`,
    );
  }

  return sharedWorkspaceProperty.value;
}

/** Saves the NodeToolbox shared ART payload onto a Confluence Database content property. */
export async function saveSharedArtWorkspace(
  databaseId: string,
  payload: SharedArtWorkspacePayload,
): Promise<ConfluenceContentProperty<SharedArtWorkspacePayload>> {
  return upsertConfluenceDatabaseProperty(
    databaseId,
    SHARED_ART_DATABASE_PROPERTY_KEY,
    {
      ...payload,
      schemaVersion: SHARED_ART_WORKSPACE_SCHEMA_VERSION,
    },
  );
}
