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
    const decodedPath = decodeURIComponent(path);
    if (decodedPath.includes('key in (ENCUC-10)')) return { issues: [TARGET_ISSUE], total: 1 };
    if (decodedPath.includes('key in (')) return { issues: [DEV_ISSUE], total: 1 };
    // The scan asks for summaries only, so it answers with no links or description to plan from.
    if (path.includes('/search')) return { issues: [{ key: TARGET_ISSUE.key, fields: { summary: TARGET_ISSUE.fields.summary } }], total: 1 };
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

  it('scans with summaries only, and asks for heavy fields just for the issues that matched', async () => {
    stubReads({});
    await renderAndPreview();
    const searchPaths = jiraGetMock.mock.calls
      .map(([path]) => decodeURIComponent(String(path)))
      .filter((path) => path.includes('/search'));
    expect(searchPaths[0]).toContain('statusCategory != Done');
    expect(searchPaths[0]).toContain('fields=summary&');
    expect(searchPaths[1]).toContain('key in (ENCUC-10)');
    expect(searchPaths[1]).toContain('issuelinks');
  });

  it('says which step failed and why, and shows the request that failed', async () => {
    stubReads({});
    const successfulReads = jiraGetMock.getMockImplementation()!;
    jiraGetMock.mockImplementation(async (path: string) => {
      if (decodeURIComponent(path).includes('key in (ENCUC-1)')) {
        throw new Error(`Jira GET ${path} failed: 400 — Proxy error: read ECONNRESET`);
      }
      return successfulReads(path);
    });
    render(<TestStoryBackfillPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const failureLine = await screen.findByText(/^Failed during source lookup/);
    expect(failureLine.textContent).toContain('read ECONNRESET');
    expect(failureLine.textContent).toContain('key in (ENCUC-1)');
    // A missing source could send a field to the wrong tier, so nothing may be offered for writing.
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
  });

  it('finishes the preview on smaller pages when the gateway refuses large ones, and says so', async () => {
    stubReads({});
    const successfulReads = jiraGetMock.getMockImplementation()!;
    jiraGetMock.mockImplementation(async (path: string) => {
      if (path.includes('/search') && path.includes('maxResults=100')) {
        throw new Error(`Jira GET ${path} failed: 502`);
      }
      return successfulReads(path);
    });
    await renderAndPreview();
    expect(screen.getByText(/gateway refused larger requests/)).toBeTruthy();
  });

  it('warns when the scan could not reach every open issue', async () => {
    stubReads({});
    const successfulReads = jiraGetMock.getMockImplementation()!;
    jiraGetMock.mockImplementation(async (path: string) => {
      const answer = await successfulReads(path);
      const isScan = path.includes('/search') && !decodeURIComponent(path).includes('key in (');
      return isScan ? { ...answer, total: 50000, issues: [] } : answer;
    });
    render(<TestStoryBackfillPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/only 0 of 50000 open issues were scanned/i)).toBeTruthy();
  });
});
