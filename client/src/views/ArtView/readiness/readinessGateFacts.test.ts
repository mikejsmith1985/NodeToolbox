// readinessGateFacts.test.ts — Turning a scanned Feature into the facts the enterprise gate wants.
//
// The gate module is field-blind on purpose: it knows the org's rules and nothing about Jira. This
// is the join, and the only interesting thing about it is honesty. Readiness reads FEATURES, not
// their children, and Jira has no standard field for Initiative Type or the CMDB application — so
// those three come back as "not looked at" rather than "missing".
//
// Getting that wrong would be worse than useless: it would send a PO to fill in a field that is
// very likely already filled in, and teach them to ignore the panel.

import { describe, expect, it } from 'vitest';

import { buildReadinessGateFacts } from './readinessGateFacts.ts';
import type { HygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const FIELD_CONFIG = {
  acceptanceCriteriaFieldIds: ['customfield_ac'],
  featureLinkFieldIds: ['customfield_parentlink'],
  targetStartFieldIds: ['customfield_targetstart'],
} as unknown as HygieneFieldConfig;

const PI_FIELD_ID = 'customfield_pi';

/** Builds a Feature issue carrying whichever fields the test is about. */
function feature(fields: Record<string, unknown> = {}): JiraIssue {
  return {
    id: 'DENP-1',
    key: 'DENP-1',
    fields: { summary: 'Enrolment', status: { name: 'Analyzing' }, ...fields },
  } as unknown as JiraIssue;
}

describe('buildReadinessGateFacts', () => {
  it('reads the fields Readiness genuinely has', () => {
    const facts = buildReadinessGateFacts(
      feature({
        assignee: { displayName: 'Smith, Jane (CTR)' },
        duedate: '2026-10-01',
        fixVersions: [{ name: 'Release 10/02/2026' }],
        customfield_ac: 'Given a member…',
        customfield_targetstart: '2026-09-01',
        customfield_parentlink: 'PROG-9',
        customfield_pi: { value: 'PI 26.4' },
      }),
      { productOwnerDisplayName: 'Doe, John (CTR)', estimateValue: '8', targetEndIso: '2026-09-11' },
      FIELD_CONFIG,
      PI_FIELD_ID,
    );

    expect(facts.hasAssignee).toBe(true);
    expect(facts.hasProductOwner).toBe(true);
    expect(facts.hasEstimate).toBe(true);
    expect(facts.hasAcceptanceCriteria).toBe(true);
    expect(facts.hasTargetStart).toBe(true);
    expect(facts.hasTargetEnd).toBe(true);
    expect(facts.hasDueDate).toBe(true);
    expect(facts.hasFixVersion).toBe(true);
    expect(facts.hasParentLink).toBe(true);
    expect(facts.hasProgramIncrement).toBe(true);
  });

  it('reports an absent field as absent', () => {
    const facts = buildReadinessGateFacts(feature(), {}, FIELD_CONFIG, PI_FIELD_ID);

    expect(facts.hasAssignee).toBe(false);
    expect(facts.hasAcceptanceCriteria).toBe(false);
    expect(facts.hasFixVersion).toBe(false);
    expect(facts.hasParentLink).toBe(false);
  });

  it('says "not looked at" for the three this surface cannot answer', () => {
    // Initiative Type and the CMDB Application have no field here to read, and Readiness never
    // fetches a Feature's children. Reporting them as missing would be a confident lie.
    const facts = buildReadinessGateFacts(feature(), {}, FIELD_CONFIG, PI_FIELD_ID);

    expect(facts.hasInitiativeType).toBeNull();
    expect(facts.hasApplication).toBeNull();
    expect(facts.areAllChildrenClosed).toBeNull();
  });

  it('does not claim a broken-down Feature has no children', () => {
    // A count of zero would be a confident statement that nothing is under this Feature. The scan
    // never looked, and null is the only answer that says so.
    expect(buildReadinessGateFacts(feature(), {}, FIELD_CONFIG, PI_FIELD_ID).childStoriesWithPointsCount)
      .toBeNull();
  });

  it('leaves every deployment and delivery fact unknown, because Jira does not hold them', () => {
    const facts = buildReadinessGateFacts(feature(), {}, FIELD_CONFIG, PI_FIELD_ID);

    expect(facts.isCodeInUpperTestRegion).toBeNull();
    expect(facts.isCodeInProduction).toBeNull();
    expect(facts.areCheckoutActivitiesComplete).toBeNull();
    expect(facts.isValueDeliveredToCustomer).toBeNull();
  });

  it('treats an empty string as absent, which is how Jira returns a cleared field', () => {
    const facts = buildReadinessGateFacts(
      feature({ customfield_ac: '   ', customfield_targetstart: '' }),
      { estimateValue: '  ' },
      FIELD_CONFIG,
      PI_FIELD_ID,
    );

    expect(facts.hasAcceptanceCriteria).toBe(false);
    expect(facts.hasTargetStart).toBe(false);
    expect(facts.hasEstimate).toBe(false);
  });

  it('treats an empty fixVersions array as absent, which truthiness alone would not', () => {
    // [] is truthy. Checking the array itself rather than its length is a bug this codebase has
    // already been bitten by.
    const facts = buildReadinessGateFacts(feature({ fixVersions: [] }), {}, FIELD_CONFIG, PI_FIELD_ID);
    expect(facts.hasFixVersion).toBe(false);
  });

  it('reads the PI from whichever shape the field returns it in', () => {
    const asObject = buildReadinessGateFacts(
      feature({ customfield_pi: { value: 'PI 26.4' } }), {}, FIELD_CONFIG, PI_FIELD_ID);
    const asString = buildReadinessGateFacts(
      feature({ customfield_pi: 'PI 26.4' }), {}, FIELD_CONFIG, PI_FIELD_ID);

    expect(asObject.hasProgramIncrement).toBe(true);
    expect(asString.hasProgramIncrement).toBe(true);
  });

  it('tries every configured id for a family, because the first is not always the one in use', () => {
    const config = { ...FIELD_CONFIG, acceptanceCriteriaFieldIds: ['customfield_unused', 'customfield_ac'] };
    const facts = buildReadinessGateFacts(
      feature({ customfield_ac: 'Given a member…' }), {}, config, PI_FIELD_ID);

    expect(facts.hasAcceptanceCriteria).toBe(true);
  });

  it('assumes a Feature delivers value, which is the direction that holds it rather than releases it', () => {
    // Nothing in Jira says whether a Feature is a spike. Assuming it delivers value keeps the
    // checkout and delivery criteria in play, which is the safe way to be wrong.
    expect(buildReadinessGateFacts(feature(), {}, FIELD_CONFIG, PI_FIELD_ID).isValueBearing).toBe(true);
  });
});
