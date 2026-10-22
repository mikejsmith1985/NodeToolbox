// ReviewRulesGuide.tsx — "What the Wizard checks, and why": every check the review runs, when it applies, what passes
// it and why Release Management cares, plus what each verdict means. Drawn from the readiness engine's own guide, so
// it lists exactly the checks that run.

import { listReadinessRuleGuide } from '../../views/SnowHub/guided/changeReadinessGuide.ts';
import shellStyles from '../shell/WizardShell.module.css';
import styles from './ReviewWizard.module.css';

/** The four verdicts, in the words the checklist shows, and what each means for the reviewer. */
const VERDICT_MEANINGS: ReadonlyArray<{ verdictText: string; state: string; meaning: string }> = [
  { verdictText: 'Done', state: 'done', meaning: 'The check passed on what ServiceNow holds.' },
  { verdictText: 'Needs action', state: 'needsAction', meaning: 'Something is missing or wrong; the reason says what.' },
  { verdictText: 'Does not apply', state: 'notApplicable', meaning: 'This change does not need it (for example, a rule for Production only). It never holds a change back.' },
  { verdictText: 'Could not check', state: 'couldNotCheck', meaning: 'The Wizard could not read or judge it — never counted as a pass. Check it by hand.' },
];

const LOCKED_CHANGE_NOTE = 'A closed, cancelled or in-implementation change can no longer be edited, so its failing checks say that instead of suggesting a fix.';

/** The explanation, folded away until the reviewer opens it. Leaves out any check the screen does not show. */
export default function ReviewRulesGuide({ excludedItemIds }: { excludedItemIds: ReadonlySet<string> }) {
  const guide = listReadinessRuleGuide(excludedItemIds);
  return (
    <details className={`${shellStyles.card} ${styles.rulesGuide}`}>
      <summary className={shellStyles.cardTitle}>{`What the Wizard checks, and why (${guide.length} checks)`}</summary>
      <h4 className={styles.guideHeading}>What each verdict means</h4>
      <ul className={styles.checkList} aria-label="What each verdict means">
        {VERDICT_MEANINGS.map((verdict) => (
          <li key={verdict.state} className={styles.checkRow}>
            <span className={styles.verdict} data-state={verdict.state}>{verdict.verdictText}</span>
            <span className={styles.checkReason}>{verdict.meaning}</span>
          </li>
        ))}
      </ul>
      <p className={shellStyles.hint}>{LOCKED_CHANGE_NOTE}</p>
      <h4 className={styles.guideHeading}>The checks</h4>
      <ol className={styles.guideList} aria-label="The checks">
        {guide.map((entry) => (
          <li key={entry.id} className={styles.guideEntry}>
            <span className={styles.checkLabel}>{entry.label}</span>
            <dl className={styles.guideFacts}>
              <dt>Applies to</dt><dd>{entry.appliesTo}</dd>
              <dt>Passes when</dt><dd>{entry.passesWhen}</dd>
              <dt>Why it matters</dt><dd>{entry.whyItMatters}</dd>
            </dl>
            {entry.subRules ? (
              <ul className={styles.guideSubRules} aria-label={`${entry.label}: the rules`}>
                {entry.subRules.map((subRule) => <li key={subRule.title}><strong>{subRule.title}</strong>{` — ${subRule.passesWhen}`}</li>)}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
