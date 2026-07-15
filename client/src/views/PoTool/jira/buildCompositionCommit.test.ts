// buildCompositionCommit.test.ts — Proves create and update are decided by one thing and can never both
// happen, so enriching an existing Feature cannot produce a duplicate (FR-035, FR-036, SC-012, INV-J3).

import { describe, expect, it, vi } from 'vitest';

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import { createEmptyCompositionDraft, type CompositionDraft } from '../drafts/draftModel';
import { buildCompositionCommit, canCommitComposition } from './buildCompositionCommit';

function buildDraft(overrides: Partial<CompositionDraft> = {}): CompositionDraft {
  return {
    ...createEmptyCompositionDraft('profile-alpha', 'new:1'),
    summary: 'Claimant document submission',
    description: 'Claimants cannot attach documents today.',
    acceptanceCriteria: 'Given a claim in draft…',
    targetProjectKey: 'ABC',
    targetIssueTypeId: '10001',
    ...overrides,
  };
}

const SELF_SUPPLIED_DESCRIPTORS: CreateMetaFieldEntry[] = [
  { fieldId: 'project', name: 'Project', required: true },
  { fieldId: 'issuetype', name: 'Issue Type', required: true },
  { fieldId: 'summary', name: 'Summary', required: true },
];

describe('buildCompositionCommit — creating a new Feature (FR-035)', () => {
  it('plans a create when the draft has no Jira key', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.create).not.toBeNull();
    expect(diff.update).toBeNull();
    expect(canCommitComposition(diff)).toBe(true);
  });

  it('creates in the project the PO chose, with the type they chose', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.create?.projectKey).toBe('ABC');
    expect(diff.create?.issueTypeId).toBe('10001');
  });

  it('carries the authored fields', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      acceptanceCriteriaFieldId: 'customfield_10200',
    });

    expect(diff.create?.fields).toEqual({
      summary: 'Claimant document submission',
      description: 'Claimants cannot attach documents today.',
      customfield_10200: 'Given a claim in draft…',
    });
  });

  it('omits empty optionals so an unset field is never sent', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ description: '   ' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.create?.fields).not.toHaveProperty('description');
  });

  it('never writes acceptance criteria when the instance reported no field for them', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      acceptanceCriteriaFieldId: null,
    });

    expect(Object.keys(diff.create?.fields ?? {})).not.toContain('customfield_10200');
  });

  it('blocks a create with no target project, naming what is needed (FR-035)', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ targetProjectKey: null }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.blockers[0].reason).toMatch(/choose the project/i);
    expect(diff.create).toBeNull();
    expect(canCommitComposition(diff)).toBe(false);
  });

  it('blocks a create with no issue type', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ targetIssueTypeId: null }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(canCommitComposition(diff)).toBe(false);
  });

  it('blocks when Jira requires a field the draft lacks, naming it and creating nothing (INV-J3)', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: [
        ...SELF_SUPPLIED_DESCRIPTORS,
        { fieldId: 'customfield_50001', name: 'Business Value', required: true },
      ],
    });

    expect(diff.blockers[0].reason).toContain('Business Value');
    expect(diff.create).toBeNull();
    expect(canCommitComposition(diff)).toBe(false);
  });

  it('does not treat project, issue type, or summary as missing — the flow supplies them', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft(),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.blockers).toEqual([]);
  });
});

describe('buildCompositionCommit — updating an existing Feature (FR-036, SC-012)', () => {
  it('plans an update and NEVER a create when the draft has a Jira key', () => {
    // The duplicate case: a PO who stubbed a Feature last week must not get a second one today.
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: 'ABC-7' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: { summary: 'Old summary' },
    });

    expect(diff.update?.issueKey).toBe('ABC-7');
    expect(diff.create).toBeNull();
  });

  it('ignores a target project entirely when updating — the issue already has one', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: 'ABC-7', targetProjectKey: null, targetIssueTypeId: null }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: { summary: 'Old summary' },
    });

    expect(canCommitComposition(diff)).toBe(true);
    expect(diff.update).not.toBeNull();
  });

  it('lists only the fields that actually changed', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: 'ABC-7' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: {
        summary: 'Old summary',
        description: 'Claimants cannot attach documents today.',
      },
    });

    expect(diff.update?.changedFields.map((field) => field.fieldId)).toEqual(['summary']);
  });

  it('shows the before and after, so the PO sees what they are about to overwrite', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: 'ABC-7' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: { summary: 'Old summary' },
    });

    const summaryChange = diff.update?.changedFields.find((field) => field.fieldId === 'summary');
    expect(summaryChange?.before).toBe('Old summary');
    expect(summaryChange?.after).toBe('Claimant document submission');
  });

  it('says there is nothing to save rather than writing an identical value', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: 'ABC-7', description: '', acceptanceCriteria: '' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: { summary: 'Claimant document submission' },
    });

    expect(diff.blockers[0].reason).toMatch(/nothing has changed/i);
    expect(canCommitComposition(diff)).toBe(false);
  });

  it('normalises the key the PO typed', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: '  abc-7 ' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
      existingFieldValues: { summary: 'Old' },
    });

    expect(diff.update?.issueKey).toBe('ABC-7');
  });

  it('treats a blank key as "create", not "update an issue called nothing"', () => {
    const diff = buildCompositionCommit({
      draft: buildDraft({ existingIssueKey: '   ' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(diff.create).not.toBeNull();
    expect(diff.update).toBeNull();
  });
});

describe('buildCompositionCommit — create and update are mutually exclusive', () => {
  it('never plans both, whatever the draft looks like', () => {
    const drafts = [
      buildDraft(),
      buildDraft({ existingIssueKey: 'ABC-7' }),
      buildDraft({ existingIssueKey: 'ABC-7', targetProjectKey: 'XYZ' }),
      buildDraft({ summary: '' }),
    ];

    drafts.forEach((draft) => {
      const diff = buildCompositionCommit({
        draft,
        requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
        existingFieldValues: { summary: 'Old' },
      });
      expect(diff.create === null || diff.update === null).toBe(true);
    });
  });

  it('blocks a Feature with no summary on either path', () => {
    const createDiff = buildCompositionCommit({
      draft: buildDraft({ summary: '  ' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });
    const updateDiff = buildCompositionCommit({
      draft: buildDraft({ summary: '  ', existingIssueKey: 'ABC-7' }),
      requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS,
    });

    expect(canCommitComposition(createDiff)).toBe(false);
    expect(canCommitComposition(updateDiff)).toBe(false);
  });
});

describe('buildCompositionCommit — purity', () => {
  it('performs no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    buildCompositionCommit({ draft: buildDraft(), requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not mutate the draft', () => {
    const draft = buildDraft();
    const draftBefore = JSON.parse(JSON.stringify(draft));

    buildCompositionCommit({ draft, requiredFieldDescriptors: SELF_SUPPLIED_DESCRIPTORS });

    expect(draft).toEqual(draftBefore);
  });
});
