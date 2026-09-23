// dorCriteria.test.ts — Which criteria get validated, and where they came from. The fallback is what keeps the
// validator working on an Epic whose checklist comes from a linked template and cannot be read as text.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOD_CRITERIA,
  DEFAULT_DOR_CRITERIA,
  DEFAULT_READINESS_CRITERIA,
  readDefinitionFromHeading,
  resolveCriteria,
} from './dorCriteria.ts';
import { parseSmartChecklist } from './smartChecklist.ts';

describe('the standard criteria', () => {
  it('matches the team’s CUC - DoR template: six criteria across five groups', () => {
    expect(DEFAULT_DOR_CRITERIA).toHaveLength(6);
    expect(new Set(DEFAULT_DOR_CRITERIA.map((criterion) => criterion.section)).size).toBe(5);
    expect(DEFAULT_DOR_CRITERIA[0].text).toBe('Business objective, success criteria, and stakeholder alignment are established');
  });

  it('matches the team’s CUC - DoD template: five criteria', () => {
    expect(DEFAULT_DOD_CRITERIA).toHaveLength(5);
    expect(DEFAULT_DOD_CRITERIA.at(-1)?.text).toBe('Epic meets Definition of Done');
  });

  it('gives every criterion a unique id, since the id is what the review answers against', () => {
    const criterionIds = DEFAULT_READINESS_CRITERIA.map((criterion) => criterion.id);
    expect(new Set(criterionIds).size).toBe(criterionIds.length);
  });
});

describe('readDefinitionFromHeading', () => {
  it('reads the definition out of the heading above an item', () => {
    expect(readDefinitionFromHeading('✅ Definition of Done (DoD)')).toBe('dod');
    expect(readDefinitionFromHeading('🧰 Definition of Ready (DoR)')).toBe('dor');
  });

  it('treats an unclassified heading as readiness, so it is checked before work starts', () => {
    expect(readDefinitionFromHeading('')).toBe('dor');
    expect(readDefinitionFromHeading('Some other heading')).toBe('dor');
  });
});

describe('resolveCriteria', () => {
  it('prefers the Epic’s own checklist, keeping each item’s id so it can still be ticked', () => {
    const checklist = parseSmartChecklist([
      '# Definition of Ready (DoR)',
      '## Business Readiness',
      '- [ ] Our own wording for the objective',
      '# Definition of Done (DoD)',
      '## Closure Decision',
      '- [ ] Epic meets Definition of Done',
    ].join('\n'));

    const { criteria, source } = resolveCriteria(checklist.items);

    expect(source).toBe('issueChecklist');
    expect(criteria.map((criterion) => criterion.definition)).toEqual(['dor', 'dod']);
    expect(criteria[0]).toEqual({
      id: checklist.items[0].id,
      definition: 'dor',
      section: 'Business Readiness',
      text: 'Our own wording for the objective',
    });
  });

  it('falls back to the standard criteria when the checklist could not be read', () => {
    const { criteria, source } = resolveCriteria([]);

    expect(source).toBe('standardTemplate');
    expect(criteria).toHaveLength(DEFAULT_READINESS_CRITERIA.length);
  });
});
