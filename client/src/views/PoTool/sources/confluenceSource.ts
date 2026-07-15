// confluenceSource.ts — Pulls a Confluence page into the composition workspace by URL.
//
// The fetch and the URL→pageId parsing already exist and are proven by the PI Review save path, so this
// module reuses them wholesale. What it adds is the part a PO actually needs: saying WHICH thing went
// wrong.
//
// That matters because the four failures demand four different responses — fix the link, ask for access,
// connect to the VPN, or go and configure Confluence. One generic "could not load page" sends a PO to
// the wrong one, and an unreachable Confluence rendered as an empty page is the worst of all: it looks
// like the page is blank when really nothing was read (FR-023b, SC-018, INV-J6).

import {
  ConfluenceRequestError,
  fetchConfluencePageByReference,
  resolveConfluencePageIdFromReference,
} from '../../../services/confluenceApi.ts';
import { readConfluenceStorageText } from '../../../utils/confluenceStorageText.ts';
import { mintSourceId, type ConfluenceSource, type ReferencedSource } from './sourceModel';

/** Which of the four things went wrong — the caller shows a different message for each. */
export type ConfluenceFailureKind =
  | 'invalid-reference'
  | 'not-found'
  | 'no-permission'
  | 'unreachable'
  | 'not-configured'
  | 'unknown';

/** A Confluence read that failed, classified so the PO is told what to do about it. */
export class ConfluenceSourceError extends Error {
  readonly kind: ConfluenceFailureKind;

  constructor(kind: ConfluenceFailureKind, message: string) {
    super(message);
    this.name = 'ConfluenceSourceError';
    this.kind = kind;
  }
}

/** The proxy's own code when Confluence has not been set up on this server. */
const NOT_CONFIGURED_PROXY_CODE = 'Confluence not configured';

/**
 * Works out which failure this was.
 *
 * Both "unreachable" and "not configured" arrive as a 502 from the proxy, so the status alone is not
 * enough — the proxy's error code is what separates them.
 */
function classifyConfluenceFailure(error: ConfluenceRequestError): ConfluenceSourceError {
  if (error.proxyErrorCode === NOT_CONFIGURED_PROXY_CODE) {
    return new ConfluenceSourceError(
      'not-configured',
      'Confluence is not set up on this NodeToolbox server, so pages cannot be pulled in. Ask an administrator to configure it, or paste the content instead.',
    );
  }
  if (error.status === 404) {
    return new ConfluenceSourceError(
      'not-found',
      'That Confluence page does not exist. Check the link — it may have been deleted or moved.',
    );
  }
  if (error.status === 401 || error.status === 403) {
    return new ConfluenceSourceError(
      'no-permission',
      'That Confluence page exists, but the account NodeToolbox uses cannot see it. Ask for access to the space, or paste the content instead.',
    );
  }
  if (error.status === 502) {
    return new ConfluenceSourceError(
      'unreachable',
      `Confluence could not be reached. If you are off the VPN this is a connection problem rather than a problem with the page. (${error.message})`,
    );
  }
  return new ConfluenceSourceError('unknown', error.message);
}

/**
 * Fetches a Confluence page and turns it into a referenced source.
 *
 * `nowIso` is injected so this module never reads the clock itself and stays testable.
 */
export async function readConfluenceSource(
  pageReference: string,
  existingSources: readonly ReferencedSource[],
  nowIso: string,
): Promise<ConfluenceSource> {
  const trimmedReference = pageReference.trim();
  if (trimmedReference === '') {
    throw new ConfluenceSourceError('invalid-reference', 'Paste a Confluence page URL to add it.');
  }
  // Catching this early gives a better message than letting the fetch fail on a nonsense id.
  if (resolveConfluencePageIdFromReference(trimmedReference) === null) {
    throw new ConfluenceSourceError(
      'invalid-reference',
      'That does not look like a Confluence page link. Paste the full page URL, or the numeric page ID.',
    );
  }

  try {
    const confluencePage = await fetchConfluencePageByReference(trimmedReference);
    return {
      kind: 'confluence',
      id: mintSourceId(existingSources, 'confluence'),
      title: confluencePage.title,
      // Kept so the PO can open the real page later — a fetched copy is a snapshot, not the source.
      pageUrl: trimmedReference,
      pageId: confluencePage.id,
      // Reduced to text on the way in: this is reference reading, and remote markup is never rendered.
      text: readConfluenceStorageText(confluencePage.body?.storage?.value ?? ''),
      fetchedAtIso: nowIso,
    };
  } catch (error) {
    if (error instanceof ConfluenceRequestError) {
      throw classifyConfluenceFailure(error);
    }
    throw new ConfluenceSourceError(
      'unknown',
      error instanceof Error ? error.message : 'That Confluence page could not be added.',
    );
  }
}
