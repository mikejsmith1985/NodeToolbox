// buildSplitCommit.test.ts — Proves the review step shows every write before it happens, and that a
// commit which could go wrong is stopped rather than half-performed (FR-013, FR-034, INV-4, INV-J3/J5).

import { describe, expect, it, vi } from 'vitest';

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import { createEmptySplitDraft, type ProposedIncrement, type SplitDraft } from '../drafts/draftModel';
import { buildSplitCommit, canCommitSplit } from './buildSplitCommit';

function buildIncrement(overrides: Partial<ProposedIncrement> = {}): ProposedIncrement {
  return {
    localId: 'increment-1',
    summary: 'Submit a claim with one document',
    description: 'The happy path only.',
    acceptanceCriteria: 'Given a valid claim, it is accepted.',
    origin: 'manual',
    isAccepted: true,
    rationale: 'Happy path first.',
    createdJiraKey: null,
    ...overrides,
  };
}

function buildDraft(overrides: Partial<SplitDraft> = {}): SplitDraft {
  return {
    ...createEmptySplitDraft('profile-alpha', 'ABC-1'),
    sourceFeatureKey: 'ABC-1',
    sourceSnapshot: {
      key: 'ABC-1',
      projectKey: 'ABC',
      issueTypeId: '10001',
      issueTypeName: 'Feature',
      summary: 'Claims platform',
      description: 'Everything about claims.',
      acceptanceCriteria: '',
      fields: {},
      loadedAtIso: '2026-07-15T09:00:00.000Z',
    },
    targetProjectKey: 'ABC',
    increments: [buildIncrement()],
    linkTypeName: 'relates to',
    ...overrides,
  };
}

/** Jira always requires these; the flow supplies them itself, so they must never read as missing. */
const SELF_SUPPLIED_DESCRIPTORS: CreateMetaFieldEntry[] = [
  { fieldId: 'project', name: 'Project', required: true },
  { fieldId: 'issuetype', name: 'Issue Type', required: true },
  { fieldId: 'summary', name: 'Summary', required: true },
];

describe('buildSplitCommit — the plan', () => {
  it('plans one create per accepted increment', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ increments: [buildIncrement(), buildIncrement({ localId: 'increment-2' })] }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates).toHaveLength(2);
  });

  it('creates increments with the ORIGINAL\'s own issue type, never a hard-coded Feature (INV-J5)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates[0].issueTypeId).toBe('10001');
  });

  it('plans a link from every new increment back to the original (FR-016a)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.links).toEqual([
      { fromLocalId: 'increment-1', toIssueKey: 'ABC-1', linkTypeName: 'relates to' },
    ]);
  });

  it('targets the original\'s project by default', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ targetProjectKey: '' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates[0].projectKey).toBe('ABC');
  });

  it('honours a different target project when the PO chose one', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ targetProjectKey: 'XYZ' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates[0].projectKey).toBe('XYZ');
  });

  it('omits empty optional fields so an unset value is never sent to Jira', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ increments: [buildIncrement({ description: '   ' })] }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates[0].fields).not.toHaveProperty('description');
  });

  it('writes acceptance criteria to the field this instance uses for it', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: [
        ...SELF_SUPPLIED_DESCRIPTORS,
        { fieldId: 'customfield_10200', name: 'Acceptance Criteria', required: false },
      ],
    });

    expect(diff.creates[0].fields.customfield_10200).toBe('Given a valid claim, it is accepted.');
  });

  it('never invents an acceptance-criteria field the instance did not report', () => {
    // The PO typed acceptance criteria, but this instance reported no field to put them in. Guessing a
    // customfield id would fail the write at best, and write to the wrong field at worst.
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(Object.keys(diff.creates[0].fields)).toEqual(['summary', 'description']);
    expect(Object.keys(diff.creates[0].fields)).not.toContain('customfield_10200');
  });
});

describe('buildSplitCommit — what it refuses to commit', () => {
  it('commits only accepted increments, leaving a pending AI proposal out (FR-020)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({
        increments: [buildIncrement(), buildIncrement({ localId: 'increment-2', origin: 'ai', isAccepted: false })],
      }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates).toHaveLength(1);
    expect(diff.creates[0].localId).toBe('increment-1');
  });

  it('never re-creates an increment a previous partial commit already created (SC-011)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({
        increments: [
          buildIncrement({ localId: 'increment-1', createdJiraKey: 'ABC-2' }),
          buildIncrement({ localId: 'increment-2' }),
        ],
      }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.creates).toHaveLength(1);
    expect(diff.creates[0].localId).toBe('increment-2');
  });
});

describe('buildSplitCommit — blockers (FR-034, INV-J3)', () => {
  it('blocks when Jira requires a field the increment has not supplied, naming it', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: [
        ...SELF_SUPPLIED_DESCRIPTORS,
        { fieldId: 'customfield_50001', name: 'Business Value', required: true },
      ],
    });

    expect(diff.blockers[0].reason).toContain('Business Value');
    expect(diff.creates).toHaveLength(0);
    expect(canCommitSplit(diff)).toBe(false);
  });

  it('does not treat project, issue type, or summary as missing — the flow supplies them', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.blockers).toEqual([]);
    expect(canCommitSplit(diff)).toBe(true);
  });

  it('blocks an increment with no summary', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ increments: [buildIncrement({ summary: '  ' })] }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.blockers[0].scope).toBe('increment-1');
    expect(canCommitSplit(diff)).toBe(false);
  });

  it('blocks when nothing has been loaded to split', () => {
    const diff = buildSplitCommit({
      draft: createEmptySplitDraft('profile-alpha', 'no-feature'),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.blockers[0].reason).toMatch(/load the feature/i);
    expect(canCommitSplit(diff)).toBe(false);
  });

  it('blocks when there is nothing to create', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ increments: [] }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(canCommitSplit(diff)).toBe(false);
  });

  it('blocks a link type this Jira does not define, rather than failing at the last step (FR-037)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ linkTypeName: 'invented by me' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      availableLinkTypeNames: ['relates to', 'blocks'],
    });

    expect(diff.blockers[0].reason).toContain('invented by me');
    expect(canCommitSplit(diff)).toBe(false);
  });

  it('accepts a link type the instance offers', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({ linkTypeName: 'blocks' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      availableLinkTypeNames: ['relates to', 'blocks'],
    });

    expect(diff.blockers).toEqual([]);
  });

  it('one bad increment blocks the whole commit — no partial write (SC-008)', () => {
    const diff = buildSplitCommit({
      draft: buildDraft({
        increments: [buildIncrement(), buildIncrement({ localId: 'increment-2', summary: '' })],
      }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(canCommitSplit(diff)).toBe(false);
  });
});

describe('buildSplitCommit — drift (spec edge case)', () => {
  it('warns when the original changed in Jira since the PO loaded it', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      latestSourceSummary: 'Claims platform (revised)',
    });

    expect(diff.driftWarnings[0]).toContain('has changed in Jira');
  });

  it('does not block on drift — the PO decides, their increments are their own', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      latestSourceSummary: 'Claims platform (revised)',
    });

    expect(canCommitSplit(diff)).toBe(true);
  });

  it('says nothing when the original is unchanged', () => {
    const diff = buildSplitCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      latestSourceSummary: 'Claims platform',
    });

    expect(diff.driftWarnings).toEqual([]);
  });
});

describe('buildSplitCommit — purity (INV-4)', () => {
  it('performs no network call while building the plan', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    buildSplitCommit({ draft: buildDraft(), requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the same plan for the same draft', () => {
    const draft = buildDraft();

    expect(buildSplitCommit({ draft, requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS })).toEqual(
      buildSplitCommit({ draft, requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS }),
    );
  });

  it('does not mutate the draft it was given', () => {
    const draft = buildDraft();
    const draftBefore = JSON.parse(JSON.stringify(draft));

    buildSplitCommit({ draft, requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS });

    expect(draft).toEqual(draftBefore);
  });
});
