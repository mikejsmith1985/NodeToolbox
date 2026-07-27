// componentClassificationStore.test.ts — The repo/domain classification store (spec 031, US1).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  classifyComponent,
  clearComponentClassification,
  getComponentKind,
  isDomainComponent,
  isRepoComponent,
  repoAllowlist,
  useComponentClassificationStore,
} from './componentClassificationStore.ts';

beforeEach(() => {
  window.localStorage.clear();
  useComponentClassificationStore.setState({ classifications: {} });
});

describe('componentClassificationStore', () => {
  it('classifies, reads back, and reports unclassified as null (never guessed)', () => {
    classifyComponent('payments-api', 'repo');
    expect(getComponentKind('payments-api')).toBe('repo');
    expect(isRepoComponent('payments-api')).toBe(true);
    // A component never classified is null — not inferred from its name.
    expect(getComponentKind('Enrollment')).toBeNull();
  });

  it('is case-insensitive on the name identity', () => {
    classifyComponent('Payments-API', 'repo');
    expect(getComponentKind('payments-api')).toBe('repo');
    expect(getComponentKind('PAYMENTS-API')).toBe('repo');
  });

  it('re-classifying overwrites the prior kind', () => {
    classifyComponent('Enrollment', 'repo');
    expect(isRepoComponent('Enrollment')).toBe(true);
    classifyComponent('Enrollment', 'domain');
    expect(isRepoComponent('Enrollment')).toBe(false);
    expect(isDomainComponent('Enrollment')).toBe(true);
  });

  it('clearing a classification returns it to unclassified', () => {
    classifyComponent('ui-web', 'repo');
    clearComponentClassification('ui-web');
    expect(getComponentKind('ui-web')).toBeNull();
  });

  it('repoAllowlist returns only repo-classified display names', () => {
    classifyComponent('payments-api', 'repo');
    classifyComponent('ui-web', 'repo');
    classifyComponent('Enrollment', 'domain');
    expect(repoAllowlist().sort()).toEqual(['payments-api', 'ui-web']);
  });

  it('persists to the tbxComponentClassification key', () => {
    classifyComponent('payments-api', 'repo');
    const stored = JSON.parse(window.localStorage.getItem('tbxComponentClassification') ?? '{}');
    expect(stored['payments-api']).toEqual({ displayName: 'payments-api', kind: 'repo' });
  });
});
