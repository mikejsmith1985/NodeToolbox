// githubIdRosterImport.ts — Parses a pasted "Member | ID | Team" block (the GitHub #218 identity list)
// and matches each GitHub account id to an existing roster member.
//
// The GitHub account id (e.g. "C13471_Zilver", the value GitHub notification emails carry in
// X-GitHub-Sender) is a DIFFERENT identifier from the Jira account id the roster already stores. Linking
// it onto the roster member makes that member the bridge between the two identity systems: a GitHub event
// resolves actor → roster member → the Jira identity already on file. Because the GitHub id is not in the
// roster yet, rows can only be matched to members by NAME — so this module proposes matches for the user
// to confirm, and never writes silently.

import type { StandupRosterMember, StandupRosterMemberDraft } from './hooks/useStandupRosterStore.ts';

/** One row parsed from the pasted list: a friendly name, the GitHub account id, and an optional team. */
export interface ParsedGithubIdRow {
  memberName: string;
  githubAccountId: string;
  teamName?: string;
}

/** A parsed row paired with the roster member(s) it might belong to, for confirm-before-write UX. */
export interface GithubIdMatchProposal {
  row: ParsedGithubIdRow;
  /** The single unambiguous match, or null when zero or several members share the name. */
  suggestedMemberId: string | null;
  /** Every member whose name matches the row, so the UI can offer an override dropdown. */
  candidateMemberIds: string[];
}

// The words a header row uses to name its columns; a row made only of these is a header, not data.
const HEADER_CELL_WORDS = new Set(['member', 'id', 'team', 'name', 'github']);

/** Splits one pasted line into trimmed cells, tolerating pipe, tab, or multi-space delimiters. */
function splitRowIntoCells(rawLine: string): string[] {
  const delimiter = rawLine.includes('|') ? '|' : rawLine.includes('\t') ? '\t' : null;
  const rawCells = delimiter === null ? rawLine.split(/\s{2,}/) : rawLine.split(delimiter);
  const cells = rawCells.map((cell) => cell.trim());

  // A markdown table's leading and trailing pipes produce empty edge cells; drop only those, never an
  // interior blank (an interior blank means a genuinely missing value the caller should still see).
  if (cells.length > 0 && cells[0] === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

/** True when every cell is a known column-name word, i.e. this is the header row rather than data. */
function isHeaderRow(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => HEADER_CELL_WORDS.has(cell.toLowerCase()));
}

/** True for a markdown alignment row (every cell is only dashes and colons, e.g. "--" or ":--:"). */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** A GitHub login has no whitespace; reject empties and anything that is obviously a name. */
function isPlausibleGithubId(candidate: string): boolean {
  return candidate !== '' && !/\s/.test(candidate);
}

/**
 * Parses the pasted block into rows. Skips blank lines, the header row, and markdown separator rows;
 * keeps only rows with a non-empty name and a whitespace-free id. De-duplicates by GitHub id
 * (case-insensitively), keeping the first occurrence.
 */
export function parseGithubIdRoster(rawText: string): ParsedGithubIdRow[] {
  const parsedRows: ParsedGithubIdRow[] = [];
  const seenGithubIds = new Set<string>();

  for (const rawLine of rawText.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      continue;
    }

    const cells = splitRowIntoCells(rawLine.trim());
    if (cells.length < 2 || isHeaderRow(cells) || isSeparatorRow(cells)) {
      continue;
    }

    const memberName = cells[0];
    const githubAccountId = cells[1];
    if (memberName === '' || !isPlausibleGithubId(githubAccountId)) {
      continue;
    }

    const normalizedGithubId = githubAccountId.toLowerCase();
    if (seenGithubIds.has(normalizedGithubId)) {
      continue;
    }
    seenGithubIds.add(normalizedGithubId);

    const teamName = cells.length >= 3 && cells[2] !== '' ? cells[2] : undefined;
    parsedRows.push({ memberName, githubAccountId, teamName });
  }

  return parsedRows;
}

/** Lowercased word tokens (length ≥ 2) drawn from a member's display name and assignee value. */
function extractNameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2),
  );
}

/** True when every word of the pasted name appears as a token in the member's identifying text. */
function doesMemberMatchName(member: StandupRosterMember, targetName: string): boolean {
  const memberTokens = extractNameTokens(`${member.displayName} ${member.assigneeQueryValue}`);
  const targetTokens = targetName.toLowerCase().split(/\s+/).filter(Boolean);
  return targetTokens.length > 0 && targetTokens.every((targetToken) => memberTokens.has(targetToken));
}

/**
 * Proposes, for each parsed row, which roster member(s) it could belong to — matching by name because
 * the GitHub id is not yet on any member. A row that matches exactly one member is suggested outright;
 * zero or several matches leave the suggestion null so the user must choose.
 */
export function matchGithubIdRowsToMembers(
  rows: readonly ParsedGithubIdRow[],
  members: readonly StandupRosterMember[],
): GithubIdMatchProposal[] {
  return rows.map((row) => {
    const candidateMemberIds = members
      .filter((member) => doesMemberMatchName(member, row.memberName))
      .map((member) => member.id);
    const suggestedMemberId = candidateMemberIds.length === 1 ? candidateMemberIds[0] : null;
    return { row, suggestedMemberId, candidateMemberIds };
  });
}

/**
 * Builds an upsert draft that stamps the GitHub id onto an existing member while preserving every other
 * field (Jira identity, SNow link, roles, contact details). The team is only filled from the pasted row
 * when the member has no team of its own, so an existing team assignment is never overwritten.
 */
export function buildGithubIdLinkedDraft(
  member: StandupRosterMember,
  githubAccountId: string,
  fallbackTeamName?: string,
): StandupRosterMemberDraft {
  return {
    displayName: member.displayName,
    assigneeQueryValue: member.assigneeQueryValue,
    jiraAccountId: member.jiraAccountId,
    githubAccountId,
    snowUserDisplayName: member.snowUserDisplayName,
    snowUserSysId: member.snowUserSysId,
    teamName: member.teamName ?? fallbackTeamName,
    roleName: member.roleName,
    roleCapabilities: member.roleCapabilities,
    emailAddress: member.emailAddress,
    locationTimeZone: member.locationTimeZone,
    lanId: member.lanId,
    workingHours: member.workingHours,
  };
}
