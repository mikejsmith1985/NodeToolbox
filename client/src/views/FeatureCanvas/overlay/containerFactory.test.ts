// containerFactory.test.ts — Verifies provisional container construction and titling.

import { describe, expect, it } from 'vitest';

import { createProvisionalContainer } from './containerFactory.ts';

describe('createProvisionalContainer', () => {
  it('builds a provisional sprint with a default title and a budget', () => {
    const container = createProvisionalContainer('sprint', 0);
    expect(container.kind).toBe('sprint');
    expect(container.title).toBe('New sprint');
    expect(container.capacityBudget).toBe(20);
    expect(container.provenance.state).toBe('provisional');
  });

  it('uses a supplied title (trimmed) when given — e.g. from AI Sprint grouping', () => {
    expect(createProvisionalContainer('sprint', 0, '  Sprint 25  ').title).toBe('Sprint 25');
  });

  it('builds a release with no default budget', () => {
    const container = createProvisionalContainer('release', 1);
    expect(container.kind).toBe('release');
    expect(container.capacityBudget).toBeNull();
  });

  it('tiles successive boxes across the band by existing count', () => {
    expect(createProvisionalContainer('sprint', 0).bounds.x).toBe(40);
    expect(createProvisionalContainer('sprint', 1).bounds.x).toBe(480);
  });
});
