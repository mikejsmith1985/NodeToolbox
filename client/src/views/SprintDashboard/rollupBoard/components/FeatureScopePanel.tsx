// FeatureScopePanel.tsx — Which Feature projects this team's board should show.
//
// A team board carries work linked to Features across many portfolio projects, and lanes for
// Features nobody on the team owns are noise. This is per team on purpose: one team tracks a single
// project, another tracks two.

import { useState } from 'react';

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
  /** Feature keys currently on the board, so the panel can offer the projects actually in play. */
  visibleFeatureKeys: readonly string[];
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
  visibleFeatureKeys,
  hiddenIssueCount,
  featureLinkedOutOfProjectKeys,
  issueLinkedOutOfProjectKeys,
  onScopeChange,
  onResetScope,
}: FeatureScopePanelProps) {
  const [projectKeysInput, setProjectKeysInput] = useState(
    formatFeatureProjectKeysInput(scope.featureProjectKeys),
  );
  const projectKeysInPlay = collectProjectKeysInPlay(visibleFeatureKeys);

  /** Applies the typed list. Empty means "show every Feature", which is a real choice, not a blank. */
  function handleApply(): void {
    onScopeChange({ ...scope, featureProjectKeys: parseFeatureProjectKeysInput(projectKeysInput) });
  }

  /** One click to add a project the board is already showing, so nobody has to retype a key. */
  function handleAddProjectKey(projectKey: string): void {
    const nextKeys = parseFeatureProjectKeysInput(`${projectKeysInput},${projectKey}`);
    setProjectKeysInput(formatFeatureProjectKeysInput(nextKeys));
    onScopeChange({ ...scope, featureProjectKeys: nextKeys });
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
          <span className={styles.fieldLabel}>On this board now:</span>
          {projectKeysInPlay.map((projectKey) => (
            <button
              className={scope.featureProjectKeys.includes(projectKey) ? styles.filterChipActive : styles.filterChip}
              key={projectKey}
              onClick={() => handleAddProjectKey(projectKey)}
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
