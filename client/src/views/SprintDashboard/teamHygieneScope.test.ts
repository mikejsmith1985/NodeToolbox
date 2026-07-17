// teamHygieneScope.test.ts — Unit tests for the shared team hygiene scope-JQL builder.
//
// The Hygiene tab and the Today dashboard's team cards both scope their scan through this
// builder; these tests pin the exact clauses so the two surfaces can never diverge silently.

import { beforeEach, describe, expect, it } from 'vitest';

import { buildTeamHygieneScopeJql } from './teamHygieneScope.ts';

const EMPTY_SELECTION = {
  scopeMode: 'sprint',
  selectedPiValue: '',
  selectedFixVersionName: '',
  selectedSprintId: null,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('buildTeamHygieneScopeJql', () => {
  it('builds the PI clause from the default PI field when nothing is configured', () => {
    expect(
      buildTeamHygieneScopeJql({ ...EMPTY_SELECTION, scopeMode: 'pi', selectedPiValue: 'PI 26.3' }),
    ).toBe('AND cf[10301] = "PI 26.3"');
  });

  it('builds the PI clause from the ART-configured PI field when one is set (GH #167)', () => {
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_12345' }));
    expect(
      buildTeamHygieneScopeJql({ ...EMPTY_SELECTION, scopeMode: 'pi', selectedPiValue: 'PI 26.3' }),
    ).toBe('AND cf[12345] = "PI 26.3"');
  });

  it('escapes double quotes inside the PI value', () => {
    expect(
      buildTeamHygieneScopeJql({ ...EMPTY_SELECTION, scopeMode: 'pi', selectedPiValue: 'PI "X"' }),
    ).toBe('AND cf[10301] = "PI \\"X\\""');
  });

  it('builds the fix-version clause in fixVersion mode', () => {
    expect(
      buildTeamHygieneScopeJql({ ...EMPTY_SELECTION, scopeMode: 'fixVersion', selectedFixVersionName: 'R 2.4' }),
    ).toBe('AND fixVersion = "R 2.4"');
  });

  it('builds the sprint clause when a sprint is selected', () => {
    expect(buildTeamHygieneScopeJql({ ...EMPTY_SELECTION, selectedSprintId: 42 })).toBe('AND sprint = 42');
  });

  it('returns an empty clause when nothing is selected', () => {
    expect(buildTeamHygieneScopeJql(EMPTY_SELECTION)).toBe('');
  });
});
