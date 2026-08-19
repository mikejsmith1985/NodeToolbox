// hygieneFix.test.ts — Proves the pure Hygiene fix registry: every check maps to a fix descriptor,
// each descriptor carries the expected control kind, and the field-id resolver behaves correctly.

import { describe, expect, it } from 'vitest';

import {
  HYGIENE_CHECK_IDS,
  resolveHygieneFieldConfig,
  type BuiltInHygieneCheckId,
  type HygieneFieldConfig,
} from './checks/hygieneChecks.ts';
import { HYGIENE_FIX_BY_CHECK, resolveFixFieldId, type HygieneFixKind } from './hygieneFix.ts';

// A fully-resolved field config (defaults applied) so resolver tests use realistic field ids.
const RESOLVED_FIELD_CONFIG: HygieneFieldConfig = resolveHygieneFieldConfig();

describe('HYGIENE_FIX_BY_CHECK registry', () => {
  it('maps every built-in check id to a fix descriptor', () => {
    // Exhaustive guarantee: no built-in flag is ever left without an actionable fix path.
    HYGIENE_CHECK_IDS.forEach((checkId: BuiltInHygieneCheckId) => {
      const descriptor = HYGIENE_FIX_BY_CHECK[checkId];
      expect(descriptor, `missing descriptor for ${checkId}`).toBeDefined();
      expect(typeof descriptor.kind).toBe('string');
      expect(typeof descriptor.label).toBe('string');
    });
  });

  it('assigns the expected fix kind to each check id', () => {
    const expectedKindByCheck: Record<BuiltInHygieneCheckId, HygieneFixKind> = {
      'missing-summary': 'text',
      'no-ac': 'text',
      'no-assignee': 'assignee',
      'missing-product-owner': 'assignee',
      'missing-due-date': 'date',
      'missing-target-start': 'date',
      'missing-target-end': 'date',
      'missing-feature-link': 'feature',
      'missing-parent-link': 'parent',
      'missing-fix-version': 'fixVersion',
      'missing-pi': 'programIncrement',
      'missing-sp': 'storyPoints',
      'missing-initiative-type': 'select',
      'missing-application': 'select',
      stale: 'transition',
      'target-start-ready': 'transition',
      'target-end-overdue': 'transition',
      'due-date-overdue': 'transition',
      'old-in-sprint': 'openInJira',
      'missing-child-story-points': 'openInJira',
    'dates-out-of-sync': 'derivedDates',
    };
    (Object.keys(expectedKindByCheck) as BuiltInHygieneCheckId[]).forEach((checkId) => {
      expect(HYGIENE_FIX_BY_CHECK[checkId].kind, checkId).toBe(expectedKindByCheck[checkId]);
    });
  });
});

describe('resolveFixFieldId', () => {
  it('returns the system field id when the descriptor declares one', () => {
    expect(resolveFixFieldId({ kind: 'text', systemFieldId: 'summary', label: 'Summary' }, RESOLVED_FIELD_CONFIG)).toBe('summary');
  });

  it('returns the first configured field id when the descriptor declares a field config key', () => {
    expect(
      resolveFixFieldId({ kind: 'date', fieldConfigKey: 'targetStartFieldIds', label: 'Target Start' }, RESOLVED_FIELD_CONFIG),
    ).toBe(RESOLVED_FIELD_CONFIG.targetStartFieldIds[0]);
  });

  it('returns null when neither a system field nor a configured field id is available', () => {
    expect(resolveFixFieldId({ kind: 'storyPoints', label: 'Story Points' }, RESOLVED_FIELD_CONFIG)).toBeNull();
    // applicationFieldIds defaults to empty, so a field-config-keyed descriptor still resolves to null.
    expect(
      resolveFixFieldId({ kind: 'select', fieldConfigKey: 'applicationFieldIds', label: 'Application' }, RESOLVED_FIELD_CONFIG),
    ).toBeNull();
  });
});

describe('date flags offer BOTH remedies the rule names', () => {
  // The enterprise rule reads "the team must either move it forward OR update the date". The
  // registry only ever offered the first, so the second remedy was unreachable from the card that
  // raised the flag — a screen that says "fix it inline here" and then cannot.
  it('offers rescheduling the due date beside moving the status', () => {
    const descriptor = HYGIENE_FIX_BY_CHECK['due-date-overdue'];

    expect(descriptor.kind).toBe('transition');
    expect(descriptor.alternateFix?.kind).toBe('date');
    expect(descriptor.alternateFix?.systemFieldId).toBe('duedate');
  });

  it('offers rescheduling Target End beside moving the status', () => {
    const descriptor = HYGIENE_FIX_BY_CHECK['target-end-overdue'];

    expect(descriptor.alternateFix?.kind).toBe('date');
    expect(descriptor.alternateFix?.fieldConfigKey).toBe('targetEndFieldIds');
  });

  it('offers rescheduling Target Start beside moving the status', () => {
    const descriptor = HYGIENE_FIX_BY_CHECK['target-start-ready'];

    expect(descriptor.alternateFix?.kind).toBe('date');
    expect(descriptor.alternateFix?.fieldConfigKey).toBe('targetStartFieldIds');
  });

  it('leaves the stale flag with a status move alone — no date is involved', () => {
    expect(HYGIENE_FIX_BY_CHECK.stale.alternateFix).toBeUndefined();
  });
});
