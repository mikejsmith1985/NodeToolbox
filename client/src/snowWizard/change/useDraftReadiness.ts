// useDraftReadiness.ts — The readiness checklist for the draft in hand, from 039's one shared engine.
//
// The only read is the one a draft cannot answer itself: what ServiceNow holds for the change being modified (039's own
// gatherer). A new change is judged from the draft alone. Every state update happens in an async
// continuation, tagged with the request it answers, so a stale read is never shown (react-hooks/set-state-in-effect).

import { useEffect, useMemo, useState } from 'react';

import { buildChangeReadiness, type ChangeReadinessFacts, type ReadinessItem, type ReadinessPrb } from '../../views/SnowHub/guided/changeReadiness.ts';
import { gatherChangeReadinessFacts } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import { readRcpRulesEnabled } from '../../views/SnowHub/rcp/rcpApprovalEmail.ts';
import { readCentralTodayIso } from '../../views/SnowHub/rcp/rcpRules.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';
import { buildDraftReadinessFacts } from './draftReadinessFacts.ts';

/**
 * The checks the Wizard leaves out. The AI review verdict: Toolbox's Risk Check is run on the real ticket instead,
 * and counting a verdict once looped people back (owner feedback). Problem records: ServiceNow links them to the change
 * by itself, so they are never work for the user (owner, GH #475).
 */
const WIZARD_SKIPPED_CHECK_IDS: ReadonlySet<string> = new Set(['riskCheck', 'prbs']);

/** The checklist without the checks the Wizard leaves out. */
function excludeSkippedChecks(items: ReadinessItem[]): ReadinessItem[] {
  return items.filter((item) => !WIZARD_SKIPPED_CHECK_IDS.has(item.id));
}

/** The checklist, or null while its reads are still running. */
export interface DraftReadiness {
  items: ReadinessItem[] | null;
}

/** What one read answered, tagged with the request it belongs to. */
interface ReadAnswer {
  requestKey: string;
  prbRows: ReadinessPrb[] | null;
  prbFailureReason?: string;
  existingFacts: ChangeReadinessFacts | null;
}

const NO_JIRA_EVIDENCE: readonly string[] = [];

/**
 * The checklist for the draft. `isActive` holds the reads back until the checks matter (the Checks step and after),
 * so typing on an earlier step never fires them. `jiraEvidenceFileNames` are the Jira files ticked on "Add proof" —
 * they go in the evidence zip at create, so they count as test evidence exactly like files from this computer.
 */
export function useDraftReadiness(draft: CrgDraftState, session: ChangeWizardSession, isActive: boolean, jiraEvidenceFileNames: readonly string[] = NO_JIRA_EVIDENCE): DraftReadiness {
  const [readAnswer, setReadAnswer] = useState<ReadAnswer | null>(null);
  const issueKeys = useMemo(() => [...draft.selectedIssueKeys].sort(), [draft.selectedIssueKeys]);
  const changeNumber = session.modify?.changeNumber ?? '';
  const requestKey = `${session.mode}|${changeNumber}|${issueKeys.join(',')}|${String(session.riskReview?.isReady ?? 'none')}|${session.readinessRefreshCount ?? 0}`;
  const isRcpRulesEnabled = readRcpRulesEnabled();

  useEffect(() => {
    if (!isActive) return;
    let isCurrent = true;
    const todayIso = readCentralTodayIso();
    const readPromise: Promise<Omit<ReadAnswer, 'requestKey'>> = session.mode === 'modify'
      ? gatherChangeReadinessFacts(changeNumber, { riskReview: session.riskReview, isRcpRulesEnabled, todayIso })
        .then((gathered) => ({ prbRows: [], existingFacts: gathered.facts }))
      // Problem records are not checked (ServiceNow links them itself), so a new change reads nothing first.
      : Promise.resolve({ prbRows: [] as ReadinessPrb[], existingFacts: null });
    void readPromise.then((answer) => { if (isCurrent) setReadAnswer({ ...answer, requestKey }); });
    return () => { isCurrent = false; };
  }, [isActive, requestKey, session.mode, changeNumber, issueKeys, session.riskReview, isRcpRulesEnabled]);

  const evidenceFileNames = useMemo(() => [...session.evidenceFileNames, ...jiraEvidenceFileNames], [session.evidenceFileNames, jiraEvidenceFileNames]);
  const items = useMemo(() => {
    if (!readAnswer || readAnswer.requestKey !== requestKey) return null;
    return excludeSkippedChecks(buildChangeReadiness(buildDraftReadinessFacts({
      mode: session.mode, draft, riskReview: session.riskReview, isRcpRulesEnabled, todayIso: readCentralTodayIso(),
      evidenceFileNames, prbRows: readAnswer.prbRows, prbFailureReason: readAnswer.prbFailureReason,
      existingFacts: readAnswer.existingFacts, existingTaskLinks: session.modify?.existingTasks,
    })));
  }, [readAnswer, requestKey, session.mode, draft, session.riskReview, isRcpRulesEnabled, evidenceFileNames, session.modify?.existingTasks]);

  return { items };
}
