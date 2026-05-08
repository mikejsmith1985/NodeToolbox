// PersonaIntelStrip.tsx — Summary bar showing persona-specific issue metric chips.
//
// Renders a row of chips above the issue list that surface counts and context
// relevant to the active persona (Dev / QA / SM / PO).  Chips that map to a
// status zone are clickable and delegate to the parent's zone-filter handler.

import type { Persona } from './hooks/useMyIssuesState.ts';
import type { ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';
import { classifyIssueZone, computeAttentionReasons, STALE_SM_THRESHOLD_DAYS } from './myIssuesExtendedTypes.ts';
import styles from './PersonaIntelStrip.module.css';

// ── Types ──

export interface PersonaIntelStripProps {
  issues: ExtendedJiraIssue[];
  persona: Persona;
  /** The currently active status-zone filter key, or null if none. */
  activeStatusZone: string | null;
  /** Called when the user clicks a chip that maps to a zone. */
  onZoneClick: (zone: string | null) => void;
}

interface IntelChip {
  label: string;
  emoji: string;
  count: number;
  /** The status-zone key to activate when this chip is clicked, or null if non-interactive. */
  zoneKey: string | null;
  colorClass: string;
}

// ── Computation helpers — one per persona ──

/** Builds chips for the Developer persona. */
function buildDevChips(issues: ExtendedJiraIssue[]): IntelChip[] {
  let attentionCount = 0;
  let inProgressCount = 0;
  let inReviewCount = 0;
  let toDoCount = 0;

  for (const issue of issues) {
    const zone = classifyIssueZone(issue);
    if (zone === 'attn') attentionCount++;
    else if (zone === 'inrev') inReviewCount++;
    else if (zone === 'inprog') inProgressCount++;
    else if (zone === 'todo') toDoCount++;
  }

  const chips: IntelChip[] = [];
  if (attentionCount > 0) {
    chips.push({ label: 'Needs Attention', emoji: '🔴', count: attentionCount, zoneKey: 'attention', colorClass: styles.chipRed });
  }
  if (inProgressCount > 0) {
    chips.push({ label: 'In Progress', emoji: '🔵', count: inProgressCount, zoneKey: 'inprogress', colorClass: styles.chipBlue });
  }
  if (inReviewCount > 0) {
    chips.push({ label: 'In Review', emoji: '🟣', count: inReviewCount, zoneKey: 'inreview', colorClass: styles.chipAmber });
  }
  if (toDoCount > 0) {
    chips.push({ label: 'To Do', emoji: '⚫', count: toDoCount, zoneKey: 'todo', colorClass: styles.chipGray });
  }
  return chips;
}

/** Builds chips for the QA Engineer persona. */
function buildQaChips(issues: ExtendedJiraIssue[]): IntelChip[] {
  let bugCount = 0;
  let inTestCount = 0;
  let toVerifyCount = 0;
  let doneCount = 0;

  for (const issue of issues) {
    const typeLower = issue.fields.issuetype.name.toLowerCase();
    const statusLower = issue.fields.status.name.toLowerCase();
    if (typeLower === 'bug') bugCount++;
    if (statusLower.includes('test') || statusLower.includes('review') || statusLower.includes('qa')) inTestCount++;
    if (statusLower === 'verify' || statusLower === 'verification' || statusLower.includes('retest')) toVerifyCount++;
    if (issue.fields.status.statusCategory.key === 'done') doneCount++;
  }

  return [
    { label: 'Bugs', emoji: '🐛', count: bugCount, zoneKey: null, colorClass: styles.chipRed },
    ...(inTestCount > 0 ? [{ label: 'In Test', emoji: '🧪', count: inTestCount, zoneKey: 'inreview', colorClass: styles.chipAmber }] : []),
    ...(toVerifyCount > 0 ? [{ label: 'To Verify', emoji: '🔍', count: toVerifyCount, zoneKey: null, colorClass: styles.chipBlue }] : []),
    ...(doneCount > 0 ? [{ label: 'Done', emoji: '✅', count: doneCount, zoneKey: 'done', colorClass: styles.chipGreen }] : []),
  ];
}

/** Builds chips for the Scrum Master persona. */
function buildSmChips(issues: ExtendedJiraIssue[]): IntelChip[] {
  let blockedCount = 0;
  let staleCount = 0;
  let notStartedCount = 0;
  const nowMs = Date.now();

  for (const issue of issues) {
    const reasons = computeAttentionReasons(issue);
    const isBlocked = reasons.some((reason) => reason === 'Blocked');
    if (isBlocked) blockedCount++;

    const updatedMs = issue.fields.updated ? new Date(issue.fields.updated).getTime() : 0;
    const daysSince = Math.floor((nowMs - updatedMs) / 86_400_000);
    const isNotDone = issue.fields.status.statusCategory.key !== 'done';
    if (daysSince >= STALE_SM_THRESHOLD_DAYS && isNotDone) staleCount++;

    if (issue.fields.status.statusCategory.key === 'new') notStartedCount++;
  }

  return [
    ...(blockedCount > 0 ? [{ label: 'Blocked', emoji: '🚫', count: blockedCount, zoneKey: 'attention', colorClass: styles.chipRed }] : []),
    ...(staleCount > 0 ? [{ label: `Stale (${STALE_SM_THRESHOLD_DAYS}d+)`, emoji: '⏰', count: staleCount, zoneKey: null, colorClass: styles.chipAmber }] : []),
    ...(notStartedCount > 0 ? [{ label: 'Not Started', emoji: '⚫', count: notStartedCount, zoneKey: 'todo', colorClass: styles.chipGray }] : []),
    { label: 'Total Assigned', emoji: '📋', count: issues.length, zoneKey: null, colorClass: styles.chipGreen },
  ];
}

/** Builds chips for the Product Owner persona. */
function buildPoChips(issues: ExtendedJiraIssue[]): IntelChip[] {
  let unestimatedCount = 0;
  let noDescriptionCount = 0;
  const epicKeys = new Set<string>();
  const releaseNames = new Set<string>();

  for (const issue of issues) {
    const { fields } = issue;
    const typeLower = fields.issuetype.name.toLowerCase();
    const isStory = typeLower === 'story' || typeLower === 'user story';
    const storyPoints = fields.customfield_10016 ?? fields.customfield_10028;
    if (isStory && !storyPoints) unestimatedCount++;

    const hasDescription =
      !!fields.description &&
      (typeof fields.description === 'string' ? fields.description.trim().length > 0 : true);
    if (!hasDescription) noDescriptionCount++;

    const epicLink = fields.customfield_10014;
    if (epicLink) epicKeys.add(epicLink);

    (fields.fixVersions ?? []).forEach((version) => releaseNames.add(version.name));
  }

  return [
    ...(unestimatedCount > 0 ? [{ label: 'Unestimated', emoji: '📐', count: unestimatedCount, zoneKey: null, colorClass: styles.chipAmber }] : []),
    ...(noDescriptionCount > 0 ? [{ label: 'No Description', emoji: '📝', count: noDescriptionCount, zoneKey: null, colorClass: styles.chipRed }] : []),
    ...(epicKeys.size > 0 ? [{ label: 'Epics', emoji: '🗂️', count: epicKeys.size, zoneKey: null, colorClass: styles.chipBlue }] : []),
    ...(releaseNames.size > 0 ? [{ label: 'Releases', emoji: '🚀', count: releaseNames.size, zoneKey: null, colorClass: styles.chipGreen }] : []),
    { label: 'Total', emoji: '📦', count: issues.length, zoneKey: null, colorClass: styles.chipGray },
  ];
}

/** Selects the correct chip-builder for the given persona. */
function buildChipsForPersona(issues: ExtendedJiraIssue[], persona: Persona): IntelChip[] {
  if (persona === 'dev') return buildDevChips(issues);
  if (persona === 'qa') return buildQaChips(issues);
  if (persona === 'sm') return buildSmChips(issues);
  return buildPoChips(issues);
}

// ── Component ──

/**
 * Renders a row of persona-specific metric chips above the issue list.
 * Chips that map to a status zone are buttons that delegate to onZoneClick.
 * Returns null when there are no issues to summarise.
 */
export default function PersonaIntelStrip({
  issues,
  persona,
  activeStatusZone,
  onZoneClick,
}: PersonaIntelStripProps) {
  if (issues.length === 0) return null;

  const chips = buildChipsForPersona(issues, persona);
  if (chips.length === 0) return null;

  function handleChipClick(chip: IntelChip) {
    if (!chip.zoneKey) return;
    // Toggle: clicking the active zone clears the filter.
    onZoneClick(activeStatusZone === chip.zoneKey ? null : chip.zoneKey);
  }

  return (
    <div aria-label="Persona summary" className={styles.intelStrip} role="group">
      {chips.map((chip) => {
        const isActive = !!chip.zoneKey && activeStatusZone === chip.zoneKey;
        const isInteractive = !!chip.zoneKey;
        const chipClassName = [
          styles.intelChip,
          chip.colorClass,
          isActive ? styles.activeIntelChip : '',
          !isInteractive ? styles.infoChip : '',
        ]
          .filter(Boolean)
          .join(' ');

        return isInteractive ? (
          <button
            className={chipClassName}
            key={chip.label}
            onClick={() => handleChipClick(chip)}
            title={`Filter by: ${chip.label}`}
            type="button"
          >
            <span aria-hidden="true">{chip.emoji}</span>
            <span className={styles.chipCount}>{chip.count}</span>
            <span>{chip.label}</span>
          </button>
        ) : (
          <span className={chipClassName} key={chip.label} title={chip.label}>
            <span aria-hidden="true">{chip.emoji}</span>
            <span className={styles.chipCount}>{chip.count}</span>
            <span>{chip.label}</span>
          </span>
        );
      })}
    </div>
  );
}
