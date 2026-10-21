// savePreview.test.ts — Proves the save preview lists only the writing that will change, beside what ServiceNow holds now.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';
import { buildSavePreviewRows, readSavePreview } from './savePreview.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('./modifyLoad.ts', () => ({ fetchChangeSnapshot: vi.fn() }));

describe('buildSavePreviewRows', () => {
  it('keeps only the fields that change, in reading order', () => {
    const rows = buildSavePreviewRows(
      { short_description: 'Payments 1.2', backout_plan: '', test_plan: 'Smoke test' },
      { short_description: 'Payments 1.2', backout_plan: '1. Redeploy v1', test_plan: 'Smoke test', category: 'software' },
    );
    expect(rows).toEqual([{ label: 'Backout plan', nowText: '', afterText: '1. Redeploy v1' }]);
  });
});

describe('readSavePreview', () => {
  it('compares the change as ServiceNow holds it with what the save will send', async () => {
    vi.mocked(fetchChangeSnapshot).mockResolvedValueOnce({ short_description: 'Old title', backout_plan: '' });
    const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:preview-test' })).result.current.state;
    const rows = await readSavePreview({ ...draft, generatedShortDescription: 'New title' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' });
    expect(fetchChangeSnapshot).toHaveBeenCalledWith('CHG2');
    expect(rows.find((row) => row.label === 'Title')).toEqual({ label: 'Title', nowText: 'Old title', afterText: 'New title' });
    expect(await readSavePreview(draft, { environmentLabel: null, changeNumber: 'CHG3' })).toEqual([]);
  });
});
