// chgPromptContext.test.ts — The change record's own facts and the team's delivery path, as prompt text.

import { describe, expect, it } from 'vitest';

import {
  buildChgContextText,
  CONFIRM_PLACEHOLDER_RULE,
  DELIVERY_PATH_STEPS,
  describeTaskPeople,
} from './chgPromptContext.ts';

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

describe('the record\'s own answers are facts', () => {
  it('states the risk when the record has one', () => {
    expect(buildChgContextText({ ...SAMPLE_CONTEXT, riskLabel: 'Moderate' })).toContain('Risk: Moderate');
  });

  it('tells the assistant not to ask for what the planning answers already say', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).toMatch(/planning assessment answers are the owner's own answers[\s\S]*do not ask for/i);
  });

  it('says the change task assignees are the people who deploy, validate and back out the change', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).toMatch(/change task assignees[\s\S]*deploy, validate and back out/i);
  });
});

describe('the Jira work behind the change', () => {
  it('gives the stories the fields were written from, and says their facts count as given', () => {
    const contextText = buildChgContextText({ ...SAMPLE_CONTEXT, jiraSourceText: '[ENCUC-1] Fix recon\nDescription: 300 members affected.' });

    expect(contextText).toMatch(/Jira work this change delivers[\s\S]*\[ENCUC-1\] Fix recon\nDescription: 300 members affected\./);
  });

  it('leaves the section out when no Jira work is known', () => {
    expect(buildChgContextText(SAMPLE_CONTEXT)).not.toMatch(/Jira work this change delivers/);
  });
});

describe('describeTaskPeople', () => {
  it('names the assignee and the group', () => {
    expect(describeTaskPeople('Jane Smith', 'Platform Team')).toBe('assigned to Jane Smith (group: Platform Team)');
  });

  it('says plainly what is missing', () => {
    expect(describeTaskPeople('', 'Platform Team')).toBe('no assignee (group: Platform Team)');
    expect(describeTaskPeople('Jane Smith', ' ')).toBe('assigned to Jane Smith (no group)');
    expect(describeTaskPeople('', '')).toBe('no assignee or group');
  });
});
