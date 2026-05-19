// rosterImport.ts — Parser for pasted Team Dashboard roster tables copied from spreadsheet-style sources.

import type { StandupRosterMemberDraft } from './useStandupRosterStore.ts';

const ROSTER_ROW_NUMBER_PATTERN = /^\d+$/;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const LAN_ID_PATTERN = /^(?=.*\d)[a-z0-9]{5,7}$/i;
const LOCATION_PATTERN = /(EST|CST|PST|MST|IST|GMT|India|,|\/|-)/i;
const WORKING_HOURS_PATTERN = /(%|AM|PM|M-F|Mon|Tue|Wed|Thu|Fri)/i;
const TRAILING_DATE_SUFFIX_PATTERN = /\s+\(\d{1,2}\/\d{1,2}\)$/;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function cleanImportedDisplayName(displayName: string): string {
  return normalizeWhitespace(displayName).replace(TRAILING_DATE_SUFFIX_PATTERN, '');
}

function isEmailAddress(value: string): boolean {
  return EMAIL_ADDRESS_PATTERN.test(value);
}

function isLanId(value: string): boolean {
  return LAN_ID_PATTERN.test(value);
}

function isLocationTimeZone(value: string): boolean {
  return LOCATION_PATTERN.test(value);
}

function isWorkingHours(value: string): boolean {
  return WORKING_HOURS_PATTERN.test(value);
}

function buildOptionalRosterField(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedValue = normalizeWhitespace(value);
  return normalizedValue || undefined;
}

function buildRoleName(roleTokens: string[]): string | undefined {
  return buildOptionalRosterField(roleTokens.join(' '));
}

function collectRosterRowTokens(pastedRosterText: string): string[][] {
  const normalizedLines = pastedRosterText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());
  const firstRowLineIndex = normalizedLines.findIndex((line) => ROSTER_ROW_NUMBER_PATTERN.test(line));
  if (firstRowLineIndex === -1) {
    return [];
  }

  const collectedRows: string[][] = [];
  let currentRowTokens: string[] = [];

  for (const line of normalizedLines.slice(firstRowLineIndex)) {
    if (!line) {
      continue;
    }

    if (ROSTER_ROW_NUMBER_PATTERN.test(line)) {
      if (currentRowTokens.length > 0) {
        collectedRows.push(currentRowTokens);
      }
      currentRowTokens = [];
      continue;
    }

    currentRowTokens.push(line);
  }

  if (currentRowTokens.length > 0) {
    collectedRows.push(currentRowTokens);
  }

  return collectedRows;
}

function parseRosterRowTokens(rowTokens: string[]): StandupRosterMemberDraft | null {
  if (rowTokens.length < 2) {
    return null;
  }

  const teamName = buildOptionalRosterField(rowTokens[0]);
  const displayName = cleanImportedDisplayName(rowTokens[1]);
  if (!teamName || !displayName) {
    return null;
  }

  let remainingTokens = rowTokens.slice(2).map(normalizeWhitespace).filter(Boolean);
  let roleTokens: string[] = [];
  let emailAddress: string | undefined;
  let locationTimeZone: string | undefined;
  let lanId: string | undefined;
  let workingHours: string | undefined;

  const emailTokenIndex = remainingTokens.findIndex(isEmailAddress);
  if (emailTokenIndex !== -1) {
    roleTokens = remainingTokens.slice(0, emailTokenIndex);
    emailAddress = remainingTokens[emailTokenIndex];
    remainingTokens = remainingTokens.slice(emailTokenIndex + 1);
  }

  const lastToken = remainingTokens.at(-1);
  if (lastToken && isWorkingHours(lastToken)) {
    workingHours = lastToken;
    remainingTokens = remainingTokens.slice(0, -1);
  }

  const candidateLanId = remainingTokens.at(-1);
  if (candidateLanId && isLanId(candidateLanId)) {
    lanId = candidateLanId;
    remainingTokens = remainingTokens.slice(0, -1);
  }

  const candidateLocation = remainingTokens.at(-1);
  if (candidateLocation && isLocationTimeZone(candidateLocation)) {
    locationTimeZone = candidateLocation;
    remainingTokens = remainingTokens.slice(0, -1);
  }

  if (roleTokens.length === 0) {
    roleTokens = remainingTokens;
  }

  return {
    assigneeQueryValue: displayName,
    displayName,
    emailAddress: buildOptionalRosterField(emailAddress),
    lanId: buildOptionalRosterField(lanId),
    locationTimeZone: buildOptionalRosterField(locationTimeZone),
    roleName: buildRoleName(roleTokens),
    teamName,
    workingHours: buildOptionalRosterField(workingHours),
  };
}

/**
 * Parses pasted spreadsheet-style roster text into Team Dashboard roster member drafts.
 * This keeps the importer tolerant of copy/paste output where each cell lands on its own line.
 */
export function parseRosterMembersFromPasteText(
  pastedRosterText: string,
): StandupRosterMemberDraft[] {
  const parsedRosterMembers = collectRosterRowTokens(pastedRosterText)
    .map(parseRosterRowTokens)
    .filter((memberDraft): memberDraft is StandupRosterMemberDraft => memberDraft !== null);

  if (parsedRosterMembers.length === 0) {
    throw new Error('No roster rows were found in the pasted text.');
  }

  return parsedRosterMembers;
}
