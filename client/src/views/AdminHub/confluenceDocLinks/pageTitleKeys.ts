// pageTitleKeys.ts — Which Jira issue a Confluence page is about, read from its title.
//
// The team writes the key into the page title, and writes it four different ways: "DENP-477: OHI
// Survey file", "DENP 842: Dev: …" with a space instead of a hyphen, "INC0100170/ENCUC-2070 TCO
// dates" with the key buried behind a ServiceNow number, and "ESI reconciliation" with no key at
// all. A parser that only handled the tidy first form would silently ignore most of the tree.
//
// Pure and separate because this is the one part that is entirely about THIS team's habits. Every
// title shape they use is a test here, so a fifth habit is a test and a line, not an investigation.

/**
 * A Jira key with an OPTIONAL separator, because the team writes both "DENP-842" and "DENP 842".
 *
 * The project part is anchored to a word boundary so "INC0100170/ENCUC-2070" still yields ENCUC-2070
 * rather than matching inside the ServiceNow number, and the number part is bounded so a key is not
 * read out of the middle of a longer digit run.
 */
const JIRA_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9})[- ](\d{1,6})\b/g;

/** One key found in a page title, normalised to the form Jira accepts. */
export interface PageTitleKey {
  /** Always hyphenated, whatever the title used. */
  issueKey: string;
  /** The project prefix, which is how a Feature is told from a team issue. */
  projectKey: string;
}

/**
 * Every Jira key named in a page title, in the order they appear, de-duplicated.
 *
 * Returns ALL of them rather than the first: "INC0100170/ENCUC-2070" names one, but a title naming
 * two genuinely is about two, and deciding which one wins is the caller's business — it depends on
 * which project is the Feature project, which this module deliberately does not know.
 */
export function readPageTitleKeys(pageTitle: string): PageTitleKey[] {
  const foundKeys = new Map<string, PageTitleKey>();

  for (const match of String(pageTitle ?? '').matchAll(JIRA_KEY_PATTERN)) {
    const projectKey = match[1];
    const issueKey = `${projectKey}-${match[2]}`;
    if (!foundKeys.has(issueKey)) {
      foundKeys.set(issueKey, { issueKey, projectKey });
    }
  }

  return [...foundKeys.values()];
}

/** Which issue a page documents, and how confidently. */
export interface PageSubject {
  /** The key to route from, or null when the title names none. */
  issueKey: string | null;
  /** True when the key belongs to the Feature project, so the caller must map down to a story. */
  isFeatureKey: boolean;
  /** Every key the title named, so a page about two can be reported rather than quietly halved. */
  allIssueKeys: string[];
}

/**
 * Decides which issue a page is about.
 *
 * The FEATURE key wins when a title names both. A page titled with a Feature and a story is about
 * the Feature's work, and routing to the story named beside it would attach the whole Feature's test
 * scenarios to one piece of it.
 *
 * Everything else falls to the first key in the title, which is the one the author led with.
 */
export function readPageSubject(pageTitle: string, featureProjectKeys: readonly string[]): PageSubject {
  const titleKeys = readPageTitleKeys(pageTitle);
  const normalizedFeatureProjects = new Set(featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase()));

  const featureKey = titleKeys.find((titleKey) => normalizedFeatureProjects.has(titleKey.projectKey));
  const chosenKey = featureKey ?? titleKeys[0] ?? null;

  return {
    issueKey: chosenKey?.issueKey ?? null,
    isFeatureKey: chosenKey !== null && normalizedFeatureProjects.has(chosenKey.projectKey),
    allIssueKeys: titleKeys.map((titleKey) => titleKey.issueKey),
  };
}
