// confluenceApi.ts — Typed Confluence REST client routed through the Express Confluence proxy.

import type { JiraTemplate, JiraTemplateStore } from '../views/JiraTemplateMaker/lib/templateTypes.ts';
import { JIRA_TEMPLATE_STORE_SCHEMA_VERSION } from '../views/JiraTemplateMaker/lib/templateTypes.ts';

const CONFLUENCE_PROXY_BASE = '/confluence-proxy';
const CONFLUENCE_V2_BASE = `${CONFLUENCE_PROXY_BASE}/wiki/api/v2`;
const JSON_CONTENT_TYPE = 'application/json';
const PAGE_EXPAND_QUERY = 'body.storage,version';
const CONFLUENCE_PAGE_ID_PATTERN = /^\d+$/;
const DNS_LOOKUP_FAILURE_PATTERN = /\b(?:getaddrinfo\s+)?ENOTFOUND\b/i;
// Bumped to 2 when team records gained the multi-PI `piReviewPages` list (legacy `piReviewPageUrl`
// is still read on import so workspaces synced by older clients keep loading).
const SHARED_ART_WORKSPACE_SCHEMA_VERSION = 2;
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

/** One PI ↔ Confluence page association carried in a shared ART workspace team record. */
export interface SharedArtWorkspacePiReviewPage {
  piName: string;
  pageUrl: string;
}

export interface SharedArtWorkspaceTeamRecord {
  id: string;
  name: string;
  boardId: string;
  boardName?: string;
  projectKey?: string;
  /** Multi-PI page list (schema v2+). */
  piReviewPages?: SharedArtWorkspacePiReviewPage[];
  /** Legacy single-page field (schema v1) — still read on import for back-compat. */
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

/**
 * A failed Confluence request, carrying enough to tell the four failure modes apart.
 *
 * The message alone cannot distinguish "the page does not exist" from "you may not see it" from
 * "Confluence is unreachable" — but a caller must be able to say which, because the actions a user
 * takes are completely different (fix the link / request access / connect to the VPN). It stays a
 * plain Error so existing callers that only render `.message` are unaffected.
 */
export class ConfluenceRequestError extends Error {
  /** The upstream HTTP status: 404 missing, 401/403 no permission, 502 the proxy could not reach Confluence. */
  readonly status: number;

  /**
   * The proxy's own error code, present only when the proxy (not Confluence) rejected the request.
   * This is what separates "Confluence not configured" from a network failure — both surface as 502.
   */
  readonly proxyErrorCode?: string;

  constructor(message: string, status: number, proxyErrorCode?: string) {
    super(message);
    this.name = 'ConfluenceRequestError';
    this.status = status;
    this.proxyErrorCode = proxyErrorCode;
  }
}

/** Throws a descriptive error when Confluence returns a non-success response. */
async function assertSuccessfulResponse(response: Response, messagePrefix: string): Promise<void> {
  if (!response.ok) {
    let errorDetail = String(response.status);
    let proxyErrorCode: string | undefined;
    try {
      const errorBody = await response.json() as { message?: string; reason?: string; error?: string };
      errorDetail = errorBody.message ?? errorBody.reason ?? errorDetail;
      proxyErrorCode = errorBody.error;
    } catch {
      // The HTTP status is still enough to surface the failure meaningfully.
    }

    throw new ConfluenceRequestError(
      `${messagePrefix}: ${formatConfluenceErrorDetail(errorDetail)}`,
      response.status,
      proxyErrorCode,
    );
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

  // Accept any schema at or below the current version; older payloads (e.g. v1's single
  // piReviewPageUrl) are migrated into the multi-PI shape downstream by team normalization.
  const loadedSchemaVersion = sharedWorkspaceProperty.value.schemaVersion;
  if (loadedSchemaVersion < 1 || loadedSchemaVersion > SHARED_ART_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`Unsupported shared ART schema version ${loadedSchemaVersion}.`);
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

// ── Jira Template Maker shared store ──
// Templates persist as one JSON document under their own content-property key on the same
// shared database used by the ART workspace, kept independent so the ART schema is untouched.

/** Content-property key holding the globally-shared Jira template library. */
export const JIRA_TEMPLATES_PROPERTY_KEY = 'nodetoolbox-jira-templates';

/**
 * Loads the shared Jira template library. Unlike the ART workspace, an absent property is the
 * normal first-run state and yields an empty store rather than an error; an unrecognized
 * schema version is rejected so we never mis-parse a future format.
 */
export async function loadJiraTemplates(databaseId: string): Promise<JiraTemplateStore> {
  const templateProperty = await fetchConfluenceDatabasePropertyByKey<JiraTemplateStore>(
    databaseId,
    JIRA_TEMPLATES_PROPERTY_KEY,
  );
  if (!templateProperty) {
    return { schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION, updatedAt: '', templates: [] };
  }
  if (templateProperty.value.schemaVersion !== JIRA_TEMPLATE_STORE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Jira template store schema version ${templateProperty.value.schemaVersion}.`);
  }
  return templateProperty.value;
}

/** Persists the template library, stamping the current schema version and save time. */
export async function saveJiraTemplates(
  databaseId: string,
  store: JiraTemplateStore,
): Promise<JiraTemplateStore> {
  const stampedStore: JiraTemplateStore = {
    ...store,
    schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await upsertConfluenceDatabaseProperty(databaseId, JIRA_TEMPLATES_PROPERTY_KEY, stampedStore);
  return stampedStore;
}

/** Compares two templates ignoring their save timestamp (so a re-save isn't seen as an edit). */
function areTemplatesEquivalent(left: JiraTemplate, right: JiraTemplate): boolean {
  const withoutTimestamp = (template: JiraTemplate): JiraTemplate => ({ ...template, updatedAt: '' });
  return JSON.stringify(withoutTimestamp(left)) === JSON.stringify(withoutTimestamp(right));
}

/**
 * Three-way merges the template library so concurrent editors don't silently overwrite each
 * other. Compares the local working copy and the freshly-fetched remote copy against the base
 * snapshot taken at load. Edits to different templates both survive; edits to the same template
 * on both sides surface as a conflict (by template id) instead of last-writer-win.
 */
export function mergeJiraTemplateStores(
  base: JiraTemplateStore,
  remote: JiraTemplateStore,
  working: JiraTemplateStore,
): { merged: JiraTemplateStore; conflicts: string[] } {
  const baseById = new Map(base.templates.map((template) => [template.id, template]));
  const remoteById = new Map(remote.templates.map((template) => [template.id, template]));
  const workingById = new Map(working.templates.map((template) => [template.id, template]));
  const allTemplateIds = new Set([...baseById.keys(), ...remoteById.keys(), ...workingById.keys()]);

  const mergedTemplates: JiraTemplate[] = [];
  const conflicts: string[] = [];

  for (const templateId of allTemplateIds) {
    const baseTemplate = baseById.get(templateId);
    const remoteTemplate = remoteById.get(templateId);
    const workingTemplate = workingById.get(templateId);

    const wasChangedLocally = baseTemplate
      ? (workingTemplate ? !areTemplatesEquivalent(baseTemplate, workingTemplate) : true)
      : Boolean(workingTemplate);
    const wasChangedRemotely = baseTemplate
      ? (remoteTemplate ? !areTemplatesEquivalent(baseTemplate, remoteTemplate) : true)
      : Boolean(remoteTemplate);

    // Both sides added the same new id with different content → conflict.
    if (!baseTemplate && workingTemplate && remoteTemplate && !areTemplatesEquivalent(workingTemplate, remoteTemplate)) {
      conflicts.push(templateId);
      mergedTemplates.push(remoteTemplate);
      continue;
    }
    if (wasChangedLocally && wasChangedRemotely) {
      if (!workingTemplate && !remoteTemplate) {
        continue; // both deleted — agree
      }
      if (workingTemplate && remoteTemplate && areTemplatesEquivalent(workingTemplate, remoteTemplate)) {
        mergedTemplates.push(workingTemplate);
        continue;
      }
      conflicts.push(templateId);
      mergedTemplates.push(remoteTemplate ?? workingTemplate as JiraTemplate);
      continue;
    }
    if (wasChangedLocally) {
      if (workingTemplate) {
        mergedTemplates.push(workingTemplate); // local add/edit (deletion → skip)
      }
      continue;
    }
    if (wasChangedRemotely) {
      if (remoteTemplate) {
        mergedTemplates.push(remoteTemplate);
      }
      continue;
    }
    // Unchanged on both sides.
    const unchangedTemplate = remoteTemplate ?? baseTemplate;
    if (unchangedTemplate) {
      mergedTemplates.push(unchangedTemplate);
    }
  }

  return {
    merged: {
      schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION,
      updatedAt: working.updatedAt,
      templates: mergedTemplates,
    },
    conflicts,
  };
}
