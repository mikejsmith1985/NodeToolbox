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
