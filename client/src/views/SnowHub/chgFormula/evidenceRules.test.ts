// evidenceRules.test.ts — The traceability rules every CHG prompt carries (GH #415).

import { describe, expect, it } from 'vitest';

import { buildChgContextText } from './chgPromptContext.ts';
import { EVIDENCE_RULE_LINES } from './evidenceRules.ts';

const SAMPLE_CONTEXT = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Enrollment Web',
  assignmentGroupLabel: 'Enrollment Dev',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: [],
  assessmentLines: [],
  changeTaskLines: [],
};

describe('EVIDENCE_RULE_LINES', () => {
  it('lets the assistant copy or reword supplied facts, and nothing it assumes', () => {
    const rulesText = EVIDENCE_RULE_LINES.join('\n');

    expect(rulesText).toMatch(/Every statement must trace to the evidence supplied here/);
    expect(rulesText).toMatch(/Never add health checks, monitoring checks, deployment commands, validation activities or rollback activities/);
    expect(rulesText).toMatch(/only by exposing facts already present elsewhere/i);
    expect(rulesText).toMatch(/name the gap instead of inventing likely content/i);
  });
});

describe('buildChgContextText — the change tasks\' own instructions', () => {
  it('carries the evidence rules in every prompt', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).toContain(EVIDENCE_RULE_LINES[0]);
  });

  it('gives each change task\'s instructions in full, as the facts implementation steps are built from', () => {
    const contextText = buildChgContextText({
      ...SAMPLE_CONTEXT,
      changeTaskInstructionLines: ['CTASK0048132: repo usmg-enrollment-ingestion, PR 98, job type deploy, environment prod'],
    });

    expect(contextText).toMatch(/Change task instructions[^\n]*:\n {2}CTASK0048132: repo usmg-enrollment-ingestion, PR 98, job type deploy, environment prod/);
  });

  it('leaves the instructions out when no task has any', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).not.toMatch(/Change task instructions/);
  });
});
