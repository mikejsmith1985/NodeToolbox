// changeIssueList.test.ts — Adding one Jira issue to an existing change's text, and nothing else.

import { describe, expect, it } from 'vitest';

import { addIssueToChangeText, ISSUE_LIST_HEADING, normaliseIssueKey } from './changeIssueList.ts';

const LISTED_TEXT = {
  description: `${ISSUE_LIST_HEADING}\n\n- [ENCUC-1] Fix recon totals\n- [ENCUC-2] Add audit log\n\nDeploys via the pipeline.`,
  justification: 'Planned release of 26.10 containing 2 issue(s).',
  riskImpactAnalysis: 'Standard deployment risk. 2 issue(s) included. Follow standard runbook.',
};
const NEW_ISSUE = { key: 'ENCUC-77', summary: 'Correct member counts' };

describe('addIssueToChangeText', () => {
  it('adds the issue as the last line of the description\'s issue list, keeping the rest of the text', () => {
    const { fields } = addIssueToChangeText(LISTED_TEXT, NEW_ISSUE);

    expect(fields.description).toBe(
      `${ISSUE_LIST_HEADING}\n\n- [ENCUC-1] Fix recon totals\n- [ENCUC-2] Add audit log\n- [ENCUC-77] Correct member counts`
        + '\n\nDeploys via the pipeline.',
    );
  });

  it('counts the new issue in the justification and the risk text', () => {
    const { fields } = addIssueToChangeText(LISTED_TEXT, NEW_ISSUE);

    expect(fields.justification).toBe('Planned release of 26.10 containing 3 issue(s).');
    expect(fields.riskImpactAnalysis).toBe('Standard deployment risk. 3 issue(s) included. Follow standard runbook.');
  });

  it('starts an issue list when the description has none', () => {
    const { fields } = addIssueToChangeText({ ...LISTED_TEXT, description: 'Deploys via the pipeline.' }, NEW_ISSUE);

    expect(fields.description).toBe(`Deploys via the pipeline.\n\n${ISSUE_LIST_HEADING}\n\n- [ENCUC-77] Correct member counts`);
  });

  it('changes nothing when the change already names the issue', () => {
    const result = addIssueToChangeText(LISTED_TEXT, { key: 'ENCUC-2', summary: 'Add audit log' });

    expect(result.wasAlreadyListed).toBe(true);
    expect(result.fields).toEqual(LISTED_TEXT);
  });
});

describe('normaliseIssueKey', () => {
  it('reads a typed key in any case and with stray spaces', () => {
    expect(normaliseIssueKey('  encuc-77 ')).toBe('ENCUC-77');
  });

  it('refuses text that is not a Jira key', () => {
    expect(normaliseIssueKey('ENCUC 77')).toBeNull();
    expect(normaliseIssueKey('')).toBeNull();
  });
});
