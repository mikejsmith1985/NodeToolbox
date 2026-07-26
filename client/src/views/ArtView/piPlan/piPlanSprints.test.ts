// piPlanSprints.test.ts — Ensures existing sprints are reused and only missing ones are created once (US4).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBoardSprints: vi.fn(),
  createSprint: vi.fn(),
}));
vi.mock('../../../services/jiraApi.ts', () => ({ getBoardSprints: mocks.getBoardSprints, createSprint: mocks.createSprint }));

import { ensureSprints } from './piPlanSprints.ts';
import type { DesiredSprint } from './piPlanSprints.ts';

const DESIRED: DesiredSprint[] = [
  { name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03' },
  { name: '26.3.2', startIso: '2026-06-04', endIso: '2026-06-17' },
];

beforeEach(() => vi.clearAllMocks());

describe('ensureSprints', () => {
  it('reuses an existing sprint and creates only the missing one', async () => {
    mocks.getBoardSprints.mockResolvedValue([{ id: 100, name: '26.3.1', state: 'future' }]);
    mocks.createSprint.mockResolvedValue({ id: 200, name: '26.3.2' });

    const result = await ensureSprints(DESIRED, 42);

    expect(mocks.createSprint).toHaveBeenCalledTimes(1);
    expect(mocks.createSprint).toHaveBeenCalledWith({ name: '26.3.2', originBoardId: 42, startDate: '2026-06-04', endDate: '2026-06-17' });
    expect(result.idByName).toEqual({ '26.3.1': 100, '26.3.2': 200 });
    expect(result.createdNames).toEqual(['26.3.2']);
  });

  it('creates nothing on a re-run where every sprint already exists (idempotent)', async () => {
    mocks.getBoardSprints.mockResolvedValue([
      { id: 100, name: '26.3.1', state: 'future' },
      { id: 200, name: '26.3.2', state: 'future' },
    ]);
    const result = await ensureSprints(DESIRED, 42);
    expect(mocks.createSprint).not.toHaveBeenCalled();
    expect(result.createdNames).toEqual([]);
  });

  it('dry run reports would-create names without writing', async () => {
    mocks.getBoardSprints.mockResolvedValue([]);
    const result = await ensureSprints(DESIRED, 42, { dryRun: true });
    expect(mocks.createSprint).not.toHaveBeenCalled();
    expect(result.createdNames).toEqual(['26.3.1', '26.3.2']);
  });
});
