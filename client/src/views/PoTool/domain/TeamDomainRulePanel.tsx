// TeamDomainRulePanel.tsx — Configures the domain components always applied to a team's Features (spec 031,
// US4). Deterministic, never AI: the PO lists the team's domain component(s) (e.g. Enrollment); a name that
// is classified `repo` or is unclassified is flagged and held back, so a repo can never be applied as a
// domain tag. When given an onApplyToFeature callback, it offers a one-click union of the valid domain
// components into the current Feature. Reuses the Feature Composition CSS vocabulary.

import React, { useState } from 'react';

import { getComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';
import {
  getTeamDomainComponents,
  setTeamDomainComponents,
  useTeamDomainRuleStore,
  validateTeamDomainRule,
} from './teamDomainRuleStore.ts';
import styles from '../FeatureCompositionTab.module.css';

interface TeamDomainRulePanelProps {
  /** The saved Dashboard Team profile the rule is keyed to. */
  teamProfileId: string;
  /** When provided, an "Apply" button unions the team's VALID domain components into the current Feature. */
  onApplyToFeature?: (validDomainNames: string[]) => void;
}

/** The per-team domain-component configuration + validation panel. */
export function TeamDomainRulePanel({ teamProfileId, onApplyToFeature }: TeamDomainRulePanelProps): React.ReactElement {
  // Subscribe so validation re-runs whenever the saved rule changes.
  useTeamDomainRuleStore((state) => state.rulesByTeam[teamProfileId]);
  const [draftText, setDraftText] = useState(() => getTeamDomainComponents(teamProfileId).join('\n'));
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const validation = validateTeamDomainRule(teamProfileId, getComponentKind);

  function handleSave(): void {
    const names = draftText.split('\n').map((name) => name.trim()).filter((name) => name !== '');
    setTeamDomainComponents(teamProfileId, names);
    setSavedNote(`Saved ${names.length} domain component(s) for this team.`);
  }

  return (
    <section className={styles.panel} aria-label="Team domain components">
      <h3 className={styles.panelTitle}>Team domain components</h3>
      <p className={styles.panelSubtitle}>
        Components always applied to this team&apos;s Features (e.g. Enrollment). Applied by rule (not the
        assistant), and never turned into a story.
      </p>
      <label className={styles.fieldLabel} htmlFor="team-domain-names">Domain component names (one per line)</label>
      <textarea
        id="team-domain-names"
        className={styles.textArea}
        value={draftText}
        onChange={(changeEvent) => setDraftText(changeEvent.target.value)}
        placeholder="Enrollment"
      />
      <div className={styles.loadBar}>
        <button type="button" className={styles.secondaryButton} onClick={handleSave}>Save team domain components</button>
        {onApplyToFeature ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={validation.valid.length === 0}
            onClick={() => onApplyToFeature(validation.valid)}
          >
            Apply {validation.valid.length} to this Feature
          </button>
        ) : null}
      </div>
      {savedNote ? <p className={styles.panelSubtitle} role="status">{savedNote}</p> : null}
      {validation.flagged.length > 0 ? (
        <ul className={styles.hygieneList} aria-label="Flagged domain components">
          {validation.flagged.map((flagged) => (
            <li key={flagged.name} className={styles.hygieneFlagWarn}>{flagged.name}: {flagged.reason} — not applied.</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
