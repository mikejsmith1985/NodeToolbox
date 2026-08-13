// repair-containment-links.test.js — Guards the command-line shell of the containment-link repair.
//
// The safety of this script rests on two things this layer must get right: `--confirm` has to be a
// deliberate, explicit flag, so a mistyped command can never delete and recreate links in production
// Jira; and requiring the file must never start doing work on its own.

'use strict';

const { parseCommandLineArguments, runApply, HELP_TEXT } = require('../../scripts/repair-containment-links');

describe('parseCommandLineArguments', () => {
  it('reads the mode from the first argument', () => {
    expect(parseCommandLineArguments(['plan']).mode).toBe('plan');
  });

  it('falls back to help when no mode is given, rather than to a writing mode', () => {
    expect(parseCommandLineArguments([]).mode).toBe('help');
  });

  it('reads a --name value pair', () => {
    expect(parseCommandLineArguments(['plan', '--jql', 'project = ENCUC']).jql).toBe('project = ENCUC');
  });

  it('reads --confirm as a flag, not as a value swallowing the next argument', () => {
    const parsed = parseCommandLineArguments(['apply', '--confirm', '--jql', 'project = ENCUC']);

    expect(parsed.confirm).toBe(true);
    expect(parsed.jql).toBe('project = ENCUC');
  });

  it('leaves --confirm absent when it was not typed', () => {
    expect(parseCommandLineArguments(['apply', '--jql', 'project = ENCUC']).confirm).toBeUndefined();
  });
});

describe('runApply — the guard that stands between a typo and production Jira', () => {
  it('refuses to write without --confirm, before reading anything at all', async () => {
    // Rejecting BEFORE any Jira call matters: the check must not depend on a search succeeding.
    await expect(runApply({}, { jql: 'project = ENCUC' }))
      .rejects.toThrow(/Refusing to write without --confirm/);
  });

  it('names the plan step in the refusal, so the next move is obvious', async () => {
    await expect(runApply({}, { jql: 'project = ENCUC' })).rejects.toThrow(/plan/);
  });
});

describe('requiring the script', () => {
  it('does no work on its own', () => {
    // The require above already happened; reaching here means nothing tried to reach Jira.
    expect(typeof parseCommandLineArguments).toBe('function');
  });

  it('documents both steps and the confirmation flag', () => {
    expect(HELP_TEXT).toContain('plan');
    expect(HELP_TEXT).toContain('--confirm');
  });
});
