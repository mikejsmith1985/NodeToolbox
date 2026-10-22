// WhichChangeStep.tsx — Modify's first step "Which change?": type the number, load the change, or be sent to Review if it is closed.

import { useId } from 'react';

import type { ChangeStepProps } from '../changeWizardSession.ts';
import { buildChangeLink } from '../createOutcome.ts';
import MyOpenChangesPicker from '../MyOpenChangesPicker.tsx';
import { loadSnowUrl } from '../../shell/wizardSettings.ts';
import styles from '../ChangeWizard.module.css';
import { useModifyLoader } from '../useModifyLoader.ts';
import type { TemplateLibrary } from '../useTemplateLibrary.ts';
import QuickJobsCard from './QuickJobsCard.tsx';

/** Which Change also needs the way home, for a change that can only be reviewed. */
export interface WhichChangeStepProps extends ChangeStepProps {
  onExit: () => void;
  /** For the schedule short cut, which shows the tasks step's saved tasks. */
  library: TemplateLibrary;
}

/** The message for a change that can no longer be edited, pointing to Review. */
function RefusedNotice({ stateLabel, onExit }: { stateLabel: string; onExit: () => void }) {
  return (
    <div className={styles.card}>
      <p className={styles.noticeText}>{`This change is ${stateLabel}, so it can no longer be changed.`}</p>
      <p className={styles.hint}>To check it against Release Management&apos;s rules, go back home and choose “Review a change”.</p>
      <div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={onExit}>Back to home to review it</button></div>
    </div>
  );
}

/** Modify step 1: the change to edit. */
export default function WhichChangeStep(props: WhichChangeStepProps) {
  const { crg, session, updateSession, onExit } = props;
  const numberFieldId = useId();
  const loader = useModifyLoader(crg, (modifySession) => updateSession({ modify: modifySession }));
  const loadedChange = session.modify;
  return (
    <div>
      <p className={styles.stepIntro}>Type the number of the change you want to edit — or load your open changes and pick one — then look it up.</p>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={numberFieldId}>Change number</label>
        <div className={styles.buttonRow}>
          <input id={numberFieldId} className={styles.inputField} value={crg.state.cloneChgNumber} placeholder="CHG0012345"
            onChange={(changeEvent) => crg.actions.setCloneChgNumber(changeEvent.target.value.trim().toUpperCase())} />
          <button type="button" className={styles.actionButton} disabled={loader.status.kind === 'working'} onClick={loader.lookUp}>Look it up</button>
        </div>
        <MyOpenChangesPicker onPick={(changeNumber) => crg.actions.setCloneChgNumber(changeNumber)} />
      </div>
      {loader.status.kind === 'working' ? <p className={styles.hint} role="status">Loading the change…</p> : null}
      {loader.status.kind === 'failed' ? <p className={styles.errorText}>{loader.status.message}</p> : null}
      {loader.status.kind === 'refused' ? <RefusedNotice stateLabel={loader.status.stateLabel} onExit={onExit} /> : null}
      {loadedChange && loader.status.kind === 'idle' ? (
        <p className={styles.successText}>
          <a href={buildChangeLink(loadSnowUrl(), loadedChange.changeNumber)} target="_blank" rel="noreferrer">{loadedChange.changeNumber}</a>
          {` (${loadedChange.stateLabel}) is loaded. Press Next to walk through it — every step is filled in.`}
        </p>
      ) : null}
      {loadedChange && loader.status.kind === 'idle' ? <QuickJobsCard {...props} /> : null}
    </div>
  );
}
