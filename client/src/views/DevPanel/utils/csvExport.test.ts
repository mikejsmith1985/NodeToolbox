// csvExport.test.ts — Verifies Dev Panel API activity can be exported as safe CSV.

import { describe, expect, it } from 'vitest';

import type { DevPanelEntry } from '../hooks/useDevPanelLog.ts';
import { buildCsv, sanitizeCell } from './csvExport.ts';

const SAMPLE_ENTRY: DevPanelEntry = {
  id: 'entry-1',
  timestamp: '2026-05-07T12:34:56.000Z',
  method: 'GET',
  url: '/rest/api/3/search',
  status: 200,
  durationMs: 125,
  errorMessage: null,
};

describe('buildCsv', () => {
  it('returns only the header row when there are no entries', () => {
    expect(buildCsv([])).toBe('timestamp,method,url,status,durationMs,error');
  });

  it('serializes Dev Panel entries in the expected column order', () => {
    expect(buildCsv([SAMPLE_ENTRY])).toBe([
      'timestamp,method,url,status,durationMs,error',
      '2026-05-07T12:34:56.000Z,GET,/rest/api/3/search,200,125,',
    ].join('\n'));
  });

  it('quotes cells that contain commas', () => {
    const csvText = buildCsv([{ ...SAMPLE_ENTRY, url: '/rest/api/3/search?jql=project = TBX, order by rank' }]);

    expect(csvText).toContain('"/rest/api/3/search?jql=project = TBX, order by rank"');
  });

  it('quotes cells that contain quotes', () => {
    const csvText = buildCsv([{ ...SAMPLE_ENTRY, errorMessage: 'Jira said "no"' }]);

    expect(csvText).toContain('"Jira said ""no"""');
  });

  it('quotes cells that contain newlines', () => {
    const csvText = buildCsv([{ ...SAMPLE_ENTRY, errorMessage: 'first line\nsecond line' }]);

    expect(csvText).toContain('"first line\nsecond line"');
  });

  it('writes blank status and error cells for network failures without an HTTP response', () => {
    const csvText = buildCsv([{ ...SAMPLE_ENTRY, status: null, errorMessage: 'Network unavailable' }]);

    expect(csvText).toContain('/rest/api/3/search,,125,Network unavailable');
  });
});

describe('sanitizeCell', () => {
  it('doubles internal quotes to follow CSV escaping rules', () => {
    expect(sanitizeCell('Jira said "retry"')).toBe('"Jira said ""retry"""');
  });

  it('does not quote plain cells', () => {
    expect(sanitizeCell('GET')).toBe('GET');
  });
});
