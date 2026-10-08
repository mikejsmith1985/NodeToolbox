// changeOutageRecord.test.ts — Reading, checking and creating a change's outage record (a CHG was rejected without one).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import {
  buildPlannedOutagePayload,
  checkOutageRule,
  createPlannedOutage,
  fetchChangeOutages,
  toSnowUtcDateTime,
} from './changeOutageRecord.ts';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const OUTAGE_INPUT = {
  changeSysId: 'chg-1',
  configItemSysId: 'ci-recon',
  shortDescription: 'Recon | deploy v1.5 | PROD',
  plannedStartUtc: '2026-10-10T05:00',
  plannedEndUtc: '2026-10-10T07:00',
};

describe('fetchChangeOutages', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('reads the outage records linked to the change', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [{
      sys_id: { value: 'out-1', display_value: 'out-1' },
      number: { value: 'OUT0001234', display_value: 'OUT0001234' },
      type: { value: 'planned', display_value: 'Planned' },
      begin: { value: '2026-10-10 05:00:00', display_value: '2026-10-10 00:00:00' },
      end: { value: '2026-10-10 07:00:00', display_value: '2026-10-10 02:00:00' },
    }] });

    const outages = await fetchChangeOutages('chg-1');

    expect(outages).toEqual([{ sysId: 'out-1', number: 'OUT0001234', typeLabel: 'Planned', beginLabel: '2026-10-10 00:00:00', endLabel: '2026-10-10 02:00:00' }]);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('/api/now/table/cmdb_ci_outage?sysparm_query=task_number%3Dchg-1');
  });
});

describe('buildPlannedOutagePayload', () => {
  it('fills a planned outage from the change: its CI, its window and its short description, linked to it', () => {
    expect(buildPlannedOutagePayload(OUTAGE_INPUT)).toEqual({
      task_number: 'chg-1',
      cmdb_ci: 'ci-recon',
      type: 'planned',
      begin: '2026-10-10 05:00:00',
      end: '2026-10-10 07:00:00',
      short_description: 'Planned outage for Recon | deploy v1.5 | PROD',
    });
  });

  it('writes the form\'s UTC date-time in the format the Table API stores', () => {
    expect(toSnowUtcDateTime('2026-10-10T05:00')).toBe('2026-10-10 05:00:00');
    // The change builder's own API format passes straight through.
    expect(toSnowUtcDateTime('2026-10-10 05:00:00')).toBe('2026-10-10 05:00:00');
    expect(toSnowUtcDateTime('')).toBe('');
  });
});

describe('createPlannedOutage', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('creates the record and returns its number', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'OUT0005678' } });

    expect(await createPlannedOutage(OUTAGE_INPUT)).toBe('OUT0005678');
    expect(vi.mocked(snowFetch)).toHaveBeenCalledWith('/api/now/table/cmdb_ci_outage', expect.objectContaining({ method: 'POST' }));
  });

  it('refuses to create an outage without a CI or a planned window, rather than an incomplete record', async () => {
    await expect(createPlannedOutage({ ...OUTAGE_INPUT, plannedStartUtc: '' })).rejects.toThrow(/planned start and end/);
    await expect(createPlannedOutage({ ...OUTAGE_INPUT, configItemSysId: '' })).rejects.toThrow(/configuration item/);
    expect(snowFetch).not.toHaveBeenCalled();
  });
});

describe('checkOutageRule', () => {
  it('flags a Production change with no outage record — CAB will not approve it', () => {
    expect(checkOutageRule(true, [])).toEqual([expect.objectContaining({ status: 'RECORD', field: 'Outage Record' })]);
  });

  it('passes a Production change that has one, and says nothing for a non-Production change', () => {
    const outage = { sysId: 'out-1', number: 'OUT0001234', typeLabel: 'Planned', beginLabel: '', endLabel: '' };

    expect(checkOutageRule(true, [outage])).toEqual([expect.objectContaining({ status: 'PASS', field: 'Outage Record' })]);
    expect(checkOutageRule(false, [])).toEqual([]);
  });
});
