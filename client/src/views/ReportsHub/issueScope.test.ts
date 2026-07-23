// issueScope.test.ts — Unit tests for the one question both reports must answer identically:
// does this issue count as a deliverable in its own right?
//
// Two properties matter more than the rest.
//
// The BOOLEAN decides, never the name. "Sub-task", "Subtask", "Sub-Task" and freely-named custom
// sub-task types all exist, and this Jira instance already renames standard types (it uses "Defect",
// not "Bug"). A name check would fail silently on exactly the teams that customise their workflow.
//
// An unreadable type COUNTS. Treating it as a sub-task would delete a named person's real work on the
// strength of a missing field — over-counting is visible and arguable, silent deletion is neither.

import { describe, expect, it } from 'vitest';

import { classifyIssueScope } from './issueScope.ts';

describe('classifyIssueScope — the boolean decides', () => {
  it('classifies a sub-task by its flag', () => {
    expect(classifyIssueScope({ subtask: true, name: 'Sub-task' })).toBe('sub-task');
  });

  it('classifies a custom sub-task type by its flag, whatever it is called', () => {
    expect(classifyIssueScope({ subtask: true, name: 'Engineering Activity' })).toBe('sub-task');
  });

  it('counts a real deliverable', () => {
    expect(classifyIssueScope({ subtask: false, name: 'Story' })).toBe('countable');
    expect(classifyIssueScope({ subtask: false, name: 'Defect' })).toBe('countable');
  });

  it('does NOT let the type name decide', () => {
    // A type named "Sub-task" that Jira does not flag as one is a real issue type. Trusting the name
    // here would silently drop deliverables from a team that named a top-level type unluckily.
    expect(classifyIssueScope({ subtask: false, name: 'Sub-task' })).toBe('countable');
  });
});

describe('classifyIssueScope — honest uncertainty', () => {
  it('reports an absent issue type as unknown rather than guessing', () => {
    expect(classifyIssueScope(undefined)).toBe('unknown-type');
    expect(classifyIssueScope(null)).toBe('unknown-type');
  });

  it('reports a missing subtask flag as unknown', () => {
    expect(classifyIssueScope({ name: 'Story' })).toBe('unknown-type');
  });

  it('reports a non-boolean subtask value as unknown rather than coercing it', () => {
    // Coercing a truthy string would classify a real Story as a sub-task and delete it from the figures.
    expect(classifyIssueScope({ subtask: 'true' as unknown as boolean, name: 'Story' })).toBe('unknown-type');
  });
});

describe('classifyIssueScope — purity', () => {
  it('returns the same verdict every time for the same input', () => {
    const issueType = { subtask: true, name: 'Sub-task' };

    expect(classifyIssueScope(issueType)).toBe(classifyIssueScope(issueType));
  });

  it('does not mutate what it is given', () => {
    const issueType = { subtask: false, name: 'Story' };
    const snapshot = JSON.stringify(issueType);

    classifyIssueScope(issueType);

    expect(JSON.stringify(issueType)).toBe(snapshot);
  });
});

// ── SC-005: both reports reach the same verdict ──────────────────────────────

describe('both flow reports agree about the same issue', () => {
  it('reaches one verdict per issue, because both consume this one function', () => {
    // The assertion that justifies a shared predicate instead of a check in each report. Two
    // independent checks would eventually diverge, and the two reports would then disagree about
    // whether an issue counted — with nothing on either page to show which was right.
    const fixtures = [
      { subtask: true, name: 'Sub-task' },
      { subtask: false, name: 'Story' },
      { subtask: true, name: 'Engineering Activity' },
      { name: 'Mystery' },
    ];

    // The Personal Workflow tab feeds this verdict to the engine as `scopeVerdict`; the Flow Analysis
    // tab uses it to drop issues before stage building. Same call, same answer, by construction.
    const personalWorkflowVerdicts = fixtures.map((issueType) => classifyIssueScope(issueType));
    const flowAnalysisVerdicts = fixtures.map((issueType) => classifyIssueScope(issueType));

    expect(personalWorkflowVerdicts).toEqual(flowAnalysisVerdicts);
    expect(personalWorkflowVerdicts).toEqual(['sub-task', 'countable', 'sub-task', 'unknown-type']);
  });
});
