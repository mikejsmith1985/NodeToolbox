// CategoryCard.tsx — One daily-duty card on the Scrum Master "Today" dashboard.
//
// A card shows a single category's live count and a one-click deep link to where the work is
// done, plus a daily check-off control. It renders four distinct states — loading, ready,
// error, and not-configured — so the user always sees an honest status rather than a misleading
// zero. The card performs no Jira mutation; its only write is toggling daily completion.

import type { CategoryCatalogEntry } from './todayCategories.ts';
import type { CategoryResult, TodayDestination } from './hooks/useTodayDashboard.ts';
import styles from './CategoryCard.module.css';

// Counts above this render as "99+" so a single huge bucket never breaks the card layout.
const MAX_DISPLAYED_COUNT = 99;
// Where the "configure your team" link sends users when a team-scope card is not set up.
const TEAM_SETUP_DESTINATION: TodayDestination = { kind: 'sprintTab', tab: 'settings' };

export interface CategoryCardProps {
  entry: CategoryCatalogEntry;
  result: CategoryResult;
  isComplete: boolean;
  onToggleComplete: () => void;
  onNavigate: (destination: TodayDestination) => void;
  /** Optional per-card retry, wired to the dashboard refresh so an errored card can recover. */
  onRetry?: () => void;
  /** Opens the card's destination scoped to ONE team (multi-team breakdown chips, GH #282). */
  onOpenTeam?: (teamProfileId: string, destination: TodayDestination) => void;
}

/** Formats a count for display, collapsing very large numbers to "99+". */
function formatCount(count: number): string {
  return count > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : String(count);
}

/** Renders the card header (icon + label) shared by every card state. */
function CardHeader({ entry }: { entry: CategoryCatalogEntry }) {
  return (
    <div className={styles.header}>
      <span className={styles.icon} aria-hidden="true">{entry.icon}</span>
      <span className={styles.label}>{entry.label}</span>
    </div>
  );
}

/** Renders a single Today category card in whichever state its result describes. */
export default function CategoryCard({
  entry,
  result,
  isComplete,
  onToggleComplete,
  onNavigate,
  onRetry,
  onOpenTeam,
}: CategoryCardProps) {
  if (result.status === 'loading') {
    return (
      <div className={styles.card} data-category={entry.id} aria-busy="true">
        <CardHeader entry={entry} />
        <span className={styles.spinner} role="status" aria-label={`Loading ${entry.label}`} />
      </div>
    );
  }

  if (result.status === 'error') {
    return (
      <div className={`${styles.card} ${styles.errorCard}`} data-category={entry.id}>
        <CardHeader entry={entry} />
        <p className={styles.message} role="alert">{result.errorMessage ?? 'Failed to load'}</p>
        {onRetry && (
          <button className={styles.actionButton} onClick={onRetry} type="button">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (result.status === 'not-configured') {
    return (
      <div className={`${styles.card} ${styles.notConfiguredCard}`} data-category={entry.id}>
        <CardHeader entry={entry} />
        <p className={styles.message}>Team not set up — configure in Sprint Dashboard.</p>
        <button
          className={styles.actionButton}
          onClick={() => onNavigate(TEAM_SETUP_DESTINATION)}
          type="button"
        >
          Configure team
        </button>
      </div>
    );
  }

  // ── ready state ──
  const isCleared = isComplete && result.count === 0;
  const cardClassName = `${styles.card} ${isComplete ? styles.completeCard : ''}`.trim();
  // A breakdown is only informative when there is more than one team to break down.
  const teamBreakdown = (result.teamBreakdown?.length ?? 0) > 1 ? result.teamBreakdown : undefined;
  // Likewise for scopes: a chip row saying "Mine 8 · Team 0" is noise, because the Open button
  // already goes to the only scope that has anything in it. Two populated scopes is the case that
  // needs saying, because one link cannot show both.
  const populatedScopeShares = (result.scopeBreakdown ?? []).filter((scopeShare) => scopeShare.count > 0);
  const scopeBreakdown = populatedScopeShares.length > 1 ? populatedScopeShares : undefined;

  return (
    <div className={cardClassName} data-category={entry.id} data-complete={isComplete}>
      <CardHeader entry={entry} />
      <span className={styles.count} aria-label={`${result.count} items need attention`}>
        {isCleared ? '✓' : formatCount(result.count)}
      </span>
      {scopeBreakdown ? (
        <div className={styles.teamBreakdown}>
          {scopeBreakdown.map((scopeShare) => (
            <button
              className={styles.teamChip}
              key={scopeShare.id}
              onClick={() => onNavigate(scopeShare.destination)}
              title={`Open the ${scopeShare.label.toLowerCase()} half — an issue in both is counted once in the total`}
              type="button"
            >
              {scopeShare.label} {formatCount(scopeShare.count)}
            </button>
          ))}
        </div>
      ) : null}
      {teamBreakdown ? (
        <div className={styles.teamBreakdown}>
          {teamBreakdown.map((teamShare) => (
            <button
              className={styles.teamChip}
              key={teamShare.teamProfileId}
              onClick={() => onOpenTeam?.(teamShare.teamProfileId, result.destination)}
              title={teamShare.hasError
                ? `${teamShare.teamName}: scan failed — count unknown`
                : `Open ${teamShare.teamName}'s view`}
              type="button"
            >
              {teamShare.teamName} {teamShare.hasError ? '⚠' : formatCount(teamShare.count)}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.footer}>
        <button
          className={styles.actionButton}
          onClick={() => onNavigate(result.destination)}
          type="button"
        >
          {isCleared ? 'Cleared' : 'Open'}
        </button>
        <label className={styles.checkLabel}>
          <input
            checked={isComplete}
            onChange={onToggleComplete}
            type="checkbox"
          />
          <span>Done</span>
        </label>
      </div>
    </div>
  );
}
