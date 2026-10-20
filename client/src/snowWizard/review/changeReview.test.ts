// changeReview.test.ts — Proves a review runs the shared readiness checks on the change and gathers who to coach.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatherChangeReadinessFacts, type GatheredChangeReadiness } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import type { ChangeReadinessFacts } from '../../views/SnowHub/guided/changeReadiness.ts';
import { readChangeRequester } from './changeRequester.ts';
import { runChangeReview } from './changeReview.ts';

vi.mock('../../views/SnowHub/guided/changeReadinessFacts.ts', () => ({ gatherChangeReadinessFacts: vi.fn() }));
vi.mock('./changeRequester.ts', () => ({ readChangeRequester: vi.fn() }));

const mockedGather = vi.mocked(gatherChangeReadinessFacts);
const mockedReadRequester = vi.mocked(readChangeRequester);

/** Facts for a change that was read but has nothing else known. */
function buildFacts(overrides: Partial<ChangeReadinessFacts>): ChangeReadinessFacts {
  return {
    change: { changeNumber: 'CHG0012345', stateLabel: 'Assess', ownerName: 'Owner, Olly', configItemName: 'Portal' },
    textFields: null, isProduction: false, plannedWindow: null, riskReview: null, isRcpActive: false, rcpChecks: [],
    outageCount: 0, ctasks: [], prbs: [], attachmentFileNames: [], failureReasons: {},
    ...overrides,
  };
}

function buildGathered(facts: ChangeReadinessFacts): GatheredChangeReadiness {
  return { facts, changeSysId: 'abc', issueKeys: [] };
}

beforeEach(() => {
  mockedGather.mockReset();
  mockedReadRequester.mockReset();
});

describe('runChangeReview', () => {
  it('passes no risk review and the given RCP settings to the shared gatherer, and builds the checklist', async () => {
    mockedGather.mockResolvedValue(buildGathered(buildFacts({})));
    mockedReadRequester.mockResolvedValue({ name: 'Smith, Jane', email: 'jane@example.com' });

    const review = await runChangeReview(' CHG0012345 ', { todayIso: '2026-10-20', isRcpRulesEnabled: false });

    expect(mockedGather).toHaveBeenCalledWith('CHG0012345', { riskReview: null, isRcpRulesEnabled: false, todayIso: '2026-10-20' });
    expect(review.isChangeFound).toBe(true);
    expect(review.items.length).toBeGreaterThan(0);
    expect(review.coachingChange).toEqual({ number: 'CHG0012345', creatorName: 'Smith, Jane', shortDescription: '' });
    expect(review.requesterEmail).toBe('jane@example.com');
  });

  it('leaves out the author-only risk check, so a sound change can still be ready', async () => {
    mockedGather.mockResolvedValue(buildGathered(buildFacts({})));
    mockedReadRequester.mockResolvedValue({ name: '', email: '' });

    const review = await runChangeReview('CHG0012345', { todayIso: '2026-10-20', isRcpRulesEnabled: false });

    expect(review.items.map((item) => item.id)).not.toContain('riskCheck');
  });

  it('coaches the owner by name when no requester is known, and uses the change\'s own summary', async () => {
    mockedGather.mockResolvedValue(buildGathered(buildFacts({
      textFields: { shortDescription: 'Login fix', description: '', justification: '', riskImpact: '', implementationPlan: '', testPlan: '', backoutPlan: '' },
    })));
    mockedReadRequester.mockResolvedValue({ name: '', email: '' });

    const review = await runChangeReview('CHG0012345', { todayIso: '2026-10-20', isRcpRulesEnabled: true });

    expect(review.coachingChange.creatorName).toBe('Owner, Olly');
    expect(review.coachingChange.shortDescription).toBe('Login fix');
  });

  it('reports a change that could not be found', async () => {
    mockedGather.mockResolvedValue(buildGathered(buildFacts({ change: null })));
    mockedReadRequester.mockResolvedValue({ name: '', email: '' });

    const review = await runChangeReview('CHG404', { todayIso: '2026-10-20', isRcpRulesEnabled: true });

    expect(review.isChangeFound).toBe(false);
  });
});
