// testStoryBackfill.test.ts — Proves the [QE]/[SL] backfill only ever fills EMPTY fields, from the right source.
//
// The load-bearing rules: the source chain is [DEV] link → Defect link → parent (sub-task parent, else
// Epic Link); a blank value falls through to the next tier; two different values in one tier are never
// guessed between; and a field that already has content is never touched.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BACKFILL_PROJECT_KEYS,
  buildBackfillPlan,
  buildKeyLookupJql,
  buildSourceTiers,
  buildTargetSearchJql,
  buildUpdateFields,
  collectSourceKeys,
  isBackfillTargetSummary,
  isEmptyFieldValue,
  parseProjectKeys,
  type BackfillIssue,
  type BackfillFieldConfig,
} from './testStoryBackfill.ts';

const AC_FIELD_ID = 'customfield_ac';
const EPIC_LINK_FIELD_ID = 'customfield_epic';

const FIELD_CONFIG: BackfillFieldConfig = {
  acWriteFieldId: AC_FIELD_ID,
  acReadFieldIds: [AC_FIELD_ID],
  epicLinkFieldId: EPIC_LINK_FIELD_ID,
};

/** A linked-issue stub shaped like Jira's issuelinks entries. */
function makeLink(key: string, summary: string, issueTypeName = 'Story', isInward = false): Record<string, unknown> {
  const linkedIssue = { key, fields: { summary, issuetype: { name: issueTypeName } } };
  return isInward ? { inwardIssue: linkedIssue } : { outwardIssue: linkedIssue };
}

/** A target issue as the search returns it. */
function makeTarget(key: string, fields: Record<string, unknown> = {}): BackfillIssue {
  return { key, fields: { summary: `[SL] Thing ${key}`, issuelinks: [], description: null, [AC_FIELD_ID]: null, ...fields } };
}

/** A source issue carrying description + AC. */
function makeSource(key: string, description: string | null, acceptanceCriteria: string | null): BackfillIssue {
  return { key, fields: { summary: key, description, [AC_FIELD_ID]: acceptanceCriteria } };
}

describe('target selection', () => {
  it('matches [QE] and [SL] anywhere in the summary, case-insensitively', () => {
    expect(isBackfillTargetSummary('[SL] Login page')).toBe(true);
    expect(isBackfillTargetSummary('Login [qe] regression')).toBe(true);
    expect(isBackfillTargetSummary('[DEV] Login page')).toBe(false);
    expect(isBackfillTargetSummary('SL Login page')).toBe(false);
  });

  it('builds an open-issues JQL over the chosen projects', () => {
    const jql = buildTargetSearchJql(['ENCUC', 'ENFCT']);
    expect(jql).toContain('project in (ENCUC, ENFCT)');
    expect(jql).toContain('statusCategory != Done');
  });

  it('leaves the [QE]/[SL] match to code, so the search has no text clause to slow it down or miss a tag', () => {
    expect(buildTargetSearchJql(['ENCUC'])).not.toContain('summary ~');
  });

  it('looks issues up by key, in a stable order so paging cannot skip one', () => {
    expect(buildKeyLookupJql(['ENCUC-1', 'ENFCT-2'])).toBe('key in (ENCUC-1, ENFCT-2) ORDER BY key ASC');
  });

  it('parses a typed project list and defaults to ENCUC + ENFCT', () => {
    expect(parseProjectKeys(' encuc, ENFCT ,,')).toEqual(['ENCUC', 'ENFCT']);
    expect(DEFAULT_BACKFILL_PROJECT_KEYS).toEqual(['ENCUC', 'ENFCT']);
  });

  it('treats null, undefined and whitespace as empty', () => {
    expect(isEmptyFieldValue(null)).toBe(true);
    expect(isEmptyFieldValue(undefined)).toBe(true);
    expect(isEmptyFieldValue('  \n ')).toBe(true);
    expect(isEmptyFieldValue('Given...')).toBe(false);
  });
});

describe('source tiers', () => {
  it('orders [DEV] links, then Defect links, then the parent', () => {
    const target = makeTarget('ENCUC-10', {
      issuelinks: [makeLink('ENCUC-2', 'Defect thing', 'Defect'), makeLink('ENCUC-1', '[DEV] Thing', 'Story', true)],
      parent: { key: 'ENCUC-3' },
    });
    expect(buildSourceTiers(target, EPIC_LINK_FIELD_ID)).toEqual([
      { tierName: 'DEV', issueKeys: ['ENCUC-1'] },
      { tierName: 'Defect', issueKeys: ['ENCUC-2'] },
      { tierName: 'Parent', issueKeys: ['ENCUC-3'] },
    ]);
  });

  it('never uses another [QE]/[SL] issue as a source', () => {
    const target = makeTarget('ENCUC-10', { issuelinks: [makeLink('ENCUC-11', '[QE] [DEV] Thing')] });
    expect(buildSourceTiers(target, EPIC_LINK_FIELD_ID)[0].issueKeys).toEqual([]);
  });

  it('falls back to the Epic Link when there is no sub-task parent', () => {
    const target = makeTarget('ENCUC-10', { [EPIC_LINK_FIELD_ID]: 'ENCUC-500' });
    expect(buildSourceTiers(target, EPIC_LINK_FIELD_ID)[2]).toEqual({ tierName: 'Parent', issueKeys: ['ENCUC-500'] });
  });

  it('collects every distinct source key across targets', () => {
    const tiersList = [
      [{ tierName: 'DEV' as const, issueKeys: ['A-1'] }, { tierName: 'Parent' as const, issueKeys: ['A-9'] }],
      [{ tierName: 'DEV' as const, issueKeys: ['A-1', 'A-2'] }],
    ];
    expect(collectSourceKeys(tiersList).sort()).toEqual(['A-1', 'A-2', 'A-9']);
  });
});

describe('backfill plan', () => {
  it('fills both empty fields from the [DEV] story', () => {
    const target = makeTarget('ENCUC-10', { issuelinks: [makeLink('ENCUC-1', '[DEV] Thing')] });
    const plan = buildBackfillPlan([target], [makeSource('ENCUC-1', 'Dev description', 'Dev AC')], FIELD_CONFIG);
    expect(plan[0].description).toMatchObject({ action: 'write', sourceKey: 'ENCUC-1', tierName: 'DEV', value: 'Dev description' });
    expect(plan[0].acceptanceCriteria).toMatchObject({ action: 'write', sourceKey: 'ENCUC-1', value: 'Dev AC' });
  });

  it('never touches a field that already has content', () => {
    const target = makeTarget('ENCUC-10', {
      issuelinks: [makeLink('ENCUC-1', '[DEV] Thing')],
      description: 'Someone already wrote this',
    });
    const plan = buildBackfillPlan([target], [makeSource('ENCUC-1', 'Dev description', 'Dev AC')], FIELD_CONFIG);
    expect(plan[0].description.action).toBe('has-content');
    expect(plan[0].acceptanceCriteria.action).toBe('write');
  });

  it('falls through a blank [DEV] value to the Defect, then the parent, per field', () => {
    const target = makeTarget('ENCUC-10', {
      issuelinks: [makeLink('ENCUC-1', '[DEV] Thing'), makeLink('ENCUC-2', 'Bug', 'Defect')],
      parent: { key: 'ENCUC-3' },
    });
    const plan = buildBackfillPlan(
      [target],
      [makeSource('ENCUC-1', '', null), makeSource('ENCUC-2', 'Defect description', null), makeSource('ENCUC-3', 'x', 'Parent AC')],
      FIELD_CONFIG,
    );
    expect(plan[0].description).toMatchObject({ action: 'write', sourceKey: 'ENCUC-2', tierName: 'Defect' });
    expect(plan[0].acceptanceCriteria).toMatchObject({ action: 'write', sourceKey: 'ENCUC-3', tierName: 'Parent' });
  });

  it('refuses to guess between two different [DEV] values', () => {
    const target = makeTarget('ENCUC-10', {
      issuelinks: [makeLink('ENCUC-1', '[DEV] One'), makeLink('ENCUC-2', '[DEV] Two')],
    });
    const plan = buildBackfillPlan(
      [target], [makeSource('ENCUC-1', 'First', 'AC'), makeSource('ENCUC-2', 'Second', 'AC')], FIELD_CONFIG,
    );
    expect(plan[0].description).toMatchObject({ action: 'ambiguous', candidateKeys: ['ENCUC-1', 'ENCUC-2'] });
    // Identical values in one tier are not ambiguous — either copy says the same thing.
    expect(plan[0].acceptanceCriteria).toMatchObject({ action: 'write', value: 'AC' });
  });

  it('reports no source when nothing in the chain has content', () => {
    const plan = buildBackfillPlan([makeTarget('ENCUC-10')], [], FIELD_CONFIG);
    expect(plan[0].description.action).toBe('no-source');
    expect(plan[0].acceptanceCriteria.action).toBe('no-source');
  });

  it('counts AC as present when ANY Acceptance Criteria field holds it', () => {
    const config: BackfillFieldConfig = { ...FIELD_CONFIG, acReadFieldIds: [AC_FIELD_ID, 'customfield_old'] };
    const target = makeTarget('ENCUC-10', { customfield_old: 'Legacy AC', issuelinks: [makeLink('ENCUC-1', '[DEV] x')] });
    const plan = buildBackfillPlan([target], [makeSource('ENCUC-1', 'd', 'Dev AC')], config);
    expect(plan[0].acceptanceCriteria.action).toBe('has-content');
  });

  it('skips a non-text AC value instead of writing an object', () => {
    const target = makeTarget('ENCUC-10', { issuelinks: [makeLink('ENCUC-1', '[DEV] x')] });
    const source: BackfillIssue = { key: 'ENCUC-1', fields: { description: 'd', [AC_FIELD_ID]: { type: 'doc' } } };
    const plan = buildBackfillPlan([target], [source], FIELD_CONFIG);
    expect(plan[0].acceptanceCriteria.action).toBe('no-source');
  });
});

describe('update payload', () => {
  it('writes only the planned fields that are STILL empty at apply time', () => {
    const target = makeTarget('ENCUC-10', { issuelinks: [makeLink('ENCUC-1', '[DEV] x')] });
    const [row] = buildBackfillPlan([target], [makeSource('ENCUC-1', 'Dev description', 'Dev AC')], FIELD_CONFIG);

    expect(buildUpdateFields(row, { description: null, [AC_FIELD_ID]: '' }, FIELD_CONFIG)).toEqual({
      description: 'Dev description',
      [AC_FIELD_ID]: 'Dev AC',
    });
    // Somebody filled the description between preview and apply: leave it alone.
    expect(buildUpdateFields(row, { description: 'New text', [AC_FIELD_ID]: null }, FIELD_CONFIG)).toEqual({
      [AC_FIELD_ID]: 'Dev AC',
    });
  });
});
