// useChangeTaskTypeOptions.test.ts — Reading ServiceNow's own CTASK type list, so the type is picked, never typed.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { fetchChangeTaskTypeOptions } from './useChangeTaskTypeOptions.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const CHANGE_TASK_FORM_REPLY = {
  result: {
    sections: [{
      fields: [
        { name: 'short_description' },
        {
          name: 'change_task_type',
          choices: [
            { value: 'planning', label: 'Planning' },
            { value: 'implementation', label: 'Implementation' },
            { value: 'testing', label: 'Testing' },
          ],
        },
      ],
    }],
  },
};

describe('fetchChangeTaskTypeOptions', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
  });

  it('reads the CTASK types from the change_task form ServiceNow itself renders', async () => {
    vi.mocked(snowFetch).mockResolvedValue(CHANGE_TASK_FORM_REPLY as never);

    const typeOptions = await fetchChangeTaskTypeOptions();

    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('/api/now/ui/form/change_task/-1');
    expect(typeOptions).toEqual([
      { value: 'planning', label: 'Planning' },
      { value: 'implementation', label: 'Implementation' },
      { value: 'testing', label: 'Testing' },
    ]);
  });

  it('falls back to the change_task metadata when the form carries no type list', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: { sections: [] } } as never)
      .mockResolvedValueOnce({ result: { sections: [] } } as never)
      .mockResolvedValueOnce(CHANGE_TASK_FORM_REPLY as never);

    const typeOptions = await fetchChangeTaskTypeOptions();

    expect(vi.mocked(snowFetch).mock.calls[2][0]).toContain('/api/now/ui/meta/change_task');
    expect(typeOptions.map((typeOption) => typeOption.value)).toEqual(['planning', 'implementation', 'testing']);
  });

  it('says so when ServiceNow offers no type list at all, rather than guessing one', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('403'));

    await expect(fetchChangeTaskTypeOptions()).rejects.toThrow(/CTASK types/);
  });
});
