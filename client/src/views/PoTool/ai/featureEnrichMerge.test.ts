// featureEnrichMerge.test.ts — Enriching a Feature must never lose what it already said (GH #387): the merge keeps
// every original line and appends only what is new, and a description too long for Jira is reported before saving.

import { describe, expect, it } from 'vitest';

import { SECTION_LABELS } from './featureDocSections.ts';
import { checkDescriptionLength, MAX_JIRA_DESCRIPTION_CHARS, mergeEnrichedDescription } from './featureEnrichMerge.ts';

/** A real-shaped existing description: a requirements document, not a tidy nine-section one. */
const EXISTING_DESCRIPTION = [
  'ESI ↔ Facets Eligibility Reconciliation Report',
  'Objective: identify eligibility mismatches between Facets and ESI.',
  '',
  'R2. Population Classification Logic',
  'Arizona Population: Contract = H0354',
  'EGWP Population: Contract != H0354 AND PBP begins with "8"',
  '',
  'Acceptance Criteria:',
  'Members should only be expected in ESI after the applicable migration date.',
  'Migration Exceptions should remain visible for audit and operational review.',
  '',
  'Risks:',
  'Historical reconciliation results may differ after implementation.',
].join('\n');

describe('mergeEnrichedDescription', () => {
  it('keeps every line the Feature already had', () => {
    const proposed = 'Description:\nA short rewrite that mentions reconciliation.\n\nAcceptance Criteria:\nThe report runs.';
    const merged = mergeEnrichedDescription(EXISTING_DESCRIPTION, proposed);
    for (const originalLine of EXISTING_DESCRIPTION.split('\n').filter((line) => line.trim() !== '')) {
      expect(merged).toContain(originalLine);
    }
  });

  it('appends only what is new, under the matching section', () => {
    const proposed = 'Acceptance Criteria:\nMembers should only be expected in ESI after the applicable migration date.\nThe report run date is used to evaluate both spans.';
    const merged = mergeEnrichedDescription(EXISTING_DESCRIPTION, proposed);
    const acceptanceSection = merged.split('Assumptions:')[0];
    expect(acceptanceSection).toContain('The report run date is used to evaluate both spans.');
    // The line the Feature already had is not repeated.
    expect(merged.match(/Members should only be expected in ESI/g)).toHaveLength(1);
  });

  it('ignores case, spacing and bullet marks when deciding a line is already there', () => {
    const proposed = 'Risks:\n- historical  reconciliation results MAY differ after implementation.';
    const merged = mergeEnrichedDescription(EXISTING_DESCRIPTION, proposed);
    expect(merged.toLowerCase().match(/historical reconciliation results may differ/g)).toHaveLength(1);
  });

  it('fills a section the Feature does not have yet from the proposal', () => {
    const proposed = 'Benefit Hypothesis:\nFewer false positives means less manual analysis.';
    expect(mergeEnrichedDescription(EXISTING_DESCRIPTION, proposed)).toContain('Fewer false positives means less manual analysis.');
  });

  it('always returns the full nine-section document', () => {
    const merged = mergeEnrichedDescription(EXISTING_DESCRIPTION, 'Description:\nAnything.');
    for (const label of SECTION_LABELS) {
      expect(merged).toContain(`${label}:`);
    }
  });

  it('is just the proposal when the Feature has no description yet', () => {
    const merged = mergeEnrichedDescription('   ', 'Description:\nBrand new Feature.');
    expect(merged).toContain('Brand new Feature.');
  });

  it('does not lose the unlabelled preamble a real Feature starts with', () => {
    const merged = mergeEnrichedDescription(EXISTING_DESCRIPTION, 'Description:\nSomething else.');
    expect(merged).toContain('ESI ↔ Facets Eligibility Reconciliation Report');
    expect(merged).toContain('R2. Population Classification Logic');
  });
});

describe('checkDescriptionLength', () => {
  it('reports a description Jira would refuse, and by how much', () => {
    const tooLong = 'x'.repeat(MAX_JIRA_DESCRIPTION_CHARS + 120);
    expect(checkDescriptionLength(tooLong)).toEqual({ length: MAX_JIRA_DESCRIPTION_CHARS + 120, isOverLimit: true, excessCharacters: 120 });
  });

  it('passes a description at the limit', () => {
    expect(checkDescriptionLength('x'.repeat(MAX_JIRA_DESCRIPTION_CHARS)).isOverLimit).toBe(false);
  });
});
