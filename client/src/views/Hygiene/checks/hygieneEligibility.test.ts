// hygieneEligibility.test.ts — The denominator behind every hygiene tile.

import { describe, expect, it } from 'vitest';

import {
  HYGIENE_CHECK_IDS,
  evaluateHygieneIssue,
  resolveHygieneFieldConfig,
  type JiraIssue,
} from './hygieneChecks.ts';
import { summarizeCheckApplicability } from './hygieneEligibility.ts';

const TODO_STATUS = { name: 'To Do', statusCategory: { key: 'new' } };

function buildIssue(issueTypeName: string, overrides: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    key: `TBX-${issueTypeName}`,
    fields: {
      summary: 'Sample issue',
      status: TODO_STATUS,
      assignee: { displayName: 'Alex' },
      issuetype: { name: issueTypeName },
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-10T00:00:00.000Z',
      description: '',
      ...overrides,
    },
  };
}

/** A config whose optional families are all present, so only issue type decides eligibility. */
const CONFIGURED_FIELDS = resolveHygieneFieldConfig({
  productOwnerFieldIds: ['customfield_1'],
  initiativeTypeFieldIds: ['customfield_2'],
  applicationFieldIds: ['customfield_3'],
});

describe('summarizeCheckApplicability — how many issues a check even looked at', () => {
  it('counts a Story out of the Feature-only checks, so their zero is not read as clean', () => {
    const applicability = summarizeCheckApplicability([buildIssue('Story')], CONFIGURED_FIELDS, HYGIENE_CHECK_IDS);

    expect(applicability['missing-product-owner'].eligibleIssueCount).toBe(0);
    expect(applicability['missing-pi'].eligibleIssueCount).toBe(0);
    expect(applicability['missing-child-story-points'].eligibleIssueCount).toBe(0);
  });

  it('counts a Story into the checks that genuinely apply to it', () => {
    const applicability = summarizeCheckApplicability([buildIssue('Story')], CONFIGURED_FIELDS, HYGIENE_CHECK_IDS);

    expect(applicability['missing-sp'].eligibleIssueCount).toBe(1);
    expect(applicability['missing-fix-version'].eligibleIssueCount).toBe(1);
    expect(applicability['missing-feature-link'].eligibleIssueCount).toBe(1);
    expect(applicability['no-ac'].eligibleIssueCount).toBe(1);
    expect(applicability['missing-summary'].eligibleIssueCount).toBe(1);
  });

  it('counts a Feature into the Feature checks and out of the story-points one', () => {
    const applicability = summarizeCheckApplicability([buildIssue('Feature')], CONFIGURED_FIELDS, HYGIENE_CHECK_IDS);

    expect(applicability['missing-pi'].eligibleIssueCount).toBe(1);
    expect(applicability['missing-parent-link'].eligibleIssueCount).toBe(1);
    expect(applicability['missing-sp'].eligibleIssueCount).toBe(0);
  });

  it('reports a check whose Jira field this instance lacks as unconfigured, not as applying to nobody', () => {
    const applicability = summarizeCheckApplicability(
      [buildIssue('Feature')],
      resolveHygieneFieldConfig({ productOwnerFieldIds: [] }),
      HYGIENE_CHECK_IDS,
    );

    expect(applicability['missing-product-owner'].isFieldConfigured).toBe(false);
    expect(applicability['missing-pi'].isFieldConfigured).toBe(true);
  });

  it('gives every enabled check an entry, so no tile is left without a denominator', () => {
    const applicability = summarizeCheckApplicability([buildIssue('Story')], CONFIGURED_FIELDS, HYGIENE_CHECK_IDS);

    HYGIENE_CHECK_IDS.forEach((checkId) => {
      expect(applicability[checkId]).toBeDefined();
    });
  });

  it('treats a check it does not know as applying to everything, rather than silently to nothing', () => {
    const applicability = summarizeCheckApplicability([buildIssue('Story')], CONFIGURED_FIELDS, ['required-field-42']);

    expect(applicability['required-field-42'].eligibleIssueCount).toBe(1);
  });
});

describe('eligibility agrees with the checks themselves, by construction', () => {
  // The one way this pairing can rot is a check gate changing without its eligibility gate. A flag
  // raised against an issue the summary counts as ineligible would render as "0 of 0" beside a
  // finding — the exact contradiction that makes a screen untrustworthy.
  const SAMPLE_ISSUES = [
    buildIssue('Story'), buildIssue('Task'), buildIssue('Defect'), buildIssue('Bug'),
    buildIssue('Spike'), buildIssue('Feature'), buildIssue('Epic'), buildIssue('Sub-task'),
    buildIssue('Risk'), buildIssue('Story', { summary: '' }), buildIssue('Feature', { assignee: null }),
  ];

  it('never raises a flag on an issue it counts as ineligible for that check', () => {
    SAMPLE_ISSUES.forEach((issue) => {
      const applicability = summarizeCheckApplicability([issue], CONFIGURED_FIELDS, HYGIENE_CHECK_IDS);
      evaluateHygieneIssue(issue, { fieldConfig: CONFIGURED_FIELDS }).forEach((flag) => {
        expect(
          applicability[flag.checkId]?.eligibleIssueCount,
          `${flag.checkId} flagged a ${issue.fields.issuetype?.name} it counts as ineligible`,
        ).toBe(1);
      });
    });
  });
});
