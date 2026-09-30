// chgPromptContext.test.ts — The change record's own facts and the team's delivery path, as prompt text.

import { describe, expect, it } from 'vitest';

import { buildChgContextText, CONFIRM_PLACEHOLDER_RULE, DELIVERY_PATH_STEPS } from './chgPromptContext.ts';

const SAMPLE_CONTEXT = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Enrollment Web',
  assignmentGroupLabel: 'Enrollment Dev',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: ['REL: Enabled — 2026-10-14 20:00 → 2026-10-14 22:00 — Config Item: Enrollment Web'],
  assessmentLines: ['Impact: 3 - Low'],
  changeTaskLines: ['Enrollment - AWS Deploy — implementation 30 min, validation 20 min, backout 20 min'],
};

describe('buildChgContextText', () => {
  it('states the record facts the answers must match', () => {
    const contextText = buildChgContextText(SAMPLE_CONTEXT);

    expect(contextText).toContain('Category: Software');
    expect(contextText).toContain('Change owner: Smith, Mike');
    expect(contextText).toContain('REL: Enabled — 2026-10-14 20:00 → 2026-10-14 22:00');
    expect(contextText).toContain('Impact: 3 - Low');
    expect(contextText).toContain('implementation 30 min, validation 20 min, backout 20 min');
  });

  it('spells out the Dev → INT → REL → PROD path in order', () => {
    const contextText = buildChgContextText(SAMPLE_CONTEXT);
    const stepPositions = ['Dev', 'INT', 'REL', 'PROD'].map((environmentName) =>
      contextText.indexOf(DELIVERY_PATH_STEPS.find((step) => step.includes(environmentName)) ?? '__missing__'));

    stepPositions.forEach((position) => expect(position).toBeGreaterThan(-1));
    expect([...stepPositions].sort((first, second) => first - second)).toEqual(stepPositions);
  });

  it('forbids invented facts and says how to mark what is unknown', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).toContain(CONFIRM_PLACEHOLDER_RULE);
    expect(CONFIRM_PLACEHOLDER_RULE).toContain('[CONFIRM:');
  });

  it('says plainly when a record fact has not been filled in', () => {
    const contextText = buildChgContextText({ ...SAMPLE_CONTEXT, changeOwnerLabel: '', environmentLines: [] });

    expect(contextText).toContain('Change owner: (not set)');
    expect(contextText).toContain('Environments: (none enabled)');
  });
});
