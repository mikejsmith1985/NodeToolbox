// issueLinking.test.ts — Type-shape tests for issueLinking.ts.
//
// TypeScript type-only files can't have runtime behavior tests; we validate that
// the exported types are structurally correct by constructing well-typed objects.
// If the types change in a breaking way, these assignments will produce tsc errors.

import { describe, expect, it } from 'vitest';
import type { HealthStatus, StatusMapping, LinkedIssuePair } from './issueLinking.ts';
import type { JiraIssue } from './jira.ts';
import type { SnowMyIssue } from './snow.ts';

// ── Type shape validation ──

describe('issueLinking types', () => {
  it('HealthStatus accepts the three allowed values', () => {
    const greenStatus: HealthStatus = 'green';
    const yellowStatus: HealthStatus = 'yellow';
    const redStatus: HealthStatus = 'red';

    // Runtime check — ensures values survive bundling.
    expect(['green', 'yellow', 'red']).toContain(greenStatus);
    expect(['green', 'yellow', 'red']).toContain(yellowStatus);
    expect(['green', 'yellow', 'red']).toContain(redStatus);
  });

  it('StatusMapping has required string fields and an isSystemDefined boolean', () => {
    const mapping: StatusMapping = {
      jiraStatus: 'In Progress',
      snowStatus: 'In Progress',
      isSystemDefined: false,
    };

    expect(mapping.jiraStatus).toBe('In Progress');
    expect(mapping.snowStatus).toBe('In Progress');
    expect(mapping.isSystemDefined).toBe(false);
  });

  it('StatusMapping can represent the system-defined To Do -> New entry', () => {
    const systemMapping: StatusMapping = {
      jiraStatus: 'To Do',
      snowStatus: 'New',
      isSystemDefined: true,
    };

    expect(systemMapping.isSystemDefined).toBe(true);
  });

  it('LinkedIssuePair has a pairId, health fields, and nested issue references', () => {
    // Minimal stubs — only the fields used by the type assertions.
    const stubJiraIssue = { key: 'TBX-1' } as unknown as JiraIssue;
    const stubSnowProblem = { sys_id: 'prb-001' } as unknown as SnowMyIssue;

    const pair: LinkedIssuePair = {
      pairId: 'TBX-1::prb-001',
      jiraIssue: stubJiraIssue,
      snowProblem: stubSnowProblem,
      healthStatus: 'yellow',
      matchingFieldCount: 1,
      totalMappedFieldCount: 2,
    };

    expect(pair.pairId).toBe('TBX-1::prb-001');
    expect(pair.healthStatus).toBe('yellow');
    expect(pair.matchingFieldCount).toBeLessThan(pair.totalMappedFieldCount);
  });
});
