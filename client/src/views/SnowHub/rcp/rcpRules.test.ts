// rcpRules.test.ts — The RCP production-change rules (GH #415): window, Director, approval, justification, lead time.

import { describe, expect, it } from 'vitest';

import {
  checkApprovalAttached,
  checkImplementationWindow,
  checkJustification,
  checkLeadTime,
  checkRequestedByIsDirector,
  describeCentralWindow,
  isRcpPeriodActive,
} from './rcpRules.ts';

// October 2026 is daylight time: Central Time is UTC-5. Friday 9 Oct 19:00 CT is 10 Oct 00:00 UTC.
const FRIDAY_7_30_PM_CT = '2026-10-10T00:30:00Z';
const SATURDAY_3_AM_CT = '2026-10-10T08:00:00Z';

describe('checkImplementationWindow', () => {
  it('passes a Friday-night window that holds implementation, validation and backout', () => {
    const result = checkImplementationWindow({ plannedStartUtc: FRIDAY_7_30_PM_CT, plannedEndUtc: SATURDAY_3_AM_CT, totalEstimateMinutes: 300 });

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Fri');
  });

  it('fails when the estimates do not fit inside the window', () => {
    const result = checkImplementationWindow({ plannedStartUtc: FRIDAY_7_30_PM_CT, plannedEndUtc: SATURDAY_3_AM_CT, totalEstimateMinutes: 500 });

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/8 hours 20 minutes/);
  });

  it('fails a Thursday-night start', () => {
    expect(checkImplementationWindow({ plannedStartUtc: '2026-10-09T00:30:00Z', plannedEndUtc: '2026-10-09T04:00:00Z', totalEstimateMinutes: 60 }).status)
      .toBe('fail');
  });

  it('fails work during the 5 AM – 7 PM CT blackout, even on a weekend', () => {
    expect(checkImplementationWindow({ plannedStartUtc: '2026-10-10T15:00:00Z', plannedEndUtc: '2026-10-10T17:00:00Z', totalEstimateMinutes: 60 }).status)
      .toBe('fail');
  });

  it('allows a Sunday-night window that ends before 5 AM Monday, but not after', () => {
    const sundayNight = { plannedStartUtc: '2026-10-12T00:00:00Z', totalEstimateMinutes: 60 };

    expect(checkImplementationWindow({ ...sundayNight, plannedEndUtc: '2026-10-12T09:30:00Z' }).status).toBe('pass');
    expect(checkImplementationWindow({ ...sundayNight, plannedEndUtc: '2026-10-12T10:30:00Z' }).status).toBe('fail');
  });

  it('treats an early-Saturday start as part of Friday night', () => {
    expect(checkImplementationWindow({ plannedStartUtc: '2026-10-10T06:00:00Z', plannedEndUtc: '2026-10-10T09:00:00Z', totalEstimateMinutes: 60 }).status)
      .toBe('pass');
  });

  it('asks for a person to check when there are no duration estimates', () => {
    expect(checkImplementationWindow({ plannedStartUtc: FRIDAY_7_30_PM_CT, plannedEndUtc: SATURDAY_3_AM_CT, totalEstimateMinutes: null }).status)
      .toBe('check');
  });

  it('cannot judge a change without planned dates', () => {
    expect(checkImplementationWindow({ plannedStartUtc: null, plannedEndUtc: null, totalEstimateMinutes: 60 }).status).toBe('fail');
  });
});

describe('checkRequestedByIsDirector', () => {
  const director = { sysId: 'user-dir', displayName: 'Lee, Jordan' };

  it('passes when Requested By is the CI\'s owner', () => {
    expect(checkRequestedByIsDirector(director, director).status).toBe('pass');
  });

  it('asks for confirmation when Requested By is someone other than the CI owner', () => {
    const result = checkRequestedByIsDirector({ sysId: 'user-pat', displayName: 'Smith, Pat' }, director);

    expect(result.status).toBe('check');
    expect(result.detail).toContain('Lee, Jordan');
  });

  it('fails when nobody is listed in Requested By', () => {
    expect(checkRequestedByIsDirector({ sysId: '', displayName: '' }, director).status).toBe('fail');
  });

  it('asks for confirmation when the CI owner could not be read', () => {
    expect(checkRequestedByIsDirector(director, null).status).toBe('check');
  });
});

describe('checkApprovalAttached', () => {
  it('passes when an email or PDF is attached, and names it', () => {
    const result = checkApprovalAttached(['notes.txt', 'Director approval.msg']);

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Director approval.msg');
  });

  it('fails with no email or PDF attached', () => {
    expect(checkApprovalAttached(['screenshot.png']).status).toBe('fail');
  });

  it('cannot judge attachments it could not read', () => {
    expect(checkApprovalAttached(null).status).toBe('check');
  });
});

describe('checkJustification', () => {
  it('passes a justification covering why now, the cost of waiting, and the time-sensitive need', () => {
    const result = checkJustification(
      'Must deploy during RCP: delaying until after Jan 19 leaves 4,000 members with wrong premiums. Regulatory deadline Nov 1.',
    );

    expect(result.status).toBe('pass');
  });

  it('names the parts that are missing', () => {
    const result = checkJustification('Fixes the LIS mismatch.');

    expect(result.status).toBe('check');
    expect(result.detail).toMatch(/why it must happen during RCP/);
    expect(result.detail).toMatch(/impact of waiting/);
  });

  it('fails an empty justification', () => {
    expect(checkJustification('  ').status).toBe('fail');
  });
});

describe('checkLeadTime', () => {
  it('passes a Moderate change submitted three business days ahead', () => {
    expect(checkLeadTime({ riskLabel: 'Moderate', todayIso: '2026-10-05', plannedStartUtc: FRIDAY_7_30_PM_CT }).status).toBe('pass');
  });

  it('fails a High change submitted two business days ahead', () => {
    const result = checkLeadTime({ riskLabel: '2 - High', todayIso: '2026-10-06', plannedStartUtc: FRIDAY_7_30_PM_CT });

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/2 business days/);
  });

  it('does not apply to a Low-risk change', () => {
    expect(checkLeadTime({ riskLabel: 'Low', todayIso: '2026-10-08', plannedStartUtc: FRIDAY_7_30_PM_CT }).status).toBe('pass');
  });

  it('asks for a check when the risk is not known yet', () => {
    expect(checkLeadTime({ riskLabel: '', todayIso: '2026-10-05', plannedStartUtc: FRIDAY_7_30_PM_CT }).status).toBe('check');
  });
});

describe('isRcpPeriodActive', () => {
  it('is on through 19 January 2027 when enabled, and never when switched off', () => {
    expect(isRcpPeriodActive(true, '2027-01-19')).toBe(true);
    expect(isRcpPeriodActive(true, '2027-01-20')).toBe(false);
    expect(isRcpPeriodActive(false, '2026-10-08')).toBe(false);
  });
});

describe('describeCentralWindow', () => {
  it('words a planned window in Central Time, with the date', () => {
    expect(describeCentralWindow(FRIDAY_7_30_PM_CT, SATURDAY_3_AM_CT)).toBe('Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT');
    expect(describeCentralWindow(null, SATURDAY_3_AM_CT)).toBe('');
  });
});
