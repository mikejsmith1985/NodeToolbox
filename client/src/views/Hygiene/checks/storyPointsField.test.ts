// storyPointsField.test.ts — One answer to "where do story points live", for the check and the fix.
//
// Forty-one issues that plainly had story points were reported as missing them, because the scan
// read customfield_10028 while this instance keeps them in customfield_10236 (GH #375).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveStoryPointsFieldIds, resolveStoryPointsWriteFieldId } from './storyPointsField.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('resolveStoryPointsFieldIds', () => {
  it('uses the field the ART settings screen selected', () => {
    // The case that caused the false positives: the operator chose Story Points Selection there,
    // and nothing in the hygiene path had ever looked at it.
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_10236' }));

    expect(resolveStoryPointsFieldIds('story_points')[0]).toBe('customfield_10236');
  });

  it('ignores the placeholder the dashboard config ships with', () => {
    // `story_points` is the default and is not a Jira field id, so it must not win, and must not be
    // mistaken for "a field is configured" either.
    expect(resolveStoryPointsFieldIds('story_points')).not.toContain('story_points');
  });

  it('prefers a real field named by the dashboard config over the ART settings one', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_10236' }));

    expect(resolveStoryPointsFieldIds('customfield_11111')[0]).toBe('customfield_11111');
  });

  it('still lists the other candidates, since points in a legacy field are still points', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_10236' }));

    const fieldIds = resolveStoryPointsFieldIds('story_points');

    expect(fieldIds).toContain('customfield_10028');
    expect(fieldIds).toContain('customfield_10016');
  });

  it('falls back to the built-ins when nothing is configured anywhere', () => {
    expect(resolveStoryPointsFieldIds('')).toEqual(['customfield_10028', 'customfield_10016']);
  });

  it('lists each field once', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_10028' }));

    const fieldIds = resolveStoryPointsFieldIds('customfield_10028');

    expect(fieldIds.filter((fieldId) => fieldId === 'customfield_10028')).toHaveLength(1);
  });

  it('survives ART settings that are not readable', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, 'not json');

    expect(resolveStoryPointsFieldIds('')).toEqual(['customfield_10028', 'customfield_10016']);
  });
});

describe('resolveStoryPointsWriteFieldId', () => {
  it('writes to the field the check reads first', () => {
    // A write landing anywhere else clears nothing the user can see.
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_10236' }));

    expect(resolveStoryPointsWriteFieldId('story_points')).toBe('customfield_10236');
  });
});
