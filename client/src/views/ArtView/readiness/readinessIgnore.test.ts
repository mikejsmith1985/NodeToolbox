// readinessIgnore.test.ts — Unit tests for the per-user readiness ignore list.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  readReadinessIgnore,
  ignoreReadinessProject,
  restoreReadinessProject,
  ignoreReadinessFeature,
  restoreReadinessFeature,
  clearReadinessIgnore,
  readProjectKeyFromFeatureKey,
  applyReadinessFeatureIgnore,
} from './readinessIgnore.ts';
import type { JiraIssue } from '../../../types/jira.ts';

beforeEach(() => window.localStorage.clear());

describe('readReadinessIgnore', () => {
  it('returns empty lists when nothing is stored', () => {
    expect(readReadinessIgnore()).toEqual({ ignoredProjectKeys: [], ignoredFeatureKeys: [] });
  });

  it('treats corrupt storage as nothing ignored', () => {
    window.localStorage.setItem('tbxReadinessIgnored', '{not json');
    expect(readReadinessIgnore()).toEqual({ ignoredProjectKeys: [], ignoredFeatureKeys: [] });
  });
});

describe('ignore / restore projects', () => {
  it('adds a normalized (uppercase) project key and persists it', () => {
    const state = ignoreReadinessProject('encuc');
    expect(state.ignoredProjectKeys).toEqual(['ENCUC']);
    expect(readReadinessIgnore().ignoredProjectKeys).toEqual(['ENCUC']);
  });

  it('does not duplicate an already-ignored project', () => {
    ignoreReadinessProject('ENCUC');
    const state = ignoreReadinessProject('encuc');
    expect(state.ignoredProjectKeys).toEqual(['ENCUC']);
  });

  it('restores a project', () => {
    ignoreReadinessProject('ENCUC');
    const state = restoreReadinessProject('ENCUC');
    expect(state.ignoredProjectKeys).toEqual([]);
  });
});

describe('ignore / restore features', () => {
  it('adds a normalized (uppercase) feature key and persists it', () => {
    const state = ignoreReadinessFeature('encuc-2163');
    expect(state.ignoredFeatureKeys).toEqual(['ENCUC-2163']);
    expect(readReadinessIgnore().ignoredFeatureKeys).toEqual(['ENCUC-2163']);
  });

  it('restores a feature', () => {
    ignoreReadinessFeature('ENCUC-2163');
    const state = restoreReadinessFeature('ENCUC-2163');
    expect(state.ignoredFeatureKeys).toEqual([]);
  });
});

describe('clearReadinessIgnore', () => {
  it('empties both lists', () => {
    ignoreReadinessProject('ENCUC');
    ignoreReadinessFeature('ENCUC-2163');
    const state = clearReadinessIgnore();
    expect(state).toEqual({ ignoredProjectKeys: [], ignoredFeatureKeys: [] });
  });
});

describe('readProjectKeyFromFeatureKey', () => {
  it('derives the uppercase project prefix from an issue key', () => {
    expect(readProjectKeyFromFeatureKey('ENCUC-2163')).toBe('ENCUC');
    expect(readProjectKeyFromFeatureKey('port-9')).toBe('PORT');
  });

  it('returns an empty string for a keyless value', () => {
    expect(readProjectKeyFromFeatureKey('')).toBe('');
  });
});

describe('applyReadinessFeatureIgnore', () => {
  function issue(key: string): JiraIssue {
    return { key, fields: {} } as unknown as JiraIssue;
  }

  it('drops issues whose key is ignored, case-insensitively', () => {
    const issues = [issue('ENCUC-1'), issue('ENCUC-2'), issue('PORT-9')];
    const kept = applyReadinessFeatureIgnore(issues, ['encuc-2']);
    expect(kept.map((keptIssue) => keptIssue.key)).toEqual(['ENCUC-1', 'PORT-9']);
  });

  it('returns every issue when nothing is ignored', () => {
    const issues = [issue('ENCUC-1')];
    expect(applyReadinessFeatureIgnore(issues, [])).toHaveLength(1);
  });
});
