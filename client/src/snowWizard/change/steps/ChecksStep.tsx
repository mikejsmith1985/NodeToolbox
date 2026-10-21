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
import { useState } from 'react';

import { isWritingCheck, resolveFixStepId } from '../draftReadinessFacts.ts';
import { fetchChangeForModify } from '../modifyLoad.ts';
import { runReadinessFix, type ReadinessFixTarget } from '../readinessFixes.ts';
import WritingEditor from '../WritingEditor.tsx';
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

/** What a one-click fix is doing, or what it did, for one check. */
type FixStatus = { kind: 'running' } | { kind: 'done'; message: string } | { kind: 'failed'; message: string };

/** The changes a one-click fix runs on: the change a modify loaded, or every change a new change made. */
async function resolveFixTargets(session: ChecksStepProps['session']): Promise<ReadinessFixTarget[]> {
  if (session.modify?.changeSysId) return [{ changeNumber: session.modify.changeNumber, changeSysId: session.modify.changeSysId }];
  const changeNumbers = session.modify ? [session.modify.changeNumber] : session.createdChanges.map((createdChange) => createdChange.changeNumber);
  const targets: ReadinessFixTarget[] = [];
  for (const changeNumber of changeNumbers) targets.push({ changeNumber, changeSysId: (await fetchChangeForModify(changeNumber)).changeSysId });
  return targets;
}

/** One check: its state, its reason, and its one fix. */
function CheckLine({ item, fixStatus, onFix }: { item: ReadinessItem; fixStatus?: FixStatus; onFix: (item: ReadinessItem) => void }) {
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
          <button type="button" className={styles.secondaryButton} disabled={fixStatus?.kind === 'running'} onClick={() => onFix(item)}>
            {fixStatus?.kind === 'running' ? 'Fixing in ServiceNow…' : item.action.label}
          </button>
        </div>
      ) : null}
      {fixStatus?.kind === 'done' ? <p className={styles.successText} role="status">{`✓ ${fixStatus.message}`}</p> : null}
      {fixStatus?.kind === 'failed' ? <p className={styles.errorText} role="status">{`✗ Not fixed: ${fixStatus.message}`}</p> : null}
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
  const [fixStatusById, setFixStatusById] = useState<Record<string, FixStatus>>({});

  /**
   * A "fix now" runs right here on the change in ServiceNow, then the checks read the change again (GH #475: these used
   * to send the user to a step that could not fix them); any other fix opens the step that holds its value.
   */
  async function handleFix(item: ReadinessItem) {
    if (!item.action) return;
    if (item.action.kind !== 'fixNow') { goToStep(resolveFixStepId(item.action), { shouldReturnHere: true }); return; }
    const fixId = item.action.fixId;
    setFixStatusById((current) => ({ ...current, [item.id]: { kind: 'running' } }));
    try {
      const message = await runReadinessFix(fixId, await resolveFixTargets(session));
      setFixStatusById((current) => ({ ...current, [item.id]: { kind: 'done', message } }));
      updateSession({ readinessRefreshCount: (session.readinessRefreshCount ?? 0) + 1 });
    } catch (fixError) {
      setFixStatusById((current) => ({ ...current, [item.id]: { kind: 'failed', message: fixError instanceof Error ? fixError.message : String(fixError) } }));
    }
  }

  if (items === null) return <p className={styles.hint} role="status">Checking your change…</p>;
  const needsActionCount = items.filter((item) => item.state === 'needsAction').length;
  // "Not needed" counts as passing: it is a check that does not apply to this change.
  const passingCount = items.filter((item) => item.state === 'done' || item.state === 'notApplicable').length;
  const isAllReady = isReady(items);
  return (
    <div>
      <RiskCheckSection crg={stepProps.crg} session={session} />
      <WritingEditor crg={stepProps.crg} title="Edit the writing yourself (saved on the last step)" isOpenAtStart={false} />
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
        {items.map((item) => <CheckLine key={item.id} item={item} fixStatus={fixStatusById[item.id]} onFix={(fixItem) => { void handleFix(fixItem); }} />)}
      </ul>
      {isAllReady ? null : <Acknowledgement items={items} session={session} updateSession={updateSession} />}
    </div>
  );
}
