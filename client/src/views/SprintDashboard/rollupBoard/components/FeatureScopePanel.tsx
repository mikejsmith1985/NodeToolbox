// FeatureScopePanel.tsx — Which Feature projects this team's board should show.
//
// A team board carries work linked to Features across many portfolio projects, and lanes for
// Features nobody on the team owns are noise. This is per team on purpose: one team tracks a single
// project, another tracks two.

import { useEffect, useState } from 'react';

import {
  formatFeatureProjectKeysInput,
  parseFeatureProjectKeysInput,
} from '../../../ArtView/artFeatureScopeSettings.ts';
import type { FeatureScopeSettings } from '../featureScope.ts';
import styles from '../RollupBoardTab.module.css';

export interface FeatureScopePanelProps {
  scope: FeatureScopeSettings;
  /** False while this team is still inheriting the ART-wide setting rather than its own. */
  hasOwnScope: boolean;
  /**
   * Every Feature key the board touches BEFORE scoping.
   *
   * Deriving the chips from the filtered board made them useless: once a project was excluded its
   * chip vanished, so there was no way to discover or re-add it.
   */
  allFeatureKeys: readonly string[];
  /** PI values this instance offers, so carry-over is chosen rather than typed. */
  availablePiValues?: readonly string[];
  /** How many issues the current scope is holding back. */
  hiddenIssueCount: number;
  /** Out-of-project Features reached by the Feature Link field — named whether shown or hidden. */
  featureLinkedOutOfProjectKeys: readonly string[];
  /** Out-of-project Features reached only by an issue link. */
  issueLinkedOutOfProjectKeys: readonly string[];
  onScopeChange: (scope: FeatureScopeSettings) => void;
  onResetScope: () => void;
}

/** The distinct Jira project keys among the Features currently on the board. */
function collectProjectKeysInPlay(featureKeys: readonly string[]): string[] {
  return [...new Set(
    featureKeys
      .map((featureKey) => featureKey.split('-', 1)[0]?.trim().toUpperCase() ?? '')
      .filter((projectKey) => Boolean(projectKey) && !projectKey.startsWith('__')),
  )].sort();
}

/** Renders the per-team Feature project filter. */
export function FeatureScopePanel({
  scope,
  hasOwnScope,
  allFeatureKeys,
  availablePiValues = [],
  hiddenIssueCount,
  featureLinkedOutOfProjectKeys,
  issueLinkedOutOfProjectKeys,
  onScopeChange,
  onResetScope,
}: FeatureScopePanelProps) {
  const [projectKeysInput, setProjectKeysInput] = useState(
    formatFeatureProjectKeysInput(scope.featureProjectKeys),
  );
  const projectKeysInPlay = collectProjectKeysInPlay(allFeatureKeys);

  // Keep the box showing what is actually in force, so typing and chip-clicking cannot disagree.
  useEffect(() => {
    setProjectKeysInput(formatFeatureProjectKeysInput(scope.featureProjectKeys));
  }, [scope.featureProjectKeys]);

  /** Applies the typed list. Empty means "show every Feature", which is a real choice, not a blank. */
  function handleApply(): void {
    onScopeChange({ ...scope, featureProjectKeys: parseFeatureProjectKeysInput(projectKeysInput) });
  }

  /** One click to include or exclude a project, so nobody has to retype a key. */
  function handleToggleProjectKey(projectKey: string): void {
    const isTracked = scope.featureProjectKeys.includes(projectKey);
    const nextKeys = isTracked
      ? scope.featureProjectKeys.filter((trackedKey) => trackedKey !== projectKey)
      : parseFeatureProjectKeysInput(`${projectKeysInput},${projectKey}`);
    setProjectKeysInput(formatFeatureProjectKeysInput(nextKeys));
    onScopeChange({ ...scope, featureProjectKeys: [...nextKeys] });
  }

  return (
    <section className={styles.panelCard} data-testid="rollup-feature-scope">
      <h3 className={styles.sectionTitle}>Which Features belong to this team</h3>

      <p className={styles.fieldLabel}>
        Only show lanes for Features in these Jira projects. Leave it empty to show every Feature the board
        touches.{' '}
        {hasOwnScope
          ? 'This team has its own list.'
          : 'This team is currently using the ART-wide list from ART settings.'}
      </p>

      <div className={styles.editorRow}>
        <input
          aria-label="Feature project keys"
          className={styles.inputField}
          onChange={(changeEvent) => setProjectKeysInput(changeEvent.target.value)}
          placeholder="e.g. ENCUC, DENP"
          value={projectKeysInput}
        />
        <button className={styles.actionButton} onClick={handleApply} type="button">Apply</button>
        {hasOwnScope && (
          <button className={styles.actionButton} onClick={onResetScope} type="button">
            Use the ART-wide list
          </button>
        )}
      </div>

      {projectKeysInPlay.length > 0 && (
        <div className={styles.editorRow}>
          <span className={styles.fieldLabel}>Projects this board touches — click to include or exclude:</span>
          {projectKeysInPlay.map((projectKey) => (
            <button
              aria-pressed={scope.featureProjectKeys.includes(projectKey)}
              className={scope.featureProjectKeys.includes(projectKey) ? styles.filterChipActive : styles.filterChip}
              key={projectKey}
              onClick={() => handleToggleProjectKey(projectKey)}
              type="button"
            >
              {projectKey}
            </button>
          ))}
        </div>
      )}

      {/* Both default OFF, so the project list above genuinely narrows the board. Out-of-project
          Features are still NAMED below whether or not their work is shown. */}
      <label className={styles.editorRow}>
        <input
          checked={scope.shouldIncludeOutOfProjectFeatureLinks}
          onChange={(changeEvent) =>
            onScopeChange({ ...scope, shouldIncludeOutOfProjectFeatureLinks: changeEvent.target.checked })}
          type="checkbox"
        />
        <span className={styles.fieldLabel}>
          Also show other projects&apos; Features that are linked by the <strong>Feature Link</strong> field
        </span>
      </label>

      <label className={styles.editorRow}>
        <input
          checked={scope.shouldIncludeIssueLinkedFeatures}
          onChange={(changeEvent) =>
            onScopeChange({ ...scope, shouldIncludeIssueLinkedFeatures: changeEvent.target.checked })}
          type="checkbox"
        />
        <span className={styles.fieldLabel}>
          Also show other projects&apos; Features that are only reached by an <strong>issue link</strong>
        </span>
      </label>

      {/* Carry-over is a scope decision like the two above it, so it lives with them. */}
      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor="rollup-carry-over-pi">
          Also carry over unfinished Features from PI
        </label>
        <select
          className={styles.inputField}
          id="rollup-carry-over-pi"
          onChange={(changeEvent) => onScopeChange({ ...scope, carryOverPiValue: changeEvent.target.value })}
          value={scope.carryOverPiValue}
        >
          <option value="">— None, show only this PI —</option>
          {availablePiValues.map((piValue) => (
            <option key={piValue} value={piValue}>{piValue}</option>
          ))}
        </select>
      </div>

      <p className={styles.fieldLabel}>
        A Feature that did not finish keeps its original PI in Jira, so it and its work are invisible to
        this board until you ask for them. This pulls in every <strong>unfinished</strong> Feature from
        the PI you choose, with its child issues, whatever PI those children carry. A Feature you
        abandoned rather than carried will appear too — remove it by narrowing the projects or closing it.
      </p>

      {hiddenIssueCount > 0 && (
        <p className={styles.fieldLabel}>
          {hiddenIssueCount} {hiddenIssueCount === 1 ? 'issue is' : 'issues are'} hidden by this scope right now.
        </p>
      )}

      {/* A Feature Link crossing projects is usually a mistake, so it is named even while hidden —
          the work stays off the board, but the fact does not go unnoticed. */}
      {featureLinkedOutOfProjectKeys.length > 0 && (
        <p className={styles.editorError}>
          ⚠ Linked by the Feature Link field but outside these projects:{' '}
          {featureLinkedOutOfProjectKeys.join(', ')}. That is usually worth correcting in Jira.
        </p>
      )}

      {issueLinkedOutOfProjectKeys.length > 0 && (
        <p className={styles.fieldLabel}>
          Reached only by an issue link, outside these projects: {issueLinkedOutOfProjectKeys.join(', ')}.
        </p>
      )}
    </section>
  );
}
