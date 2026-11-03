// TestStoryBackfillPanel.test.tsx — Proves the backfill panel writes nothing until Apply, and only empty fields.
//
// The panel writes to production Jira in bulk, so the assertions here are about restraint: Preview
// performs reads only, Apply re-reads each issue first, and a field filled since the preview is skipped.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestStoryBackfillPanel } from './TestStoryBackfillPanel.tsx';

const jiraGetMock = vi.fn();
const jiraPutMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  jiraPut: (...args: unknown[]) => jiraPutMock(...args),
}));

const AC_FIELD_ID = 'customfield_20001';
const EPIC_LINK_FIELD_ID = 'customfield_20002';

const TARGET_ISSUE = {
  key: 'ENCUC-10',
  fields: {
    summary: '[SL] Login page',
    status: { name: 'To Do' },
    description: null,
    [AC_FIELD_ID]: null,
    issuelinks: [{ outwardIssue: { key: 'ENCUC-1', fields: { summary: '[DEV] Login page', issuetype: { name: 'Story' } } } }],
  },
};

const DEV_ISSUE = {
  key: 'ENCUC-1',
  fields: { summary: '[DEV] Login page', description: 'Dev description', [AC_FIELD_ID]: 'Dev AC' },
};

/** Answers the field catalogue, the target search, the source lookup, and the fresh re-read. */
function stubReads(freshFields: Record<string, unknown>): void {
  jiraGetMock.mockImplementation(async (path: string) => {
    if (path === '/rest/api/2/field') {
      return [
        { id: AC_FIELD_ID, name: 'Acceptance Criteria' },
        { id: EPIC_LINK_FIELD_ID, name: 'Epic Link' },
      ];
    }
    if (path.includes('/search') && decodeURIComponent(path).includes('key in (')) return { issues: [DEV_ISSUE], total: 1 };
    if (path.includes('/search')) return { issues: [TARGET_ISSUE], total: 1 };
    if (path.includes('/rest/api/2/issue/ENCUC-10')) return { key: 'ENCUC-10', fields: freshFields };
    return {};
  });
}

/** Renders the panel and runs the preview. */
async function renderAndPreview(): Promise<void> {
  render(<TestStoryBackfillPanel />);
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(screen.getByText(/2 empty fields can be filled/)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  jiraPutMock.mockResolvedValue(undefined);
});

describe('TestStoryBackfillPanel', () => {
  it('defaults to ENCUC and ENFCT', () => {
    stubReads({});
    render(<TestStoryBackfillPanel />);
    expect((screen.getByLabelText(/Project keys/) as HTMLInputElement).value).toBe('ENCUC, ENFCT');
  });

  it('previews without writing anything', async () => {
    stubReads({});
    await renderAndPreview();
    expect(screen.getAllByText('Fill from ENCUC-1 (DEV)')).toHaveLength(2);
    expect(jiraPutMock).not.toHaveBeenCalled();
  });

  it('writes both empty fields on Apply', async () => {
    stubReads({ description: null, [AC_FIELD_ID]: null });
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Apply/ }));
    await waitFor(() => expect(jiraPutMock).toHaveBeenCalledTimes(1));
    expect(jiraPutMock).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-10', {
      fields: { description: 'Dev description', [AC_FIELD_ID]: 'Dev AC' },
    });
  });

  it('skips the write when the issue was filled after the preview', async () => {
    stubReads({ description: 'Typed by hand', [AC_FIELD_ID]: 'Also typed' });
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Apply/ }));
    await waitFor(() => expect(screen.getByText(/filled in since the preview/)).toBeTruthy());
    expect(jiraPutMock).not.toHaveBeenCalled();
  });
});
