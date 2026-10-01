// releaseTitle.ts — Names a release document page after its release date, as YYYYMMMDD (e.g. 2026Oct14).
//
// The team's release pages live in their own space, so the date alone is a unique, sortable title (user
// decision, GH #395).

/** The three-letter month names, January first. */
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// An ISO date as Jira returns a version's release date: 2026-10-14.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
// A version named after its date, US style: 10/14/2026 or 9/3/2026.
const US_DATE_NAME_PATTERN = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;

const LAST_DAY_OF_ANY_MONTH = 31;

/** "2026Oct14" from year, month (1-12) and day, or null when the parts are not a real calendar day. */
function buildTitle(year: number, month: number, day: number): string | null {
  if (month < 1 || month > MONTH_ABBREVIATIONS.length || day < 1 || day > LAST_DAY_OF_ANY_MONTH) {
    return null;
  }
  return `${year}${MONTH_ABBREVIATIONS[month - 1]}${String(day).padStart(2, '0')}`;
}

/**
 * The page title for a release: from its release date, or from its name when the name is a date. Null when
 * neither gives a date — that release cannot be titled, so it is reported instead of published.
 */
export function formatReleasePageTitle(version: { releaseDate: string | null; name: string }): string | null {
  const isoMatch = ISO_DATE_PATTERN.exec(version.releaseDate ?? '');
  if (isoMatch) {
    return buildTitle(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const nameMatch = US_DATE_NAME_PATTERN.exec(version.name);
  if (nameMatch) {
    return buildTitle(Number(nameMatch[3]), Number(nameMatch[1]), Number(nameMatch[2]));
  }
  return null;
}
