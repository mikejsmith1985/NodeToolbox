// formulaCard.test.ts — The Release Manager's Change Request Formula Card, as data and as prompt text (GH #395).

import { describe, expect, it } from 'vitest';

import {
  CHG_TEXT_FIELD_FORMULA_FIELDS,
  FORMULA_CARD_FIELDS,
  FORMULA_CARD_QUALITY_GATE,
  RECORD_LEVEL_FORMULA_FIELDS,
  renderFormulaCardChecklist,
  renderFormulaGuidanceForField,
} from './formulaCard.ts';

describe('the Formula Card data', () => {
  it('carries every field from sections 1–7 and the five quality-gate questions', () => {
    expect(FORMULA_CARD_FIELDS).toHaveLength(50);
    expect(new Set(FORMULA_CARD_FIELDS.map((entry) => entry.section)).size).toBe(7);
    expect(FORMULA_CARD_QUALITY_GATE).toHaveLength(5);
  });

  it('files every card field under exactly one CHG text field or the record itself — none is dropped', () => {
    const mappedFieldNames = [
      ...Object.values(CHG_TEXT_FIELD_FORMULA_FIELDS).flat(),
      ...RECORD_LEVEL_FORMULA_FIELDS,
    ];

    expect([...mappedFieldNames].sort()).toEqual(FORMULA_CARD_FIELDS.map((entry) => entry.field).sort());
    expect(new Set(mappedFieldNames).size).toBe(mappedFieldNames.length);
  });
});

describe('renderFormulaGuidanceForField', () => {
  it('gives the test plan its own card rules and nobody else\'s', () => {
    const guidance = renderFormulaGuidanceForField('testPlan');

    expect(guidance).toContain('Preproduction Test Plan');
    expect(guidance).toContain('Environment + production differences + scope tested + backout tested + date + performer.');
    expect(guidance).toContain('Success Criteria');
    expect(guidance).not.toContain('Backout Trigger');
  });

  it('includes the formula, the minimum acceptable and the reviewer test for each rule', () => {
    const guidance = renderFormulaGuidanceForField('shortDescription');

    expect(guidance).toContain('Domain + action + object + version or scope + environment.');
    expect(guidance).toContain('Domain, action, object, and environment are clear.');
    expect(guidance).toContain('Can I identify what is changing without opening the record?');
  });
});

describe('renderFormulaCardChecklist', () => {
  it('lists every card field with its reviewer test, then the quality gate', () => {
    const checklist = renderFormulaCardChecklist();

    FORMULA_CARD_FIELDS.forEach((entry) => expect(checklist).toContain(entry.field));
    expect(checklist).toContain('Does the rating reflect what could actually happen rather than how confident the team feels?');
    expect(checklist).toContain('Can the service be restored within the approved window?');
  });
});
