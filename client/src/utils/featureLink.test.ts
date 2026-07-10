// featureLink.test.ts — Verifies the shared feature-link resolution (candidate order, value shapes, config).

import { afterEach, describe, expect, it } from 'vitest';

import {
  EPIC_LINK_FIELD,
  FEATURE_LINK_DEFAULT_FIELD,
  extractFeatureKeyFromIssueFields,
  extractIssueKeyFromLinkValue,
  featureLinkCandidateFieldIds,
  loadConfiguredFeatureLinkFieldId,
} from './featureLink.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

describe('extractIssueKeyFromLinkValue', () => {
  it('reads a bare key string', () => {
    expect(extractIssueKeyFromLinkValue('ENCUC-42')).toBe('ENCUC-42');
  });

  it('reads the key from each object shape Jira uses', () => {
    expect(extractIssueKeyFromLinkValue({ key: 'ENCUC-1' })).toBe('ENCUC-1');
    expect(extractIssueKeyFromLinkValue({ data: { key: 'ENCUC-2' } })).toBe('ENCUC-2');
    expect(extractIssueKeyFromLinkValue({ inwardIssue: { key: 'ENCUC-3' } })).toBe('ENCUC-3');
  });

  it('returns null for a non-key string, null, or an unrecognised object', () => {
    expect(extractIssueKeyFromLinkValue('nokey')).toBeNull();
    expect(extractIssueKeyFromLinkValue(null)).toBeNull();
    expect(extractIssueKeyFromLinkValue({ foo: 'bar' })).toBeNull();
  });
});

describe('featureLinkCandidateFieldIds', () => {
  it('leads with the configured field, then the defaults, de-duplicated', () => {
    expect(featureLinkCandidateFieldIds('customfield_99999')).toEqual([
      'customfield_99999', FEATURE_LINK_DEFAULT_FIELD, EPIC_LINK_FIELD,
    ]);
    // When the configured field IS a default, it is not repeated.
    expect(featureLinkCandidateFieldIds(FEATURE_LINK_DEFAULT_FIELD)).toEqual([FEATURE_LINK_DEFAULT_FIELD, EPIC_LINK_FIELD]);
  });
});

describe('extractFeatureKeyFromIssueFields', () => {
  it('prefers the configured feature-link field over Epic Link and parent', () => {
    const fields = {
      customfield_77777: { key: 'FEAT-1' },
      [EPIC_LINK_FIELD]: 'EPIC-9',
      parent: { key: 'PARENT-9' },
    };
    expect(extractFeatureKeyFromIssueFields(fields, 'customfield_77777')).toBe('FEAT-1');
  });

  it('falls back to Epic Link, then to the native parent, when the feature-link field is empty', () => {
    expect(extractFeatureKeyFromIssueFields({ [EPIC_LINK_FIELD]: 'EPIC-2' }, 'customfield_77777')).toBe('EPIC-2');
    expect(extractFeatureKeyFromIssueFields({ parent: { key: 'PARENT-2' } }, 'customfield_77777')).toBe('PARENT-2');
  });

  it('returns null when no feature link and no parent are present', () => {
    expect(extractFeatureKeyFromIssueFields({}, 'customfield_77777')).toBeNull();
  });
});

describe('loadConfiguredFeatureLinkFieldId', () => {
  afterEach(() => localStorage.removeItem(ART_SETTINGS_STORAGE_KEY));

  it('returns the default when no override is stored', () => {
    expect(loadConfiguredFeatureLinkFieldId()).toBe(FEATURE_LINK_DEFAULT_FIELD);
  });

  it('returns the ART settings override when present', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ featureLinkField: 'customfield_12345' }));
    expect(loadConfiguredFeatureLinkFieldId()).toBe('customfield_12345');
  });

  it('falls back to the default on a corrupt store', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadConfiguredFeatureLinkFieldId()).toBe(FEATURE_LINK_DEFAULT_FIELD);
  });
});
