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
import type { DisciplineProjects } from '../rollupBoardTypes.ts';

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
/**
 * Splits a typed list of labels into individual ones.
 *
 * Commas AND whitespace, because a Jira label can never contain a space — so treating a space as a
 * separator costs nothing and rescues the person who typed "Backlog No-Development". Blank entries are
 * dropped rather than stored, or a trailing comma would leave an empty label that matches nothing.
 */
export function parseLabelList(typedValue: string): string[] {
  return String(typedValue ?? '')
    .split(/[,\s]+/)
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

/** Replaces one discipline in the list, leaving the others — and crucially their ORDER — untouched. */
function replaceDiscipline(
  disciplineProjects: readonly DisciplineProjects[],
  replaceIndex: number,
  nextDiscipline: DisciplineProjects,
): DisciplineProjects[] {
  return disciplineProjects.map((discipline, index) => (index === replaceIndex ? nextDiscipline : discipline));
}

/**
 * Names a configuration that cannot work, before it quietly produces a wrong board.
 *
 * The one worth catching: a discipline pointed at the team's OWN Feature project. Every clone there
 * is a peer, so the discipline would never match anything — and a setting that silently does nothing
 * is worse than one that refuses.
 */
export function describeDisciplineProblems(
  disciplineProjects: readonly DisciplineProjects[],
  devFeatureProjectKeys: readonly string[],
): string {
  const normalize = (value: string): string => value.trim().toUpperCase();
  const ownProjectKeys = new Set(devFeatureProjectKeys.map(normalize));

  const selfPointing = disciplineProjects
    .filter((discipline) => discipline.featureProjectKey.trim() !== ''
      && ownProjectKeys.has(normalize(discipline.featureProjectKey)))
    .map((discipline) => discipline.featureProjectKey.trim());
  if (selfPointing.length > 0) {
    return `${selfPointing.join(', ')} is one of this team's own Feature projects, so nothing there is`
      + ' another discipline. A clone in your own project is a peer Feature and keeps its own lane.';
  }

  const namedKeys = disciplineProjects.map((discipline) => normalize(discipline.featureProjectKey)).filter(Boolean);
  if (new Set(namedKeys).size !== namedKeys.length) {
    return 'Two disciplines name the same Feature project, so their sub-lanes would be indistinguishable.';
  }

  return '';
}

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

      {/* Stated before the carry-over options, because it narrows everything below it. */}
      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor="rollup-team-feature-label">
          Jira label marking this team&apos;s Features
        </label>
        <input
          className={styles.inputField}
          id="rollup-team-feature-label"
          onChange={(changeEvent) => onScopeChange({ ...scope, teamFeatureLabel: changeEvent.target.value })}
          placeholder="e.g. CUC"
          value={scope.teamFeatureLabel}
        />
      </div>

      <p className={styles.fieldLabel}>
        {scope.teamFeatureLabel.trim() === ''
          ? 'Without a label the board GUESSES which Features are yours — assigned to the PO, reported '
            + 'by the PO, or having a child in your project. Those guesses hold while a team owns whole '
            + 'projects and break as soon as two share one: adding a second project then brings in the '
            + 'other team’s work too. Set a label to state it instead of inferring it.'
          : `Only Features carrying “${scope.teamFeatureLabel.trim()}” count as this team’s. The `
            + 'guesses are switched off entirely — leaving them on would let the work this label exists '
            + 'to exclude back in through a side door. Any Feature of yours without the label will be '
            + 'missing until it is applied, and the board names them below so the gap is never silent.'}
      </p>

      {/* A different question from the one above: that says WHOSE a Feature is, this says whether it is
          the kind that gets broken down at all. Placeholder and rolling Features are genuinely the
          team's, so no ownership rule can separate them from real work — only a deliberate mark can. */}
      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor="rollup-excluded-feature-labels">
          Labels marking placeholder Features
        </label>
        <input
          className={styles.inputField}
          id="rollup-excluded-feature-labels"
          onChange={(changeEvent) => onScopeChange({
            ...scope,
            excludedFeatureLabels: parseLabelList(changeEvent.target.value),
          })}
          placeholder="e.g. Backlog, No-Development"
          value={scope.excludedFeatureLabels.join(', ')}
        />
      </div>

      <p className={styles.fieldLabel}>
        {scope.excludedFeatureLabels.length === 0
          ? 'Rolling and placeholder Features — a standing defect bucket, an enhancement log — are real '
            + 'Features in the PI that are never broken down, so they show up here as empty lanes '
            + 'forever. Name the labels they carry and the board stops laning them.'
          : `Features labelled ${scope.excludedFeatureLabels.join(', ')} get no lane of their own. This `
            + 'only ever hides an EMPTY lane — if work turns up under one it gets its lane back, '
            + 'because hiding it would hide the work with it.'}
      </p>

      {/* The other teams working from copies of these Features. Empty means the whole sub-lane
          feature is off, which is what keeps it opt-in. */}
      <h4 className={styles.sectionTitle}>Other disciplines that clone these Features</h4>
      <p className={styles.fieldLabel}>
        QE and BT clone a Feature into their own project and break their own work down underneath it.
        Naming their Feature project draws that work as a sub-lane under the dev Feature. A clone in
        <strong> your own</strong> Feature project is a peer, not a discipline, and keeps its own lane.
        Leave <strong>story projects empty</strong> unless you need to narrow it: a discipline&apos;s work
        often spans several projects, and anything linked to their clone is theirs whichever project it
        was raised in.
      </p>

      {scope.disciplineProjects.map((discipline, disciplineIndex) => (
        <div className={styles.editorRow} key={`${discipline.featureProjectKey}-${disciplineIndex}`}>
          <input
            aria-label={`Discipline ${disciplineIndex + 1} name`}
            className={styles.inputField}
            onChange={(changeEvent) => onScopeChange({
              ...scope,
              disciplineProjects: replaceDiscipline(scope.disciplineProjects, disciplineIndex, {
                ...discipline, name: changeEvent.target.value,
              }),
            })}
            placeholder="QE"
            value={discipline.name}
          />
          <input
            aria-label={`Discipline ${disciplineIndex + 1} Feature project`}
            className={styles.inputField}
            onChange={(changeEvent) => onScopeChange({
              ...scope,
              disciplineProjects: replaceDiscipline(scope.disciplineProjects, disciplineIndex, {
                ...discipline, featureProjectKey: changeEvent.target.value,
              }),
            })}
            placeholder="Feature project, e.g. QEINT"
            value={discipline.featureProjectKey}
          />
          <input
            aria-label={`Discipline ${disciplineIndex + 1} story projects`}
            className={styles.inputField}
            onChange={(changeEvent) => onScopeChange({
              ...scope,
              disciplineProjects: replaceDiscipline(scope.disciplineProjects, disciplineIndex, {
                ...discipline, storyProjectKeys: parseLabelList(changeEvent.target.value),
              }),
            })}
            placeholder="Story projects — leave empty for any"
            value={discipline.storyProjectKeys.join(', ')}
          />
          <button
            className={styles.actionButton}
            onClick={() => onScopeChange({
              ...scope,
              disciplineProjects: scope.disciplineProjects.filter((_, index) => index !== disciplineIndex),
            })}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}

      <div className={styles.editorRow}>
        <button
          className={styles.actionButton}
          onClick={() => onScopeChange({
            ...scope,
            disciplineProjects: [...scope.disciplineProjects, { name: '', featureProjectKey: '', storyProjectKeys: [] }],
          })}
          type="button"
        >
          Add a discipline
        </button>
      </div>

      {describeDisciplineProblems(scope.disciplineProjects, scope.featureProjectKeys) !== '' && (
        <p className={styles.fieldLabel}>
          ⚠ {describeDisciplineProblems(scope.disciplineProjects, scope.featureProjectKeys)}
        </p>
      )}

      {/* Carry-over is a scope decision like the two above it, so it lives with them. */}
      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor="rollup-carry-over-source">
          Carry work over from a previous PI
        </label>
        <select
          className={styles.inputField}
          id="rollup-carry-over-source"
          onChange={(changeEvent) =>
            onScopeChange({ ...scope, carryOverSource: changeEvent.target.value as FeatureScopeSettings['carryOverSource'] })}
          value={scope.carryOverSource}
        >
          <option value="none">— None, show only this PI —</option>
          <option value="pi-review">Only Features ticked Carry-Over on the PI Review page</option>
          <option value="unfinished-in-pi">Every unfinished Feature from a chosen PI</option>
        </select>
      </div>

      {scope.carryOverSource === 'pi-review' && (
        <p className={styles.fieldLabel}>
          Reads the <strong>Carry-Over</strong> column on this PI&apos;s PI Review page — the ticks the
          team already maintains — and pulls in those Features with their child work, whatever PI the
          children carry. Nothing else is inferred, so the board and the PI Review cannot disagree.
          Needs a PI Review page configured for this PI, and the ticks saved to Confluence.
        </p>
      )}

      {scope.carryOverSource === 'unfinished-in-pi' && (
        <>
          <div className={styles.editorRow}>
            <label className={styles.fieldLabel} htmlFor="rollup-carry-over-pi">Carry over from PI</label>
            <select
              className={styles.inputField}
              id="rollup-carry-over-pi"
              onChange={(changeEvent) => onScopeChange({ ...scope, carryOverPiValue: changeEvent.target.value })}
              value={scope.carryOverPiValue}
            >
              <option value="">— Choose a PI —</option>
              {availablePiValues.map((piValue) => (
                <option key={piValue} value={piValue}>{piValue}</option>
              ))}
            </select>
          </div>
          <p className={styles.fieldLabel}>
            Pulls in every Feature from that PI whose status category is not Done, with its child
            issues. Derived rather than recorded, so it also catches a Feature that was
            <strong> abandoned</strong> rather than carried — prefer the PI Review option where the
            ticks exist.
          </p>
        </>
      )}

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
