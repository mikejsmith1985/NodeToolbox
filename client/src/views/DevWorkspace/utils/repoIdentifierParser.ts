// repoIdentifierParser.ts — Normalizes repo monitor input into owner/repo identifiers.

function normalizeRepoIdentifier(repoInputToken: string): string | null {
  const trimmedRepoToken = repoInputToken.trim();
  if (!trimmedRepoToken) return null;

  const repoIdentifierPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const gitHubScpPattern = /^git@github\.com:/i;
  const hostOnlyGitHubPattern = /^github\.com\//i;

  let normalizedRepoToken = trimmedRepoToken.replace(gitHubScpPattern, 'https://github.com/');
  if (hostOnlyGitHubPattern.test(normalizedRepoToken)) {
    normalizedRepoToken = `https://${normalizedRepoToken}`;
  }

  const directRepoToken = normalizedRepoToken.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (repoIdentifierPattern.test(directRepoToken)) {
    return directRepoToken;
  }

  try {
    const parsedRepoUrl = new URL(normalizedRepoToken);
    if (!parsedRepoUrl.hostname.toLowerCase().includes('github.com')) {
      return null;
    }

    const pathSegments = parsedRepoUrl.pathname.split('/').filter((pathSegment) => pathSegment.length > 0);
    if (pathSegments.length < 2) {
      return null;
    }

    const ownerSegment = pathSegments[0];
    const repoSegment = pathSegments[1].replace(/\.git$/i, '');
    const repoIdentifier = `${ownerSegment}/${repoSegment}`;
    return repoIdentifierPattern.test(repoIdentifier) ? repoIdentifier : null;
  } catch {
    return null;
  }
}

/** Accepts owner/repo values or pasted GitHub URLs and returns normalized repo identifiers. */
export function parseRepoIdentifiersFromInput(repoInputText: string): string[] {
  const normalizedRepositorySet = new Set<string>();
  const repoTokens = repoInputText.split(/[\n,]/);
  repoTokens.forEach((repoToken) => {
    const normalizedRepoIdentifier = normalizeRepoIdentifier(repoToken);
    if (normalizedRepoIdentifier !== null) {
      normalizedRepositorySet.add(normalizedRepoIdentifier);
    }
  });
  return Array.from(normalizedRepositorySet);
}
