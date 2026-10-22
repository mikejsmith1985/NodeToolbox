// checkFollowUps.test.ts — Proves checks the Wizard cannot fix on the spot say how they get done instead of offering a
// button that does nothing (GH #475).

import { describe, expect, it } from 'vitest';

import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { describeCheckFollowUp, isHandledLater } from './checkFollowUps.ts';

const EVIDENCE_ITEM: ReadinessItem = {
  id: 'testEvidence', label: 'Test evidence', state: 'needsAction', reason: '34 files are attached, but DENP-1479 has no test evidence file.',
  action: { kind: 'openStep', stepId: 'testEvidence', label: 'Attach test evidence' },
};

function buildRcpItem(reason: string): ReadinessItem {
  return { id: 'rcp', label: 'Restricted change period rules', state: 'needsAction', reason, action: { kind: 'openStep', stepId: 'rcpChecklist', label: 'Open the RCP checklist' } };
}

describe('describeCheckFollowUp', () => {
  it('says missing test evidence is swept from Jira and attached on save, with no button', () => {
    const followUp = describeCheckFollowUp(EVIDENCE_ITEM, 'CHG0052053');
    expect(followUp?.notes[0]).toMatch(/Handled when you save.*sub-tasks and linked issues.*CHG0052053/);
    expect(isHandledLater(EVIDENCE_ITEM, 'CHG0052053')).toBe(true);
  });

  it('says to attach the Director reply when it comes back, and how a late submission is handled', () => {
    const item = buildRcpItem('Not met: Director approval attached, Submitted early enough.');
    const followUp = describeCheckFollowUp(item, 'CHG1');
    expect(followUp?.notes).toEqual([expect.stringMatching(/Waiting on the Director's reply\? Save anyway.*CHG1/), expect.stringMatching(/cannot be changed now/)]);
    expect(isHandledLater(item, 'CHG1')).toBe(true);
  });

  it('keeps the RCP checklist button when another rule, which the checklist fixes, also failed', () => {
    const item = buildRcpItem('Not met: Approved implementation window, Director approval attached.');
    expect(describeCheckFollowUp(item, 'CHG1')?.isFixButtonUseful).toBe(true);
    expect(isHandledLater(item, 'CHG1')).toBe(false);
  });

  it('leaves alone checks whose own button fixes them, and checks that are done', () => {
    expect(describeCheckFollowUp(buildRcpItem('Not met: Approved implementation window.'), 'CHG1')).toBeNull();
    expect(describeCheckFollowUp({ ...EVIDENCE_ITEM, state: 'done' }, 'CHG1')).toBeNull();
    expect(describeCheckFollowUp(EVIDENCE_ITEM, '')?.notes[0]).toMatch(/to the change\./);
  });
});
