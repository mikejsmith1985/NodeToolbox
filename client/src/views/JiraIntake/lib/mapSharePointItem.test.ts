// mapSharePointItem.test.ts — Covers mapping a SharePoint item (internal keys) to the display-keyed
// RawRow, including the reserved-id internal-name case and blank handling.

import { describe, expect, it } from 'vitest';

import { mapSharePointItem } from './mapSharePointItem.ts';

describe('mapSharePointItem', () => {
  it('maps each display column via its resolved internal name', () => {
    const fieldMap = new Map<string, string>([
      ['id', '_x0069_d'],          // reserved-id internal name differs from "id"
      ['submittedAt', 'submittedAt'],
      ['summary', 'summary'],
      ['project', 'project'],
      ['issueType', 'issueType'],
      ['priority', 'priority'],
    ]);
    const item = {
      _x0069_d: '2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503',
      submittedAt: '2026-07-01T16:07:25Z',
      summary: 'abc',
      project: 'Cleanup Crew',
      issueType: 'Story',
      priority: 'Medium',
      Title: 'ignored-system-field',
    };

    const row = mapSharePointItem(item, fieldMap);
    expect(row.id).toBe('2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503'); // reserved id resolved
    expect(row.summary).toBe('abc');
    expect(row.project).toBe('Cleanup Crew');
    expect(row.issueType).toBe('Story');
  });

  it('emits an empty string for null/absent values', () => {
    const fieldMap = new Map<string, string>([['id', 'id'], ['summary', 'summary'], ['priority', 'priority']]);
    const row = mapSharePointItem({ id: 'x', summary: null }, fieldMap);
    expect(row.summary).toBe('');
    expect(row.priority).toBe(''); // internal present in map but absent on item
  });

  it('skips display columns with no resolved internal name', () => {
    const fieldMap = new Map<string, string>([['id', 'id']]);
    const row = mapSharePointItem({ id: 'x' }, fieldMap);
    expect(row.id).toBe('x');
    expect(row.summary).toBeUndefined();
  });
});
