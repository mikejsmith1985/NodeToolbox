// issueMetaVocabulary.ts — The single mapping from issue facts to visual treatment.
//
// Every surface that renders an issue's status, priority, type, owner, or age derives its
// colors and icons from these pure functions, so the same fact can never look different on
// two screens (spec 019: one vocabulary, agree-by-construction presentation). Unknown inputs
// always degrade to a neutral tone with the raw label still shown — facts are never hidden.

/** The semantic color families the chip components render (data-tone attribute values). */
export type ChipTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

/** Fallback stale threshold when a team has not configured one — matches the app-wide default. */
const DEFAULT_STALE_THRESHOLD_DAYS = 14;
/** Multiplier for the "overdue" band: past twice the stale threshold, age reads as danger. */
const OVERDUE_THRESHOLD_MULTIPLIER = 2;
/** Placeholder initials when a display name is blank. */
const UNKNOWN_INITIALS = '?';

/** Maps a Jira status-category key (new / indeterminate / done) to its chip tone. */
export function resolveStatusTone(statusCategoryKey: string | undefined): ChipTone {
  if (statusCategoryKey === 'indeterminate') return 'progress';
  if (statusCategoryKey === 'done') return 'success';
  return 'neutral';
}

/** Maps a priority name to the conventional temperature + direction glyph. */
export function resolvePriorityMeta(priorityName: string): { tone: ChipTone; directionGlyph: string } {
  const normalizedPriorityName = priorityName.trim().toLowerCase();
  switch (normalizedPriorityName) {
    case 'highest':
    case 'blocker':
      return { tone: 'danger', directionGlyph: '⇈' };
    case 'high':
    case 'critical':
      return { tone: 'warning', directionGlyph: '↑' };
    case 'medium':
      return { tone: 'neutral', directionGlyph: '→' };
    case 'low':
      return { tone: 'progress', directionGlyph: '↓' };
    case 'lowest':
      return { tone: 'progress', directionGlyph: '⇊' };
    default:
      return { tone: 'neutral', directionGlyph: '→' };
  }
}

/** Maps an issue-type name to its recognizable icon + tone. */
export function resolveIssueTypeMeta(issueTypeName: string): { icon: string; tone: ChipTone } {
  const normalizedTypeName = issueTypeName.trim().toLowerCase();
  switch (normalizedTypeName) {
    case 'bug':
    case 'defect':
      return { icon: '🐞', tone: 'danger' };
    case 'story':
      return { icon: '📗', tone: 'success' };
    case 'task':
      return { icon: '✅', tone: 'progress' };
    case 'spike':
      return { icon: '🔬', tone: 'neutral' };
    case 'feature':
    case 'epic':
      return { icon: '⚡', tone: 'warning' };
    case 'sub-task':
      return { icon: '🔹', tone: 'neutral' };
    default:
      return { icon: '📄', tone: 'neutral' };
  }
}

/**
 * Grades an issue's age against the team's configured stale threshold T:
 * below T is comfortable, T through 2T warns, past 2T reads as overdue. Deriving both bands
 * from T means a team that tunes its threshold retunes the visual heat automatically.
 */
export function resolveAgeTone(ageDays: number, staleDaysThreshold: number): ChipTone {
  const effectiveThreshold = staleDaysThreshold > 0 ? staleDaysThreshold : DEFAULT_STALE_THRESHOLD_DAYS;
  if (ageDays < effectiveThreshold) return 'neutral';
  if (ageDays <= effectiveThreshold * OVERDUE_THRESHOLD_MULTIPLIER) return 'warning';
  return 'danger';
}

/**
 * Derives avatar initials from a display name. Handles "Lastname, Firstname (CTR)" instance
 * formats by stripping parentheticals and commas first; single-token names use their first
 * two letters so the avatar is never a lone ambiguous character.
 */
export function buildAssigneeInitials(displayName: string): string {
  const nameTokens = displayName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((nameToken) => nameToken !== '');

  if (nameTokens.length === 0) return UNKNOWN_INITIALS;
  if (nameTokens.length === 1) return nameTokens[0].slice(0, 2).toUpperCase();
  return (nameTokens[0][0] + nameTokens[1][0]).toUpperCase();
}
