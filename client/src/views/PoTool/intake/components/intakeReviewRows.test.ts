// intakeReviewRows.test.ts — The review table's buckets agree with the summary outcome, rows needing the PO come first,
// the count line reads "Create · Existing · Needs a look · Not created", and the DENP Epic choice lists the top pick,
// at most four others, any unusable named key, then "Create a new Epic" and "Skip — not actionable".

import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type DuplicateCandidate,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import { settleDecision } from '../intakeChecklist.ts';
import {
  buildEpicChoiceOptions,
  buildReviewRows,
  countReviewBuckets,
  formatReviewCounts,
  MAX_ALTERNATIVE_CANDIDATES,
  readEpicChoiceValue,
  toDuplicateVerdict,
} from './intakeReviewRows.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function buildIntake(items: IntakeItem[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: items.flatMap((item) => item.lineNumbers.map((lineNumber) => ({ lineNumber, text: item.title, rawText: item.title, outlineLevel: 1 as const }))),
    items,
    setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

function buildCandidate(key: string): DuplicateCandidate {
  return { key, summary: `Epic ${key}`, statusName: 'Open', statusCategory: 'new', descriptionExcerpt: '', foundBy: 'search' };
}

/** Enrollment work checked against DENP, with the given match verdict and label. */
function buildCheckedItem(itemNumber: number, title: string, verdict: 'createNew' | 'existing', isLabelled: boolean): IntakeItem {
  const item = createIntakeItem(itemNumber, title, [itemNumber]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'ai', 'Sorted');
  item.decisions.owner = settleDecision(item.decisions.owner, 'enrollment', 'rule', 'Sizes');
  item.decisions.searchTerms = settleDecision(item.decisions.searchTerms, [title], 'ai', 'Suggested');
  const duplicateVerdict = verdict === 'existing' ? { verdict: 'existing' as const, key: 'DENP-632' } : { verdict: 'createNew' as const };
  item.decisions.duplicate = settleDecision(item.decisions.duplicate, duplicateVerdict, 'ai', 'Matched');
  if (verdict === 'existing') {
    item.decisions.label = { state: 'notApplicable', reason: 'Duplicate check: existing' };
    item.decisions.draftAccepted = { state: 'notApplicable', reason: 'Duplicate check: existing' };
  } else if (isLabelled) {
    item.decisions.label = settleDecision(item.decisions.label, 'Roadmap', 'ai', 'Suggested');
  }
  return { ...item, searchStatus: 'ok' };
}

function buildFulfillmentItem(itemNumber: number): IntakeItem {
  const item = createIntakeItem(itemNumber, 'Invoice overhaul', [itemNumber]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'ai', 'Sorted');
  item.decisions.owner = settleDecision(item.decisions.owner, 'fulfillment', 'rule', 'Sizes');
  for (const slot of ['searchTerms', 'duplicate', 'label', 'draftAccepted'] as const) {
    item.decisions[slot] = { state: 'notApplicable', reason: 'Owned: fulfillment' };
  }
  return item;
}

describe('buildReviewRows', () => {
  it('buckets each row from its summary outcome and counts them in the fixed order', () => {
    const intake = buildIntake([
      buildFulfillmentItem(1),
      buildCheckedItem(2, 'Core Integration', 'existing', false),
      buildCheckedItem(3, 'Paperless Options', 'createNew', true),
      buildCheckedItem(4, 'Member portal', 'createNew', false),
    ]);

    const { workRows } = buildReviewRows(intake, false, 'https://jira.example.com');

    expect(workRows.map((row) => [row.item.title, row.bucket])).toEqual([
      ['Member portal', 'needsLook'],
      ['Paperless Options', 'create'],
      ['Core Integration', 'existing'],
      ['Invoice overhaul', 'notCreated'],
    ]);
    expect(formatReviewCounts(countReviewBuckets(workRows))).toBe('Create 1 · Existing 1 · Needs a look 1 · Not created 1');
  });

  it('lists a flagged row first even when it will be created, and marks a PO choice as awaited', () => {
    const flagged = { ...buildCheckedItem(2, 'AEP', 'createNew', true), reviewFlag: 'Shared: a close call' };
    const intake = buildIntake([buildCheckedItem(1, 'Paperless Options', 'createNew', true), flagged, buildCheckedItem(3, 'Member portal', 'createNew', false)]);

    const { workRows } = buildReviewRows(intake, false, '');

    expect(workRows.map((row) => row.item.title)).toEqual(['AEP', 'Member portal', 'Paperless Options']);
    expect(workRows[0]).toMatchObject({ bucket: 'create', needsAttention: true, isAwaitingPoChoice: false });
    expect(workRows[1]).toMatchObject({ bucket: 'needsLook', isAwaitingPoChoice: true });
  });

  it('keeps settled non-work items in the "Also in the notes" group', () => {
    const risk = createIntakeItem(1, 'Vendor may slip', [1]);
    risk.decisions.kind = settleDecision(risk.decisions.kind, 'risk', 'ai', 'A risk');

    const { workRows, otherRows } = buildReviewRows(buildIntake([risk]), false, '');

    expect(workRows).toEqual([]);
    expect(otherRows.map((row) => row.bucket)).toEqual(['notCreated']);
  });
});

describe('buildEpicChoiceOptions', () => {
  it('lists the top pick first, then at most four others, then Create new and Skip', () => {
    const item = buildCheckedItem(1, 'Core Integration', 'existing', false);
    const candidateKeys = ['DENP-1', 'DENP-2', 'DENP-632', 'DENP-3', 'DENP-4', 'DENP-5', 'DENP-6'];
    const withCandidates = { ...item, candidates: candidateKeys.map(buildCandidate) };

    const optionValues = buildEpicChoiceOptions(withCandidates).map((option) => option.value);

    expect(optionValues).toEqual(['DENP-632', 'DENP-1', 'DENP-2', 'DENP-3', 'DENP-4', 'createNew', 'notActionable']);
    expect(optionValues.length).toBe(1 + MAX_ALTERNATIVE_CANDIDATES + 2);
    expect(readEpicChoiceValue(withCandidates)).toBe('DENP-632');
  });

  it('offers an unusable named key as "Use KEY anyway" and shows no value while the match is open', () => {
    const item = createIntakeItem(1, 'Core Integration', [1]);
    const withNamedKey = {
      ...item,
      namedKeys: [{ key: 'DENP-9', projectKey: 'DENP', lineNumber: 1, lookup: { status: 'unusable' as const, reason: 'done' as const, detail: 'Done' } }],
    };

    expect(buildEpicChoiceOptions(withNamedKey).map((option) => option.label)).toEqual(['Use DENP-9 anyway', 'Create a new Epic', 'Skip — not actionable']);
    expect(readEpicChoiceValue(withNamedKey)).toBe('');
  });

  it('turns each option back into its verdict', () => {
    expect(toDuplicateVerdict('createNew')).toEqual({ verdict: 'createNew' });
    expect(toDuplicateVerdict('notActionable')).toEqual({ verdict: 'notActionable' });
    expect(toDuplicateVerdict('DENP-5')).toEqual({ verdict: 'existing', key: 'DENP-5' });
  });
});
