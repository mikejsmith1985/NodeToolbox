// epicCreate.test.ts — Contract tests for creating the accepted Epics (spec 037, contracts/epic-create.md): the
// create-screen pre-flight, the exact payload, and a create loop that isolates failures, never re-posts a created
// Epic, and recovers an Epic whose create outcome was lost. Every Jira call is mocked.

import { describe, expect, it, vi } from 'vitest';

import type { CreateMetaFieldEntry, JiraIssue } from '../../../types/jira.ts';
import type { TransitionRequiredField } from '../../SprintDashboard/featureReviewFixes.ts';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type CreationRecord,
  type Decision,
  type EpicIntake,
  type IntakeItem,
} from './epicIntakeModel.ts';
import {
  buildEpicCreatePayload,
  EPIC_NAME_FIELD_NAME_PATTERN,
  INTAKE_SUPPLIED_FIELD_IDS,
  readUnansweredEpicRequiredFields,
  runEpicCreates,
  type EpicCreateDeps,
  type EpicCreateScreenFields,
} from './epicCreate.ts';

// ── Builders ──

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const EPIC_NAME_FIELD_ID = 'epic_name_field';
const NO_SCREEN_FIELDS: EpicCreateScreenFields = { epicNameFieldId: null, unanswered: [] };

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'po', reason: 'test', aiAttempts: 0 };
}

function buildReadyItem(itemNumber: number, summary: string, creation: CreationRecord = { state: 'notStarted' }): IntakeItem {
  const item = createIntakeItem(itemNumber, summary, [itemNumber]);
  return {
    ...item,
    areaSizes: [{ area: 'Enrollment', canonicalArea: 'enrollment', size: 'XL', cost: '1.2M', lineNumber: itemNumber }],
    decisions: {
      kind: settled('work' as const),
      owner: settled('enrollment' as const),
      searchTerms: settled(['portal']),
      duplicate: settled({ verdict: 'createNew' as const }),
      label: settled('Roadmap' as const),
      draftAccepted: settled('accepted' as const),
    },
    searchStatus: 'ok',
    draft: { summary: `  ${summary}  `, description: 'Description:\nBuild the thing.', source: 'po', editedByPo: false },
    creation,
  };
}

function buildIntake(items: IntakeItem[], batchRequiredFieldValues: Record<string, unknown> = {}): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: [],
    items,
    setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' },
    batchRequiredFieldValues,
    roundHistory: [],
  };
}

function buildField(fieldId: string, name: string, overrides: Partial<CreateMetaFieldEntry> = {}): CreateMetaFieldEntry {
  return { fieldId, name, required: true, schema: { type: 'string' }, ...overrides };
}

function buildDeps(overrides: Partial<EpicCreateDeps> = {}): EpicCreateDeps {
  let createdCount = 0;
  return {
    createIssue: vi.fn(async () => {
      createdCount += 1;
      return { id: `${createdCount}`, key: `DENP-${700 + createdCount}`, self: '' };
    }),
    searchIssues: vi.fn(async () => []),
    nowIso: () => NOW_ISO,
    ...overrides,
  };
}

const BUSINESS_AREA_FIELD: TransitionRequiredField = {
  fieldId: 'businessArea',
  name: 'Business Area',
  schemaType: 'option',
  allowedValues: [{ id: '42', name: 'Enrollment' }],
};

// ── Pre-flight ──

describe('readUnansweredEpicRequiredFields', () => {
  it('fills Epic Name from the summary and asks nothing when it is the only extra required field', () => {
    const screenFields = readUnansweredEpicRequiredFields([
      buildField('summary', 'Summary'),
      buildField('project', 'Project'),
      buildField(EPIC_NAME_FIELD_ID, 'Epic Name'),
    ]);
    expect(screenFields).toEqual({ epicNameFieldId: EPIC_NAME_FIELD_ID, unanswered: [] });
  });

  it('asks once for any other required field without a default, mapped to the required-field picker shape', () => {
    const screenFields = readUnansweredEpicRequiredFields([
      buildField('components', 'Component/s', { schema: { type: 'array', items: 'component' }, allowedValues: [{ id: '42', name: 'Enrollment' }] }),
      buildField('area', 'Area', { schema: { type: 'option-with-child', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' } }),
      buildField('reporter', 'Reporter', { hasDefaultValue: true }),
      buildField('priority', 'Priority', { required: false }),
    ]);
    expect(screenFields.epicNameFieldId).toBeNull();
    expect(screenFields.unanswered).toEqual([
      { fieldId: 'components', name: 'Component/s', schemaType: 'array', allowedValues: [{ id: '42', name: 'Enrollment' }] },
      { fieldId: 'area', name: 'Area', schemaType: 'option-with-child', allowedValues: [] },
    ]);
  });

  it('leaves Epic Name out when the screen does not require it', () => {
    expect(readUnansweredEpicRequiredFields([buildField(EPIC_NAME_FIELD_ID, 'Epic Name', { required: false })]).epicNameFieldId).toBeNull();
  });

  it('matches the Epic Name field by name, loosely spaced and in any case', () => {
    expect(EPIC_NAME_FIELD_NAME_PATTERN.test('epic  name')).toBe(true);
    expect(EPIC_NAME_FIELD_NAME_PATTERN.test('Epic Name Link')).toBe(false);
    expect(INTAKE_SUPPLIED_FIELD_IDS).toEqual(['project', 'issuetype', 'summary', 'description', 'labels']);
  });
});

// ── Payload ──

describe('buildEpicCreatePayload', () => {
  it('writes the project, type, trimmed summary, nine-section description, and exactly one label — no sizes or costs', () => {
    const item = buildReadyItem(1, 'Member portal');
    const payload = buildEpicCreatePayload(item, buildIntake([item]), null);
    expect(payload.fields).toMatchObject({
      project: { key: 'DENP' },
      issuetype: { id: '10000' },
      summary: 'Member portal',
      labels: ['Roadmap'],
    });
    expect(Object.keys(payload.fields)).toEqual(['project', 'issuetype', 'summary', 'description', 'labels']);
    expect(payload.fields.description).toContain('Description:\nBuild the thing.');
    expect(payload.fields.description).toContain('Out of Scope:');
    expect(JSON.stringify(payload)).not.toMatch(/XL|1\.2M/);
  });

  it('adds Epic Name only when the screen requires it', () => {
    const item = buildReadyItem(1, 'Member portal');
    expect(buildEpicCreatePayload(item, buildIntake([item]), EPIC_NAME_FIELD_ID).fields[EPIC_NAME_FIELD_ID]).toBe('Member portal');
  });

  it('merges the batch answers to the create screen\'s required fields', () => {
    const item = buildReadyItem(1, 'Member portal');
    const intake = buildIntake([item], { businessArea: { optionId: '42' } });
    expect(buildEpicCreatePayload(item, intake, null, [BUSINESS_AREA_FIELD]).fields.businessArea).toEqual({ id: '42' });
  });

  it('refuses an item that is not ready, has no settled label, or has no draft', () => {
    const readyItem = buildReadyItem(1, 'Member portal');
    const declinedItem = { ...readyItem, decisions: { ...readyItem.decisions, draftAccepted: settled('declined' as const) } };
    const unlabelledItem = { ...readyItem, decisions: { ...readyItem.decisions, label: { state: 'notApplicable' as const, reason: 'x' } } };
    const draftlessItem = { ...readyItem, draft: null };
    for (const item of [declinedItem, unlabelledItem, draftlessItem]) {
      expect(() => buildEpicCreatePayload(item, buildIntake([item]), null)).toThrow();
    }
  });
});

// ── The loop ──

describe('runEpicCreates', () => {
  it('creates every ready item in order, saving creating then created for each', async () => {
    const deps = buildDeps();
    const progressStates: string[] = [];
    const createdIntake = await runEpicCreates(
      buildIntake([buildReadyItem(1, 'Portal'), buildReadyItem(2, 'Cards')]),
      deps,
      (progressIntake) => progressStates.push(progressIntake.items.map((item) => item.creation.state).join('/')),
      NO_SCREEN_FIELDS,
    );
    expect(progressStates).toEqual(['creating/notStarted', 'created/notStarted', 'created/creating', 'created/created']);
    expect(createdIntake.items.map((item) => item.creation)).toEqual([
      { state: 'created', key: 'DENP-701', createdAtIso: NOW_ISO },
      { state: 'created', key: 'DENP-702', createdAtIso: NOW_ISO },
    ]);
  });

  it('records Jira\'s reason for a failure and carries on with the next item', async () => {
    const createIssue = vi.fn()
      .mockRejectedValueOnce(new Error('Epic Name is required.'))
      .mockResolvedValueOnce({ id: '2', key: 'DENP-702', self: '' });
    const createdIntake = await runEpicCreates(
      buildIntake([buildReadyItem(1, 'Portal'), buildReadyItem(2, 'Cards')]),
      buildDeps({ createIssue }),
      () => undefined,
      NO_SCREEN_FIELDS,
    );
    expect(createdIntake.items[0].creation).toEqual({ state: 'failed', reason: 'Epic Name is required.', failedAtIso: NOW_ISO });
    expect(createdIntake.items[1].creation).toMatchObject({ state: 'created', key: 'DENP-702' });
  });

  it('a retry re-posts only the failed items and never a created one', async () => {
    const createdItem = buildReadyItem(1, 'Portal', { state: 'created', key: 'DENP-632', createdAtIso: NOW_ISO });
    const failedItem = buildReadyItem(2, 'Cards', { state: 'failed', reason: 'boom', failedAtIso: NOW_ISO });
    const deps = buildDeps();
    const createdIntake = await runEpicCreates(buildIntake([createdItem, failedItem]), deps, () => undefined, NO_SCREEN_FIELDS);
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
    expect(createdIntake.items[0].creation).toEqual(createdItem.creation);
    expect(createdIntake.items[1].creation).toMatchObject({ state: 'created' });
  });

  it('adopts an exact-summary Epic the user created today when an item was left creating, without posting', async () => {
    const searchIssues = vi.fn(async () => [
      { key: 'DENP-800', fields: { summary: 'Portal work' } },
      { key: 'DENP-801', fields: { summary: ' portal ' } },
    ] as unknown as JiraIssue[]);
    const deps = buildDeps({ searchIssues });
    const strandedItem = buildReadyItem(1, 'Portal', { state: 'creating', startedAtIso: NOW_ISO });
    const createdIntake = await runEpicCreates(buildIntake([strandedItem]), deps, () => undefined, NO_SCREEN_FIELDS);
    expect(createdIntake.items[0].creation).toEqual({ state: 'created', key: 'DENP-801', createdAtIso: NOW_ISO });
    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(searchIssues).toHaveBeenCalledWith(
      'project = "DENP" AND issuetype = "Epic" AND summary ~ "Portal" AND creator = currentUser() AND created >= -1d',
      expect.anything(),
      expect.any(Number),
    );
  });

  it('checks a failed item before re-posting it, in case Jira created it but the answer was lost', async () => {
    const searchIssues = vi.fn(async () => [{ key: 'DENP-900', fields: { summary: 'Cards' } }] as unknown as JiraIssue[]);
    const deps = buildDeps({ searchIssues });
    const failedItem = buildReadyItem(1, 'Cards', { state: 'failed', reason: 'timeout', failedAtIso: NOW_ISO });
    const createdIntake = await runEpicCreates(buildIntake([failedItem]), deps, () => undefined, NO_SCREEN_FIELDS);
    expect(createdIntake.items[0].creation).toMatchObject({ state: 'created', key: 'DENP-900' });
    expect(deps.createIssue).not.toHaveBeenCalled();
  });

  it('posts a stranded item when no matching Epic exists', async () => {
    const deps = buildDeps();
    const strandedItem = buildReadyItem(1, 'Portal', { state: 'creating', startedAtIso: NOW_ISO });
    const createdIntake = await runEpicCreates(buildIntake([strandedItem]), deps, () => undefined, NO_SCREEN_FIELDS);
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
    expect(createdIntake.items[0].creation).toMatchObject({ state: 'created', key: 'DENP-701' });
  });

  it('does not post a stranded item when the recovery search itself fails', async () => {
    const deps = buildDeps({ searchIssues: vi.fn(async () => { throw new Error('Jira GET failed: 500'); }) });
    const strandedItem = buildReadyItem(1, 'Portal', { state: 'creating', startedAtIso: NOW_ISO });
    const createdIntake = await runEpicCreates(buildIntake([strandedItem]), deps, () => undefined, NO_SCREEN_FIELDS);
    expect(deps.createIssue).not.toHaveBeenCalled();
    expect(createdIntake.items[0].creation).toMatchObject({ state: 'failed' });
    expect((createdIntake.items[0].creation as { reason: string }).reason).toContain('Jira GET failed: 500');
  });

  it('sends Epic Name and the batch answers with every Epic', async () => {
    const deps = buildDeps();
    const intake = buildIntake([buildReadyItem(1, 'Portal')], { businessArea: { optionId: '42' } });
    await runEpicCreates(intake, deps, () => undefined, { epicNameFieldId: EPIC_NAME_FIELD_ID, unanswered: [BUSINESS_AREA_FIELD] });
    expect(deps.createIssue).toHaveBeenCalledWith({
      fields: expect.objectContaining({ [EPIC_NAME_FIELD_ID]: 'Portal', businessArea: { id: '42' } }),
    });
  });

  it('refuses to start while the create screen still has unanswered required fields', async () => {
    const deps = buildDeps();
    await expect(
      runEpicCreates(buildIntake([buildReadyItem(1, 'Portal')]), deps, () => undefined, { epicNameFieldId: null, unanswered: [BUSINESS_AREA_FIELD] }),
    ).rejects.toThrow(/Business Area/);
    expect(deps.createIssue).not.toHaveBeenCalled();
  });

  it('refuses to start without a resolved Epic type', async () => {
    const intake = { ...buildIntake([buildReadyItem(1, 'Portal')]), epicType: { state: 'missing' as const, offeredTypeNames: ['Feature'] } };
    await expect(runEpicCreates(intake, buildDeps(), () => undefined, NO_SCREEN_FIELDS)).rejects.toThrow();
  });
});
