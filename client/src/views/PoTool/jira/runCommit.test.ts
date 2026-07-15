// runCommit.test.ts — Proves a commit reports what actually happened, item by item, and that a link
// failure can never cost a PO an issue that was already created (FR-015, FR-041, INV-5, INV-J2/J4).

import { describe, expect, it, vi } from 'vitest';

import type { SplitCommitDiff } from './buildSplitCommit';
import { runSplitCommit, type RunSplitCommitDependencies } from './runCommit';

function buildDiff(overrides: Partial<SplitCommitDiff> = {}): SplitCommitDiff {
  return {
    creates: [
      { localId: 'increment-1', projectKey: 'ABC', issueTypeId: '10001', summary: 'One', fields: { summary: 'One' } },
    ],
    links: [{ fromLocalId: 'increment-1', toIssueKey: 'ABC-1', linkTypeName: 'relates to' }],
    blockers: [],
    driftWarnings: [],
    ...overrides,
  };
}

function buildDependencies(overrides: Partial<RunSplitCommitDependencies> = {}): RunSplitCommitDependencies {
  return {
    createIssue: vi.fn().mockResolvedValue({ id: '1', key: 'ABC-2', self: '' }),
    createIssueLink: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as RunSplitCommitDependencies;
}

describe('runSplitCommit — the happy path', () => {
  it('creates the increment with the planned project and issue type', async () => {
    const dependencies = buildDependencies();

    await runSplitCommit(buildDiff(), dependencies);

    expect(dependencies.createIssue).toHaveBeenCalledWith({
      fields: { project: { key: 'ABC' }, issuetype: { id: '10001' }, summary: 'One' },
    });
  });

  it('links the new increment back to the original', async () => {
    const dependencies = buildDependencies();

    await runSplitCommit(buildDiff(), dependencies);

    expect(dependencies.createIssueLink).toHaveBeenCalledWith({
      type: { name: 'relates to' },
      inwardIssue: { key: 'ABC-2' },
      outwardIssue: { key: 'ABC-1' },
    });
  });

  it('reports the created key so the PO can open what they just made', async () => {
    const outcome = await runSplitCommit(buildDiff(), buildDependencies());

    expect(outcome.items).toContainEqual({ scope: 'increment-1', status: 'created', jiraKey: 'ABC-2' });
    expect(outcome.createdKeysByLocalId).toEqual({ 'increment-1': 'ABC-2' });
    expect(outcome.isFullySuccessful).toBe(true);
  });

  it('creates before linking, so a link always has something to point at', async () => {
    const callOrder: string[] = [];
    const dependencies = buildDependencies({
      createIssue: vi.fn().mockImplementation(async () => {
        callOrder.push('create');
        return { id: '1', key: 'ABC-2', self: '' };
      }),
      createIssueLink: vi.fn().mockImplementation(async () => {
        callOrder.push('link');
      }),
    });

    await runSplitCommit(buildDiff(), dependencies);

    expect(callOrder).toEqual(['create', 'link']);
  });

  it('never touches the original Feature — no update, no transition, no delete (INV-J2)', async () => {
    const dependencies = buildDependencies();

    await runSplitCommit(buildDiff(), dependencies);

    // The only writes a split may perform are creates and links.
    expect(dependencies.createIssue).toHaveBeenCalledTimes(1);
    expect(dependencies.createIssueLink).toHaveBeenCalledTimes(1);
  });
});

describe('runSplitCommit — a create fails', () => {
  it('reports Jira\'s real reason, not a generic error (FR-041)', async () => {
    const dependencies = buildDependencies({
      createIssue: vi.fn().mockRejectedValue(new Error('Field \'customfield_50001\' is required.')),
    });

    const outcome = await runSplitCommit(buildDiff(), dependencies);

    expect(outcome.items[0]).toEqual({
      scope: 'increment-1',
      status: 'failed',
      failureReason: 'Field \'customfield_50001\' is required.',
    });
    expect(outcome.isFullySuccessful).toBe(false);
  });

  it('does not attempt a link for an increment that was never created', async () => {
    const dependencies = buildDependencies({
      createIssue: vi.fn().mockRejectedValue(new Error('rejected')),
    });

    await runSplitCommit(buildDiff(), dependencies);

    expect(dependencies.createIssueLink).not.toHaveBeenCalled();
  });

  it('still creates the other increments — one bad field must not deny the PO the rest', async () => {
    const dependencies = buildDependencies({
      createIssue: vi.fn()
        .mockRejectedValueOnce(new Error('rejected'))
        .mockResolvedValueOnce({ id: '2', key: 'ABC-3', self: '' }),
    });
    const diff = buildDiff({
      creates: [
        { localId: 'increment-1', projectKey: 'ABC', issueTypeId: '10001', summary: 'One', fields: {} },
        { localId: 'increment-2', projectKey: 'ABC', issueTypeId: '10001', summary: 'Two', fields: {} },
      ],
      links: [],
    });

    const outcome = await runSplitCommit(diff, dependencies);

    expect(outcome.createdKeysByLocalId).toEqual({ 'increment-2': 'ABC-3' });
    expect(outcome.isFullySuccessful).toBe(false);
  });

  it('survives a rejection that carries no message', async () => {
    const dependencies = buildDependencies({ createIssue: vi.fn().mockRejectedValue('just a string') });

    const outcome = await runSplitCommit(buildDiff(), dependencies);

    expect(outcome.items[0].failureReason).toMatch(/without giving a reason/i);
  });
});

describe('runSplitCommit — a link fails (INV-5, INV-J4)', () => {
  it('NEVER throws — the increment already exists and must not be lost', async () => {
    const dependencies = buildDependencies({
      createIssueLink: vi.fn().mockRejectedValue(new Error('No issue link type \'relates to\' found.')),
    });

    await expect(runSplitCommit(buildDiff(), dependencies)).resolves.toBeDefined();
  });

  it('still reports the increment as created', async () => {
    const dependencies = buildDependencies({
      createIssueLink: vi.fn().mockRejectedValue(new Error('link type missing')),
    });

    const outcome = await runSplitCommit(buildDiff(), dependencies);

    expect(outcome.items[0]).toEqual({ scope: 'increment-1', status: 'created', jiraKey: 'ABC-2' });
    expect(outcome.createdKeysByLocalId).toEqual({ 'increment-1': 'ABC-2' });
  });

  it('explains that the issue exists but is unlinked, so the PO knows what to fix by hand', async () => {
    const dependencies = buildDependencies({
      createIssueLink: vi.fn().mockRejectedValue(new Error('link type missing')),
    });

    const outcome = await runSplitCommit(buildDiff(), dependencies);

    const linkOutcome = outcome.items.find((item) => item.scope === 'link:increment-1');
    expect(linkOutcome?.status).toBe('failed');
    expect(linkOutcome?.jiraKey).toBe('ABC-2');
    expect(linkOutcome?.failureReason).toContain('ABC-2 was created');
    expect(linkOutcome?.failureReason).toContain('linking it to ABC-1 failed');
  });

  it('marks the commit not fully successful, so the draft is retained for a retry (FR-045)', async () => {
    const dependencies = buildDependencies({
      createIssueLink: vi.fn().mockRejectedValue(new Error('link type missing')),
    });

    const outcome = await runSplitCommit(buildDiff(), dependencies);

    expect(outcome.isFullySuccessful).toBe(false);
  });
});

describe('runSplitCommit — nothing to do', () => {
  it('writes nothing for an empty plan', async () => {
    const dependencies = buildDependencies();

    const outcome = await runSplitCommit(buildDiff({ creates: [], links: [] }), dependencies);

    expect(dependencies.createIssue).not.toHaveBeenCalled();
    expect(dependencies.createIssueLink).not.toHaveBeenCalled();
    expect(outcome.items).toEqual([]);
    expect(outcome.isFullySuccessful).toBe(true);
  });
});
