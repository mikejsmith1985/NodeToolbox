// compositionReadiness.test.ts — Readiness load fields + evaluated-issue overlay (GH #220): a governed
// field that IS set on the loaded issue must not be flagged missing.

import { describe, expect, it } from 'vitest';

import { buildDraftHygieneIssue, buildReadinessFieldList } from './compositionReadiness.ts';
import type { DraftReadinessInputs, ReadinessFieldConfig } from './compositionReadiness.ts';
import { evaluateHygieneIssue, resolveHygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';

const PI_FIELD = 'customfield_10301';
const PO_FIELD = 'customfield_10009';

const CONFIG: ReadinessFieldConfig = {
  programIncrementFieldIds: [PI_FIELD],
  productOwnerFieldIds: [PO_FIELD],
  parentLinkFieldIds: ['parent'],
  featureLinkFieldIds: ['customfield_10108'],
  initiativeTypeFieldIds: ['customfield_10500'],
  applicationFieldIds: ['customfield_10400'],
  targetStartFieldIds: ['customfield_10101'],
  targetEndFieldIds: ['customfield_10102'],
  acceptanceCriteriaFieldIds: ['customfield_10200'],
};

function draft(overrides: Partial<DraftReadinessInputs> = {}): DraftReadinessInputs {
  return { existingIssueKey: 'DENP-1412', summary: 'A Feature', description: 'Some text', acceptanceCriteria: 'AC', fields: {}, ...overrides };
}

describe('buildReadinessFieldList', () => {
  it('requests the native readiness fields plus every configured governed-field id, de-duplicated', () => {
    const fields = buildReadinessFieldList(CONFIG, 'customfield_10200');
    expect(fields).toContain('summary');
    expect(fields).toContain('fixVersions');
    expect(fields).toContain('duedate');
    expect(fields).toContain(PI_FIELD);        // PI id is requested so its value loads
    expect(fields).toContain(PO_FIELD);        // PO id is requested so its value loads
    expect(fields.filter((id) => id === 'customfield_10200')).toHaveLength(1); // de-duped
  });
});

describe('buildDraftHygieneIssue', () => {
  it('overlays the loaded issue values as the base, with draft edits on top', () => {
    const issue = buildDraftHygieneIssue(
      draft({ summary: 'Edited summary' }),
      { [PI_FIELD]: { value: 'PI 26.4' }, [PO_FIELD]: { accountId: 'po-1' } },
      'customfield_10200',
    );
    expect(issue.fields[PI_FIELD]).toEqual({ value: 'PI 26.4' }); // from the loaded issue
    expect(issue.fields[PO_FIELD]).toEqual({ accountId: 'po-1' });
    expect(issue.fields.summary).toBe('Edited summary'); // draft edit wins
  });
});

describe('regression — GH #220: a set PI/PO is not flagged missing', () => {
  it('produces no Missing PI / Missing Product Owner flag when the loaded issue has them', () => {
    const fieldConfig = resolveHygieneFieldConfig({
      programIncrementFieldIds: [PI_FIELD],
      productOwnerFieldIds: [PO_FIELD],
      acceptanceCriteriaFieldIds: ['customfield_10200'],
    });
    const issue = buildDraftHygieneIssue(
      draft(),
      { [PI_FIELD]: { value: 'PI 26.4 (07/30/26 - 10/07/26)' }, [PO_FIELD]: { accountId: 'po-1', displayName: 'Phatate, Smita' } },
      'customfield_10200',
    );
    const flags = evaluateHygieneIssue(issue, { fieldConfig });
    const labels = flags.map((flag) => flag.label);
    expect(labels).not.toContain('Missing PI');
    expect(labels).not.toContain('Missing Product Owner');
  });

  it('still flags a governed field that is genuinely absent', () => {
    const fieldConfig = resolveHygieneFieldConfig({ programIncrementFieldIds: [PI_FIELD], productOwnerFieldIds: [PO_FIELD] });
    const issue = buildDraftHygieneIssue(draft(), {}, 'customfield_10200'); // nothing loaded
    const labels = evaluateHygieneIssue(issue, { fieldConfig }).map((flag) => flag.label);
    expect(labels).toContain('Missing PI');
    expect(labels).toContain('Missing Product Owner');
  });
});
