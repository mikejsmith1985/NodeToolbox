// ChecksStep.tsx — "Risk check & final checks": Toolbox's AI Risk Check on the real ticket, then every Release
// Management check, each with one fix.
//
// The AI moment is Toolbox's own Risk Check (RiskCheckSection), run on the change as ServiceNow holds it with its tasks
// and evidence — the owner's request: Toolbox's AI interaction, guided. The final checks below are 039's shared engine;
// a writing gap is fixed by the Risk Check's own fix round, and a check that needs a value gets one button to its step,
// whose Next then comes straight back here.
// "Could not check" is never a pass: it holds Create until the user says they understand and want to go on.

import { isReady, type ReadinessItem, type ReadinessItemState } from '../../../views/SnowHub/guided/changeReadiness.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { isWritingCheck, resolveFixStepId } from '../draftReadinessFacts.ts';
import RiskCheckSection from './RiskCheckSection.tsx';

/** The checks also need the checklist, built once for the whole job. */
export interface ChecksStepProps extends ChangeStepProps {
  items: ReadinessItem[] | null;
}

/** Each state in words, so it never depends on colour. */
const STATE_WORDS: Readonly<Record<ReadinessItemState, string>> = {
  done: 'Done',
  needsAction: 'Needs action',
  notApplicable: 'Not needed',
  couldNotCheck: 'Could not check',
};

/** One check: its state, its reason, and its one fix. */
function CheckLine({ item, onFix }: { item: ReadinessItem; onFix: (item: ReadinessItem) => void }) {
  return (
    <li className={styles.checkItem}>
      <div className={styles.checkHeader}>
        <span className={styles.statePill} data-state={item.state}>{STATE_WORDS[item.state]}</span>
        <span>{item.label}</span>
      </div>
      <p className={styles.hint}>{item.reason}</p>
      {item.state === 'needsAction' && isWritingCheck(item) ? <p className={styles.hint}>The Risk Check above rewrites this.</p> : null}
      {item.state === 'needsAction' && item.action && !isWritingCheck(item) ? (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={() => onFix(item)}>{item.action.label}</button>
        </div>
      ) : null}
    </li>
  );
}

/** The "go on anyway" acknowledgement, shown only while something is not done. */
function Acknowledgement({ items, session, updateSession }: Pick<ChecksStepProps, 'session' | 'updateSession'> & { items: ReadinessItem[] }) {
  const hasUnchecked = items.some((item) => item.state === 'couldNotCheck');
  return (
    <div className={styles.card}>
      {hasUnchecked ? <p className={styles.noticeText}>Some checks could not be made. The last step stays locked until you tick the box below.</p> : null}
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={session.areChecksAcknowledged} onChange={(changeEvent) => updateSession({ areChecksAcknowledged: changeEvent.target.checked })} />
        I understand these are not all done, and Release Management may send the change back. Go on anyway.
      </label>
    </div>
  );
}

/** Step 9: the Release Management checks. */
export default function ChecksStep({ items, ...stepProps }: ChecksStepProps) {
  const { session, updateSession, goToStep } = stepProps;
  if (items === null) return <p className={styles.hint} role="status">Checking your change…</p>;
  const needsActionCount = items.filter((item) => item.state === 'needsAction').length;
  // "Not needed" counts as passing: it is a check that does not apply to this change.
  const passingCount = items.filter((item) => item.state === 'done' || item.state === 'notApplicable').length;
  const isAllReady = isReady(items);
  return (
    <div>
      <RiskCheckSection crg={stepProps.crg} session={session} />
      <h3 className={styles.cardTitle}>Final checks</h3>
      <p className={styles.stepIntro}>These are the checks Release Management makes before approving a change.</p>
      <div className={styles.checksScore}>
        <span className={styles.cardTitle}>{`${passingCount} of ${items.length} checks pass`}</span>
        <progress className={styles.checksMeter} value={passingCount} max={items.length} aria-label={`${passingCount} of ${items.length} checks pass`} />
      </div>
      {isAllReady
        ? <p className={styles.successText}>Everything that applies is done. This change should pass review.</p>
        : <p className={styles.noticeText}>{`${needsActionCount} check(s) need action.`}</p>}
      <ul className={styles.itemList} aria-label="Checks">
        {items.map((item) => <CheckLine key={item.id} item={item} onFix={(fixItem) => fixItem.action && goToStep(resolveFixStepId(fixItem.action), { shouldReturnHere: true })} />)}
      </ul>
      {isAllReady ? null : <Acknowledgement items={items} session={session} updateSession={updateSession} />}
    </div>
  );
}
