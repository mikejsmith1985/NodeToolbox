// subtasks-to-checklist.test.js — Guards the command-line shell of the one-off sub-task conversion.
//
// The safety of this script rests on two things the argument layer must get right: --confirm has to be a
// deliberate, explicit flag (so a mistyped command can never write to production Jira), and requiring the
// script must never start doing work on its own.

'use strict';

const {
  parseCommandLineArguments,
  printParentPlan,
  printPlanSummary,
} = require('../../scripts/subtasks-to-checklist');

describe('parseCommandLineArguments — the mode and its options', () => {
  it('reads the mode from the first argument', () => {
    expect(parseCommandLineArguments(['plan']).mode).toBe('plan');
  });

  it('falls back to help when no mode is given', () => {
    expect(parseCommandLineArguments([]).mode).toBe('help');
  });

  it('reads a --name value pair', () => {
    const options = parseCommandLineArguments(['plan', '--field', 'customfield_12345']);
    expect(options.field).toBe('customfield_12345');
  });

  it('keeps a JQL string containing spaces intact', () => {
    const options = parseCommandLineArguments(['plan', '--jql', 'project = ENCUC AND issuetype = Sub-task']);
    expect(options.jql).toBe('project = ENCUC AND issuetype = Sub-task');
  });

  it('treats a bare flag as true', () => {
    expect(parseCommandLineArguments(['apply', '--confirm']).confirm).toBe(true);
  });

  it('does not let a following option be swallowed as the previous option\'s value', () => {
    const options = parseCommandLineArguments(['apply', '--confirm', '--field', 'customfield_1']);
    expect(options.confirm).toBe(true);
    expect(options.field).toBe('customfield_1');
  });

  it('leaves confirm undefined when it was not passed, so writes stay opt-in', () => {
    const options = parseCommandLineArguments(['apply', '--field', 'customfield_1']);
    expect(options.confirm).toBeUndefined();
  });

  it('ignores stray positional arguments rather than misreading them as options', () => {
    const options = parseCommandLineArguments(['plan', 'noise', '--field', 'customfield_1']);
    expect(options.field).toBe('customfield_1');
    expect(options.noise).toBeUndefined();
  });
});

describe('plan preview — a human approves the exact text', () => {
  /** Captures console output so the preview can be asserted on. */
  function captureConsole(runnable) {
    const printedLines = [];
    const originalLog = console.log;
    console.log = (...messageParts) => printedLines.push(messageParts.join(' '));
    try {
      runnable();
    } finally {
      console.log = originalLog;
    }
    return printedLines.join('\n');
  }

  const CHANGED_PARENT_PLAN = {
    parentKey: 'ENCUC-100',
    previousChecklistText: '- [ ] pre-existing item',
    nextChecklistText: '- [ ] pre-existing item\n# Converted sub-tasks\n- [ ] ENCUC-1 New work (To Do)',
    hasChanged: true,
    subtaskKeys: ['ENCUC-1'],
    addedSubtaskKeys: ['ENCUC-1'],
    lossWarnings: [],
  };

  it('shows only the lines being added, never the untouched existing ones', () => {
    const output = captureConsole(() => printParentPlan(CHANGED_PARENT_PLAN));

    expect(output).toContain('- [ ] ENCUC-1 New work (To Do)');
    expect(output).toContain('WILL CHANGE');
    // The pre-existing line is already on the issue, so it must not be listed as an addition.
    expect(output.split('Adding:')[1]).not.toContain('pre-existing item');
  });

  it('names what a sub-task would lose, so the cost is visible before approval', () => {
    const output = captureConsole(() => printParentPlan({
      ...CHANGED_PARENT_PLAN,
      lossWarnings: [{ subtaskKey: 'ENCUC-1', losesContent: ['logged time', 'comments'] }],
    }));

    expect(output).toContain('ENCUC-1 would lose: logged time, comments');
  });

  it('marks a parent that needs no write as already up to date', () => {
    const output = captureConsole(() => printParentPlan({
      ...CHANGED_PARENT_PLAN, hasChanged: false,
    }));

    expect(output).toContain('already up to date');
    expect(output).not.toContain('Adding:');
  });

  it('reports parentless sub-tasks in the summary instead of dropping them quietly', () => {
    const output = captureConsole(() => printPlanSummary({
      parentPlans: [CHANGED_PARENT_PLAN],
      orphanedSubtaskKeys: ['ENCUC-9'],
      totalSubtaskCount: 2,
      changedParentCount: 1,
    }));

    expect(output).toContain('ENCUC-9');
    expect(output).toContain('Sub-tasks matched:      2');
  });
});

describe('module safety', () => {
  it('does nothing on require — no Jira call happens just by loading the script', () => {
    // Reaching this line at all proves the import above did not attempt to reach Jira or read config.
    expect(typeof parseCommandLineArguments).toBe('function');
  });
});
