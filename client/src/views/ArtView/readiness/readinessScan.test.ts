// readinessScan.test.ts — Unit tests for the single readiness evaluation (021 FR-010, SC-003).

import { describe, expect, it } from 'vitest';

import {
  runReadinessScan,
  normalizePcodeInput,
  type ReadinessScanInput,
} from './readinessScan.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { resolveHygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';

const PI_FIELD = 'customfield_10301';
const PO_FIELD = 'customfield_20002';
const ESTIMATE_FIELD = 'customfield_20007';
const PCODE_FIELD = 'customfield_20008';
const TARGET_END_FIELD = 'customfield_10102';

/** Builds a Feature issue; overrides land straight on `fields`. */
function buildFeature(key: string, fields: Record<string, unknown> = {}): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: `Feature ${key}`,
      status: { name: 'Analyzing', statusCategory: { key: 'new' } },
      assignee: null,
      issuetype: { name: 'Feature', iconUrl: '' },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      ...fields,
    },
  } as unknown as JiraIssue;
}

/** The field config with the readiness families configured (name-discovery already ran upstream). */
function buildConfig() {
  return resolveHygieneFieldConfig({
    productOwnerFieldIds: [PO_FIELD],
    estimateFieldIds: [ESTIMATE_FIELD],
    pcodeFieldIds: [PCODE_FIELD],
    targetEndFieldIds: [TARGET_END_FIELD],
  });
}

/** A scan input with three PI scopes; caller supplies each scope's raw feature list. */
function buildInput(overrides: Partial<ReadinessScanInput> = {}): ReadinessScanInput {
  return {
    piFieldId: PI_FIELD,
    fieldConfig: buildConfig(),
    currentPiName: 'PI 26.3',
    upcomingPiName: 'PI 26.4',
    carryoverPiNames: ['PI 26.2', 'PI 26.1'],
    currentFeatures: [],
    upcomingFeatures: [],
    carryoverFeatures: [],
    loadError: null,
    scopeDescription: 'project in (PORT)',
    nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    ...overrides,
  };
}

describe('runReadinessScan — lens membership', () => {
  it('places features in current, upcoming, and carryover lenses by their scope list', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('CUR-1'), buildFeature('CUR-2')],
      upcomingFeatures: [buildFeature('UPC-1')],
      carryoverFeatures: [buildFeature('CAR-1', { status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } } })],
    }));

    expect(result.lenses.current.features.map((f) => f.key)).toEqual(['CUR-1', 'CUR-2']);
    expect(result.lenses.upcoming.features.map((f) => f.key)).toEqual(['UPC-1']);
    expect(result.lenses.carryover.features.map((f) => f.key)).toEqual(['CAR-1']);
  });

  it('excludes done features from carryover (only unfinished work carries over)', () => {
    const result = runReadinessScan(buildInput({
      carryoverFeatures: [
        buildFeature('CAR-DONE', { status: { name: 'Done', statusCategory: { key: 'done' } } }),
        buildFeature('CAR-OPEN', { status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } } }),
      ],
    }));

    expect(result.lenses.carryover.features.map((f) => f.key)).toEqual(['CAR-OPEN']);
  });

  it('reports no upcoming PI configured when none is supplied', () => {
    const result = runReadinessScan(buildInput({ upcomingPiName: null }));

    expect(result.lenses.upcoming.isPiConfigured).toBe(false);
  });
});

describe('runReadinessScan — counts and the count/listing identity (SC-003)', () => {
  it('groups the current lens by status bucket, matching its feature list length', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [
        buildFeature('A', { status: { name: 'Funnel', statusCategory: { key: 'new' } } }),
        buildFeature('B', { status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } } }),
        buildFeature('C', { status: { name: 'Done', statusCategory: { key: 'done' } } }),
      ],
    }));

    expect(result.lenses.current.countsByBucket).toEqual({ todo: 1, inProgress: 1, done: 1 });
    const total = Object.values(result.lenses.current.countsByBucket).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.lenses.current.features.length);
  });
});

describe('runReadinessScan — upcoming refinement is state-based (clarify Q1)', () => {
  it('counts To Do (status category new) as unrefined, everything else as refined', () => {
    const result = runReadinessScan(buildInput({
      upcomingFeatures: [
        buildFeature('U1', { status: { name: 'Funnel', statusCategory: { key: 'new' } } }),
        buildFeature('U2', { status: { name: 'Analyzing', statusCategory: { key: 'new' } } }),
        buildFeature('U3', { status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } } }),
      ],
    }));

    expect(result.lenses.upcoming.unrefinedCount).toBe(2);
    expect(result.lenses.upcoming.refinedCount).toBe(1);
  });
});

describe('runReadinessScan — alert predicates', () => {
  it('flags missing ownership only when BOTH assignee and PO field are empty (clarify Q2)', () => {
    const both = runReadinessScan(buildInput({ currentFeatures: [buildFeature('A')] }));
    expect(both.lenses.current.features[0].alerts).toContain('missing-ownership');

    const hasAssignee = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('B', { assignee: { displayName: 'Alex', accountId: 'x' } })],
    }));
    expect(hasAssignee.lenses.current.features[0].alerts).not.toContain('missing-ownership');

    const hasPo = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('C', { [PO_FIELD]: { displayName: 'Jo' } })],
    }));
    expect(hasPo.lenses.current.features[0].alerts).not.toContain('missing-ownership');
  });

  it('flags missing estimate and pcode when their configured fields are empty', () => {
    const result = runReadinessScan(buildInput({ currentFeatures: [buildFeature('A')] }));
    expect(result.lenses.current.features[0].alerts).toEqual(
      expect.arrayContaining(['missing-estimate', 'missing-pcode']),
    );
  });

  it('does not flag estimate/pcode when the fields carry a value', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('A', { [ESTIMATE_FIELD]: { value: 'L' }, [PCODE_FIELD]: '12345' })],
    }));
    expect(result.lenses.current.features[0].alerts).not.toContain('missing-estimate');
    expect(result.lenses.current.features[0].alerts).not.toContain('missing-pcode');
  });

  it('flags target-end missing-or-past only for not-done features', () => {
    const past = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('A', { [TARGET_END_FIELD]: '2026-01-01' })],
    }));
    expect(past.lenses.current.features[0].alerts).toContain('target-end-missing-or-past');

    const doneButPast = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('B', {
        status: { name: 'Done', statusCategory: { key: 'done' } },
        [TARGET_END_FIELD]: '2026-01-01',
      })],
    }));
    expect(doneButPast.lenses.current.features[0].alerts).not.toContain('target-end-missing-or-past');
  });

  it('flags due-date missing-or-past off the native duedate field for not-done features', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('A', { duedate: '2026-01-01' })],
    }));
    expect(result.lenses.current.features[0].alerts).toContain('due-date-missing-or-past');
  });
});

describe('runReadinessScan — unconfigured field families are honest (GH #167)', () => {
  it('marks estimate/pcode families notConfigured and never flags those alerts', () => {
    const configWithoutFamilies = resolveHygieneFieldConfig({ productOwnerFieldIds: [PO_FIELD] });
    const result = runReadinessScan(buildInput({
      fieldConfig: configWithoutFamilies,
      currentFeatures: [buildFeature('A')],
    }));

    expect(result.alertFamilyStates['missing-estimate']).toBe('notConfigured');
    expect(result.alertFamilyStates['missing-pcode']).toBe('notConfigured');
    expect(result.lenses.current.features[0].alerts).not.toContain('missing-estimate');
    expect(result.lenses.current.features[0].alerts).not.toContain('missing-pcode');
  });
});

describe('runReadinessScan — honest scope states', () => {
  it('reports scannedFeatureCount 0 for an empty scope (not a healthy zero)', () => {
    const result = runReadinessScan(buildInput());
    expect(result.scannedFeatureCount).toBe(0);
    expect(result.loadError).toBeNull();
  });

  it('reports scannedFeatureCount null and the error on a failed load', () => {
    const result = runReadinessScan(buildInput({ loadError: 'Jira 500' }));
    expect(result.scannedFeatureCount).toBeNull();
    expect(result.loadError).toBe('Jira 500');
  });

  it('sums the scanned count across all three lenses on success', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('A')],
      upcomingFeatures: [buildFeature('B')],
      carryoverFeatures: [buildFeature('C', { status: { name: 'Open', statusCategory: { key: 'indeterminate' } } })],
    }));
    expect(result.scannedFeatureCount).toBe(3);
  });

  it('resolves the inline-fix write field ids from the first configured id per family', () => {
    const result = runReadinessScan(buildInput());
    expect(result.writeFieldIds).toEqual({
      productOwnerFieldId: PO_FIELD,
      estimateFieldId: ESTIMATE_FIELD,
      pcodeFieldId: PCODE_FIELD,
      targetEndFieldId: TARGET_END_FIELD,
    });
  });
});

describe('runReadinessScan — impediment reuse', () => {
  it('carries impediment reasons onto the feature via the shared detector', () => {
    const result = runReadinessScan(buildInput({
      currentFeatures: [buildFeature('A', { status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } })],
    }));
    expect(result.lenses.current.features[0].impedimentReasons).toContain('Blocked Status');
  });
});

describe('normalizePcodeInput', () => {
  it('accepts plain digits unchanged', () => {
    expect(normalizePcodeInput('12345')).toEqual({ ok: true, value: '12345' });
  });

  it('strips a leading P and leading zeros', () => {
    expect(normalizePcodeInput('P00012345')).toEqual({ ok: true, value: '12345' });
    expect(normalizePcodeInput('p0012345')).toEqual({ ok: true, value: '12345' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePcodeInput('  12345  ')).toEqual({ ok: true, value: '12345' });
  });

  it('rejects non-numeric or empty input with a reason and no value', () => {
    expect(normalizePcodeInput('abc').ok).toBe(false);
    expect(normalizePcodeInput('').ok).toBe(false);
    expect(normalizePcodeInput('12x45').ok).toBe(false);
  });
});
