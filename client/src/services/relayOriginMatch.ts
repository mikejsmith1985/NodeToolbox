// relayOriginMatch.ts — Telling a wrong-tab relay apart from a dropped VPN.
//
// Written for SharePoint and now shared with ServiceNow, which had the identical blind spot: its
// bookmarklet never reported where it was running, so a relay clicked on a different instance
// registered, polled happily, and showed "ServiceNow reachable" while every call it relayed went
// somewhere that could not answer (GH #377).
//
// The bookmarklet builds every request as `location.origin + path` and sends it with the tab's own
// cookies. That makes the tab it was clicked in load-bearing: click it on `contoso-my.sharepoint.com`
// while the configured library lives on `contoso.sharepoint.com`, and the request goes to the right
// PATH on the wrong SITE. SharePoint answers 401, exactly as it would for an expired session.
//
// Toolbox could not tell those apart, so it guessed — and told somebody with a working VPN and a live
// SharePoint tab to reconnect their VPN. A message that names the wrong cause is worse than one that
// admits it does not know, because it sends people to fix something that was never broken.
//
// Knowing the relay's origin makes the two distinguishable, and this is the comparison. Pure: it takes
// two strings and returns a verdict.

/** What the mismatch check concluded. */
export type RelayOriginVerdict =
  /** The relay is on the same site as the configured library — a refusal means something else. */
  | { kind: 'match' }
  /** The relay is on a different site, so every request is going somewhere that cannot answer it. */
  | { kind: 'mismatch'; relayOrigin: string; configuredOrigin: string }
  /** Not enough was known to say. Reported honestly rather than guessed either way. */
  | { kind: 'unknown' };

/**
 * The origin of a URL, or null when it cannot be read.
 *
 * Returns null rather than throwing on a half-typed or malformed URL: a setting somebody is midway
 * through editing must not take a diagnostic panel down with it.
 */
export function readOrigin(rawUrl: string | null | undefined): string | null {
  const trimmedUrl = String(rawUrl ?? '').trim();
  if (trimmedUrl === '') {
    return null;
  }
  try {
    return new URL(trimmedUrl).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Compares where the relay is running against where the configured library lives.
 *
 * Says `unknown` whenever either side is missing, and never guesses a match: claiming the origins
 * agree when one of them was never read would put the reader back to being told to reconnect a VPN
 * that is working.
 */
export function compareRelayOrigin(
  relayOrigin: string | null | undefined,
  configuredSiteUrl: string | null | undefined,
): RelayOriginVerdict {
  const readRelayOrigin = readOrigin(relayOrigin);
  const readConfiguredOrigin = readOrigin(configuredSiteUrl);

  if (readRelayOrigin === null || readConfiguredOrigin === null) {
    return { kind: 'unknown' };
  }
  if (readRelayOrigin === readConfiguredOrigin) {
    return { kind: 'match' };
  }
  return { kind: 'mismatch', relayOrigin: readRelayOrigin, configuredOrigin: readConfiguredOrigin };
}

/** The system a relay talks to, named as the reader knows it. */
export type RelaySystemLabel = 'SharePoint' | 'ServiceNow';

/**
 * Says a mismatch out loud, before anything has failed.
 *
 * A mismatched relay is provably broken: every request is going to a site that cannot answer it.
 * Waiting for a refusal to say so IS the false positive — the panel reads "connected" the whole
 * time, because the bookmarklet really is polling. Returns null when there is nothing to warn about.
 */
export function describeOriginMismatch(
  verdict: RelayOriginVerdict,
  systemLabel: RelaySystemLabel,
): string | null {
  if (verdict.kind !== 'mismatch') {
    return null;
  }

  return `The relay bookmarklet is running on ${verdict.relayOrigin}, but ${systemLabel} is `
    + `configured as ${verdict.configuredOrigin}. Every request is sent to wherever the bookmarklet `
    + 'is, so it is reaching the wrong place entirely — the relay will look connected and every call '
    + `will fail. Open ${verdict.configuredOrigin}, and click the bookmarklet in THAT tab.`;
}

/**
 * Says why the last request was refused, in terms of what is actually known.
 *
 * A mismatch is stated as the cause because it certainly is one: the request never reached the
 * system that holds the data. Everything else keeps the old advice, but as a possibility rather
 * than a diagnosis — the relay cannot see a VPN, and should not claim to.
 */
export function describeRefusal(
  verdict: RelayOriginVerdict,
  systemLabel: RelaySystemLabel = 'SharePoint',
): string {
  const mismatchMessage = describeOriginMismatch(verdict, systemLabel);
  if (mismatchMessage !== null) {
    return mismatchMessage;
  }

  return 'The bookmarklet is still running and reaching this machine, so the relay itself is fine — '
    + `${systemLabel} is refusing the request. That is usually a dropped VPN or an expired `
    + `${systemLabel} session, though it can also mean the tab you clicked the bookmarklet in no `
    + `longer has access. Reload the ${systemLabel} tab, click the bookmarklet again, and check the `
    + 'VPN if that does not fix it.';
}
