// useDraftReadiness.ts — The readiness checklist for the draft in hand, from 039's one shared engine.
//
// The only reads are the ones a draft cannot answer itself: which PRBs the chosen issues mention (a new change), or
// what ServiceNow holds for the change being modified (039's own gatherer). Every state update happens in an async
// continuation, tagged with the request it answers, so a stale read is never shown (react-hooks/set-state-in-effect).

import { useEffect, useMemo, useState } from 'react';

import { buildChangeReadiness, type ChangeReadinessFacts, type ReadinessItem, type ReadinessPrb } from '../../views/SnowHub/guided/changeReadiness.ts';
import { gatherChangeReadinessFacts, readPrbLinkStatus } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import { scanIssuesForProblems } from '../../views/SnowHub/problems/changeProblems.ts';
import { readRcpRulesEnabled } from '../../views/SnowHub/rcp/rcpApprovalEmail.ts';
import { readCentralTodayIso } from '../../views/SnowHub/rcp/rcpRules.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';
import { buildDraftReadinessFacts } from './draftReadinessFacts.ts';

/**
 * The Wizard's checks without the AI review item. The review (step 6) is optional coaching: an AI rarely answers
 * "ready", so counting it kept sending people back to step 6 in a loop (owner feedback). The change-text checks still
 * judge the same writing deterministically.
 */
function excludeOptionalAiReview(items: ReadinessItem[]): ReadinessItem[] {
  return items.filter((item) => item.id !== 'riskCheck');
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

const PRB_READ_FAILURE = 'Could not read the problem records named in the chosen issues.';

/** The PRBs the issues mention, judged as for a change that does not exist yet. */
async function readNewChangePrbs(issueKeys: readonly string[]): Promise<Pick<ReadAnswer, 'prbRows' | 'prbFailureReason'>> {
  if (issueKeys.length === 0) return { prbRows: [] };
  try {
    return { prbRows: (await scanIssuesForProblems(issueKeys)).map((row) => ({ prbNumber: row.prbNumber, linkStatus: readPrbLinkStatus(row, '') })) };
  } catch {
    return { prbRows: null, prbFailureReason: PRB_READ_FAILURE };
  }
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
  const requestKey = `${session.mode}|${changeNumber}|${issueKeys.join(',')}|${String(session.riskReview?.isReady ?? 'none')}`;
  const isRcpRulesEnabled = readRcpRulesEnabled();

  useEffect(() => {
    if (!isActive) return;
    let isCurrent = true;
    const todayIso = readCentralTodayIso();
    const readPromise: Promise<Omit<ReadAnswer, 'requestKey'>> = session.mode === 'modify'
      ? gatherChangeReadinessFacts(changeNumber, { riskReview: session.riskReview, isRcpRulesEnabled, todayIso })
        .then((gathered) => ({ prbRows: [], existingFacts: gathered.facts }))
      : readNewChangePrbs(issueKeys).then((prbAnswer) => ({ ...prbAnswer, existingFacts: null }));
    void readPromise.then((answer) => { if (isCurrent) setReadAnswer({ ...answer, requestKey }); });
    return () => { isCurrent = false; };
  }, [isActive, requestKey, session.mode, changeNumber, issueKeys, session.riskReview, isRcpRulesEnabled]);

  const evidenceFileNames = useMemo(() => [...session.evidenceFileNames, ...jiraEvidenceFileNames], [session.evidenceFileNames, jiraEvidenceFileNames]);
  const items = useMemo(() => {
    if (!readAnswer || readAnswer.requestKey !== requestKey) return null;
    return excludeOptionalAiReview(buildChangeReadiness(buildDraftReadinessFacts({
      mode: session.mode, draft, riskReview: session.riskReview, isRcpRulesEnabled, todayIso: readCentralTodayIso(),
      evidenceFileNames, prbRows: readAnswer.prbRows, prbFailureReason: readAnswer.prbFailureReason,
      existingFacts: readAnswer.existingFacts, existingTaskLinks: session.modify?.existingTasks,
    })));
  }, [readAnswer, requestKey, session.mode, draft, session.riskReview, isRcpRulesEnabled, evidenceFileNames, session.modify?.existingTasks]);

  return { items };
}
