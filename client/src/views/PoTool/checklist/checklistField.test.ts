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
  fetchChecklistFromIssueProperties,
  fetchEpicChecklistSource,
  findChecklistFieldInIssue,
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

describe('findChecklistFieldInIssue — the checklist is recognised by its own syntax', () => {
  it('prefers the field that was looked for when it holds a checklist', () => {
    const found = findChecklistFieldInIssue(
      { [CHECKLIST_FIELD_ID]: '- [ ] Major dependencies are identified', other: '- [x] Something else' },
      CHECKLIST_FIELD_ID,
    );

    expect(found).toEqual({ fieldId: CHECKLIST_FIELD_ID, text: '- [ ] Major dependencies are identified' });
  });

  it('finds the checklist in another field when the named one is empty', () => {
    // The reported defect: Jira showed 0/11 while the named field held nothing, so the review saw no items.
    const found = findChecklistFieldInIssue(
      { [CHECKLIST_FIELD_ID]: '', customfield_99999: '# DoR\n- [ ] Major dependencies are identified' },
      CHECKLIST_FIELD_ID,
    );

    expect(found?.fieldId).toBe('customfield_99999');
  });

  it('finds nothing when no field holds anything checklist-shaped', () => {
    expect(findChecklistFieldInIssue({ summary: 'An Epic', description: 'Some prose.' }, CHECKLIST_FIELD_ID)).toBeNull();
  });
});

describe('fetchEpicChecklistSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for every field, because the checklist is not always where its name suggests', async () => {
    vi.mocked(jiraGet).mockResolvedValue({
      key: 'DENP-1436',
      fields: {
        summary: 'Preprocessor MBI History Enhancement',
        status: { name: 'In Progress' },
        description: 'Stakeholders signed off.',
        customfield_ac: 'Given a member enrols…',
        [CHECKLIST_FIELD_ID]: '- [ ] Major dependencies are identified',
      },
    } as never);

    const source = await fetchEpicChecklistSource('DENP-1436', CHECKLIST_FIELD_ID, 'customfield_ac');

    expect(vi.mocked(jiraGet).mock.calls[0][0]).toContain('fields=*all');
    expect(source.checklistText).toBe('- [ ] Major dependencies are identified');
    expect(source.checklistLocation.fieldId).toBe(CHECKLIST_FIELD_ID);
    expect(source.acceptanceCriteria).toBe('Given a member enrols…');
  });

  it('reports no checklist location rather than pretending, when no field holds one', async () => {
    vi.mocked(jiraGet).mockResolvedValue({ key: 'DENP-1436', fields: { summary: 'An Epic' } } as never);

    const source = await fetchEpicChecklistSource('DENP-1436', CHECKLIST_FIELD_ID, null);

    expect(source.checklistText).toBe('');
    expect(source.checklistLocation.fieldId).toBeNull();
  });
});

describe('fetchChecklistFromIssueProperties — the fallback for versions that store it there', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a checklist out of the matching issue property', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce({ keys: [{ key: 'com.example.smartchecklist' }] } as never)
      .mockResolvedValueOnce({ value: '- [ ] Major dependencies are identified' } as never);

    await expect(fetchChecklistFromIssueProperties('DENP-1436')).resolves
      .toBe('- [ ] Major dependencies are identified');
  });

  it('returns nothing when the instance has no such property', async () => {
    vi.mocked(jiraGet).mockResolvedValueOnce({ keys: [{ key: 'com.example.other' }] } as never);

    await expect(fetchChecklistFromIssueProperties('DENP-1436')).resolves.toBe('');
  });

  it('costs a fallback rather than the whole review when the endpoint refuses', async () => {
    vi.mocked(jiraGet).mockRejectedValueOnce(new Error('403'));

    await expect(fetchChecklistFromIssueProperties('DENP-1436')).resolves.toBe('');
  });
});

describe('saveEpicChecklist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the whole checklist back to the Epic through the shipped field writer', async () => {
    await saveEpicChecklist('DENP-905', CHECKLIST_FIELD_ID, '- [x] Done');

    expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('DENP-905', CHECKLIST_FIELD_ID, '- [x] Done');
  });
});
