// checkFollowUps.ts — Says, for a check the Wizard cannot fix on the spot, how it does get done: test evidence is swept
// from Jira and attached when the change is saved, the Director's approval is attached when the reply comes back, and a
// late submission can only be moved or explained (owner, GH #475: these showed buttons that fixed nothing).

import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { RCP_RULE_TITLES } from '../../views/SnowHub/rcp/rcpRules.ts';

/** How a check gets done, and whether its fix button still helps (it does when another, fixable part also failed). */
export interface CheckFollowUp {
  notes: string[];
  isFixButtonUseful: boolean;
}

// The RCP rules whose answer arrives from outside the Wizard, each with what the user does instead.
const OUTSIDE_RCP_RULES: ReadonlyArray<{ title: string; note: (changeName: string) => string }> = [
  {
    title: RCP_RULE_TITLES.approval,
    note: (changeName) => `✉️ Waiting on the Director's reply? Save anyway. When it comes back, attach the email (.msg / .eml) or a PDF of it to ${changeName} — this check passes then.`,
  },
  {
    title: RCP_RULE_TITLES.leadTime,
    note: () => '📅 How early it went in cannot be changed now. Move the start to a later approved night, or say in the justification why it cannot wait — Change Management decides.',
  },
];
const ALL_RCP_TITLES = Object.values(RCP_RULE_TITLES);

function describeEvidenceFollowUp(changeName: string): CheckFollowUp {
  return {
    notes: [`📎 Handled when you save: the last step sweeps Jira — this change's issues, their sub-tasks and linked issues — zips every file it finds and attaches the zip to ${changeName}. An issue with no file anywhere needs its results attached in Jira first.`],
    isFixButtonUseful: false,
  };
}

/** The restricted-change-period rules this item says were not met, read from its reason (the titles are shared constants). */
function readFailedRcpTitles(item: ReadinessItem): string[] {
  return ALL_RCP_TITLES.filter((title) => item.reason.includes(title));
}

function describeRcpFollowUp(item: ReadinessItem, changeName: string): CheckFollowUp | null {
  const failedTitles = readFailedRcpTitles(item);
  const outsideRules = OUTSIDE_RCP_RULES.filter((rule) => failedTitles.includes(rule.title));
  if (outsideRules.length === 0) return null;
  return { notes: outsideRules.map((rule) => rule.note(changeName)), isFixButtonUseful: failedTitles.length > outsideRules.length };
}

/** How a check that needs action gets done when no button here can do it, or null when its own fix button does. */
export function describeCheckFollowUp(item: ReadinessItem, changeNumber: string): CheckFollowUp | null {
  if (item.state !== 'needsAction') return null;
  const changeName = changeNumber || 'the change';
  if (item.id === 'testEvidence' && item.action?.kind === 'openStep' && item.action.stepId === 'testEvidence') return describeEvidenceFollowUp(changeName);
  if (item.id === 'rcp') return describeRcpFollowUp(item, changeName);
  return null;
}

/** True for a check nothing more on this screen can do: it is handled on save, or by a reply from outside. */
export function isHandledLater(item: ReadinessItem, changeNumber: string): boolean {
  const followUp = describeCheckFollowUp(item, changeNumber);
  return followUp !== null && !followUp.isFixButtonUseful;
}
