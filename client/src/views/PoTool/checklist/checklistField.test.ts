// checklistField.test.ts — Finding the checklist field is the step that decides whether this tool reads the
// right thing, the wrong thing, or honestly nothing. These cover all three.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
}));

import { jiraGet } from '../../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';
import {
  fetchEpicChecklistSource,
  loadChecklistField,
  resolveChecklistField,
  saveEpicChecklist,
} from './checklistField.ts';

const CHECKLIST_FIELD_ID = 'customfield_22222';

describe('resolveChecklistField', () => {
  it('finds the Smart Checklist field and says which one it used', () => {
    const resolution = resolveChecklistField([
      { id: 'summary', name: 'Summary' },
      { id: CHECKLIST_FIELD_ID, name: 'Smart Checklist' },
    ]);

    expect(resolution.fieldId).toBe(CHECKLIST_FIELD_ID);
    expect(resolution.fieldName).toBe('Smart Checklist');
  });

  it('matches the other names the app is known by, whatever the spacing and case', () => {
    expect(resolveChecklistField([{ id: 'customfield_1', name: 'checklist  text' }]).fieldId).toBe('customfield_1');
    expect(resolveChecklistField([{ id: 'customfield_2', name: 'Checklist' }]).fieldId).toBe('customfield_2');
  });

  it('reports every candidate, so an instance carrying two can be told it has two', () => {
    const resolution = resolveChecklistField([
      { id: 'customfield_1', name: 'Smart Checklist' },
      { id: 'customfield_2', name: 'Checklist Text' },
    ]);

    expect(resolution.matchedFieldIds).toEqual(['customfield_1', 'customfield_2']);
  });

  it('resolves to nothing rather than guessing when the instance has no such field', () => {
    const resolution = resolveChecklistField([{ id: 'summary', name: 'Summary' }]);

    expect(resolution.fieldId).toBeNull();
    expect(resolution.fieldName).toBeNull();
  });
});

describe('loadChecklistField', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the instance for its own field list', async () => {
    vi.mocked(jiraGet).mockResolvedValue([{ id: CHECKLIST_FIELD_ID, name: 'Smart Checklist' }] as never);

    await expect(loadChecklistField()).resolves.toMatchObject({ fieldId: CHECKLIST_FIELD_ID });
    expect(jiraGet).toHaveBeenCalledWith('/rest/api/2/field');
  });
});

describe('fetchEpicChecklistSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for the checklist and the acceptance criteria in one request', async () => {
    vi.mocked(jiraGet).mockResolvedValue({
      key: 'DENP-905',
      fields: {
        summary: 'AEP enrollment intake',
        status: { name: 'In Progress' },
        description: 'Stakeholders signed off.',
        customfield_ac: 'Given a member enrols…',
        [CHECKLIST_FIELD_ID]: '- [ ] Major dependencies are identified',
      },
    } as never);

    const source = await fetchEpicChecklistSource('DENP-905', CHECKLIST_FIELD_ID, 'customfield_ac');

    expect(vi.mocked(jiraGet).mock.calls[0][0]).toContain(CHECKLIST_FIELD_ID);
    expect(source).toEqual({
      issueKey: 'DENP-905',
      summary: 'AEP enrollment intake',
      status: 'In Progress',
      description: 'Stakeholders signed off.',
      acceptanceCriteria: 'Given a member enrols…',
      checklistText: '- [ ] Major dependencies are identified',
    });
  });

  it('leaves acceptance criteria empty when this instance has no such field', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ key: 'DENP-905', fields: {} } as never);

    const source = await fetchEpicChecklistSource('DENP-905', CHECKLIST_FIELD_ID, null);

    expect(source.acceptanceCriteria).toBe('');
    expect(source.checklistText).toBe('');
  });
});

describe('saveEpicChecklist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the whole checklist back to the Epic through the shipped field writer', async () => {
    await saveEpicChecklist('DENP-905', CHECKLIST_FIELD_ID, '- [x] Done');

    expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('DENP-905', CHECKLIST_FIELD_ID, '- [x] Done');
  });
});
