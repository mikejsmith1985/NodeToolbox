// modifyLoad.test.ts — Proves a modify reads the change's state, window, tasks and snapshot, and spots a closed change.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { fetchChangeTaskRecords } from '../../views/SnowHub/chgFormula/ctaskReviewApi.ts';
import { fetchChangeForModify, fetchChangeSnapshot, fetchExistingTaskNames, normalizeChangeNumber } from './modifyLoad.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/chgFormula/ctaskReviewApi.ts', () => ({ fetchChangeTaskRecords: vi.fn() }));

const CHANGE_RECORD = {
  sys_id: { value: 'sys-1', display_value: 'sys-1' },
  number: { value: 'CHG0001', display_value: 'CHG0001' },
  state: { value: '-5', display_value: 'New' },
  short_description: { value: 'Payments 1.2', display_value: 'Payments 1.2' },
  start_date: { value: '2026-11-02 01:00:00', display_value: '11/01/2026 20:00:00' },
  end_date: { value: '', display_value: '' },
};

describe('normalizeChangeNumber', () => {
  it('tidies a typed number and refuses anything else', () => {
    expect(normalizeChangeNumber(' chg0001 ')).toBe('CHG0001');
    expect(normalizeChangeNumber('PRB0001')).toBeNull();
  });
});

describe('fetchChangeForModify', () => {
  beforeEach(() => vi.mocked(snowFetch).mockReset());

  it('reads the state, window and snapshot of an editable change', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [CHANGE_RECORD] } as never);
    const loadedChange = await fetchChangeForModify('CHG0001');
    expect(loadedChange).toMatchObject({ changeSysId: 'sys-1', stateLabel: 'New', isEditable: true, plannedEndInput: '' });
    expect(loadedChange.plannedStartInput).toMatch(/^2026-11-0[12]T\d{2}:00$/);
    expect(loadedChange.snapshot.short_description).toBe('Payments 1.2');
  });

  it('marks a closed change as not editable', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ ...CHANGE_RECORD, state: { value: '3', display_value: 'Closed' } }] } as never);
    expect((await fetchChangeForModify('CHG0001')).isEditable).toBe(false);
  });

  it('says plainly when ServiceNow has no such change', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [] } as never);
    await expect(fetchChangeForModify('CHG0404')).rejects.toThrow('ServiceNow has no change CHG0404.');
  });

  it('re-reads only the snapshot before a save', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [CHANGE_RECORD] } as never);
    expect((await fetchChangeSnapshot('CHG0001')).short_description).toBe('Payments 1.2');
  });
});

describe('fetchExistingTaskNames', () => {
  it('names each task the change already has, and none when they cannot be read', async () => {
    vi.mocked(fetchChangeTaskRecords).mockResolvedValueOnce([{ number: 'CTASK1', short_description: 'Business Checkout' }]);
    expect(await fetchExistingTaskNames('sys-1')).toEqual(['CTASK1 — Business Checkout']);
    vi.mocked(fetchChangeTaskRecords).mockRejectedValueOnce(new Error('403'));
    expect(await fetchExistingTaskNames('sys-1')).toEqual([]);
  });
});
