// ReleasePriorityPanel.test.tsx — Copy the prompt, paste the order, see it, write it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFieldMappingOverride } from '../../../services/jiraFieldMapping.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { ReleasePriorityPanel } from './ReleasePriorityPanel.tsx';
import { RELEASE_PRIORITY_REPLY_KIND } from './releasePriorityRank.ts';

const mockJiraGet = vi.fn();
const mockReadEditMeta = vi.fn();
const mockWriteSimple = vi.fn();
const mockWriteOption = vi.fn();

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: (path: string) => mockJiraGet(path),
}));

vi.mock('../featureReviewFixes.ts', () => ({
  fetchFeatureReviewEditMeta: (issueKey: string) => mockReadEditMeta(issueKey),
  saveFeatureReviewSimpleField: (issueKey: string, fieldId: string, value: string) => mockWriteSimple(issueKey, fieldId, value),
  saveFeatureReviewOptionField: (...writeArguments: unknown[]) => mockWriteOption(...writeArguments),
}));

function releaseIssue(key: string, priorityName: string): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: 'Working', statusCategory: { key: 'indeterminate' } },
      priority: { name: priorityName, iconUrl: '' },
      assignee: null,
      issuetype: { name: 'Story', iconUrl: '' },
    },
  } as unknown as JiraIssue;
}

const ISSUES = [releaseIssue('ENCUC-1', 'High'), releaseIssue('ENCUC-2', 'Medium'), releaseIssue('ENCUC-3', 'Low')];
const FEATURE_KEY_BY_ISSUE_KEY = new Map<string, string | null>([['ENCUC-1', null], ['ENCUC-2', 'FEAT-10'], ['ENCUC-3', null]]);
const FEATURE_SUMMARY_BY_KEY = new Map([['FEAT-10', 'Online enrollment intake']]);
const TODAY = '2026-09-04T12:00:00.000Z';

function installContextFixtures(): void {
  mockJiraGet.mockImplementation((path: string) => {
    if (path.includes('fields=created')) {
      return Promise.resolve({
        issues: [
          { key: 'ENCUC-1', fields: { created: '2026-09-01T10:00:00.000Z', duedate: null, customfield_10206: null } },
          { key: 'ENCUC-2', fields: { created: '2026-06-01T10:00:00.000Z', duedate: null, customfield_10206: '03' } },
          { key: 'ENCUC-3', fields: { created: '2026-08-01T10:00:00.000Z', duedate: '2026-09-01', customfield_10206: null } },
        ],
      });
    }
    return Promise.resolve({ issues: [{ key: 'FEAT-10', fields: { duedate: '2026-09-30', customfield_10102: '2026-09-10' } }] });
  });
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <ReleasePriorityPanel
      featureKeyByIssueKey={FEATURE_KEY_BY_ISSUE_KEY}
      featureSummaryByKey={FEATURE_SUMMARY_BY_KEY}
      issues={ISSUES}
      onClose={onClose}
      projectKey="ENCUC"
      releaseDate="2026-09-24"
      todayIso={TODAY}
      versionName="09/24/2026"
    />,
  );
}

function buildReply(orderedKeys: string[]): string {
  return JSON.stringify({
    kind: RELEASE_PRIORITY_REPLY_KIND,
    items: orderedKeys.map((issueKey, index) => ({ issueKey, rank: index + 1, rationale: `Reason ${issueKey}` })),
  });
}

describe('ReleasePriorityPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockJiraGet.mockReset();
    mockReadEditMeta.mockReset().mockResolvedValue({});
    mockWriteSimple.mockReset().mockResolvedValue(undefined);
    mockWriteOption.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => localStorage.clear());

  it('builds the prompt with ages, due dates, current values and the Feature dates it read from Jira', async () => {
    installContextFixtures();
    renderPanel();

    const promptField = await screen.findByLabelText('Release priority prompt') as HTMLTextAreaElement;
    await waitFor(() => expect(promptField.value).toContain('age: 95 days'));

    expect(promptField.value).toContain('Release: 09/24/2026');
    expect(promptField.value).toContain('current Status Summary: 03');
    expect(promptField.value).toContain('due: 2026-09-01');
    expect(promptField.value).toContain('feature: FEAT-10 — Online enrollment intake · feature target end: 2026-09-10 · feature due: 2026-09-30');
    // The two reads: the issues' own fields, then their Features'.
    expect(mockJiraGet).toHaveBeenCalledTimes(2);
    expect(String(mockJiraGet.mock.calls[0][0])).toContain('customfield_10206');
  });

  it('still offers a prompt when the extra reads fail, and says what is missing', async () => {
    mockJiraGet.mockRejectedValue(new Error('offline'));
    renderPanel();

    expect(await screen.findByText(/Could not read ages, due dates or Feature dates/)).toBeInTheDocument();
    const promptField = screen.getByLabelText('Release priority prompt') as HTMLTextAreaElement;
    expect(promptField.value).toContain('age: unknown');
  });

  it('previews the pasted order top-first, with 01 for the top item and the current value beside it', async () => {
    installContextFixtures();
    renderPanel();
    await waitFor(() => expect((screen.getByLabelText('Release priority prompt') as HTMLTextAreaElement).value).toContain('age:'));

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: buildReply(['ENCUC-3', 'ENCUC-2', 'ENCUC-1']) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('01');
    expect(rows[0]).toHaveTextContent('ENCUC-3');
    expect(rows[0]).toHaveTextContent('Reason ENCUC-3');
    expect(rows[1]).toHaveTextContent('02');
    expect(rows[1]).toHaveTextContent('03'); // the value ENCUC-2 holds today, about to be replaced
    expect(rows[2]).toHaveTextContent('03');
    expect(rows[2]).toHaveTextContent('ENCUC-1');
    expect(mockWriteSimple).not.toHaveBeenCalled();
  });

  it('flags a row the assistant forgot instead of hiding it', async () => {
    installContextFixtures();
    renderPanel();

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: buildReply(['ENCUC-2', 'ENCUC-1']) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));

    expect(screen.getByText(/did not rank ENCUC-3/)).toBeInTheDocument();
    expect(screen.getByText('not ranked by the assistant — appended in its original order')).toBeInTheDocument();
  });

  it('refuses a reply from another surface and writes nothing', async () => {
    installContextFixtures();
    renderPanel();

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: JSON.stringify({ kind: 'piReview', items: [] }) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match the requested/);
    expect(screen.queryByRole('button', { name: /Write Status Summary/ })).not.toBeInTheDocument();
  });

  it('writes 01, 02, 03 into the mapped Status Summary field, top of the list first, and reports each row', async () => {
    installContextFixtures();
    renderPanel();

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: buildReply(['ENCUC-3', 'ENCUC-2', 'ENCUC-1']) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));
    fireEvent.click(screen.getByRole('button', { name: '✔ Write Status Summary to Jira (3)' }));

    expect(await screen.findByText('✓ 3 written')).toBeInTheDocument();
    expect(mockWriteSimple.mock.calls).toEqual([
      ['ENCUC-3', 'customfield_10206', '01'],
      ['ENCUC-2', 'customfield_10206', '02'],
      ['ENCUC-1', 'customfield_10206', '03'],
    ]);
  });

  it('honours a Status Summary field chosen in the field mapping', async () => {
    writeFieldMappingOverride(localStorage, 'statusSummaryFieldId', 'customfield_55');
    installContextFixtures();
    renderPanel();

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: buildReply(['ENCUC-1', 'ENCUC-2', 'ENCUC-3']) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));
    fireEvent.click(screen.getByRole('button', { name: '✔ Write Status Summary to Jira (3)' }));

    await screen.findByText('✓ 3 written');
    expect(mockWriteSimple).toHaveBeenCalledWith('ENCUC-1', 'customfield_55', '01');
  });

  it('names the row Jira refused and keeps the rest written', async () => {
    installContextFixtures();
    mockWriteSimple.mockImplementation(async (issueKey: string) => {
      if (issueKey === 'ENCUC-2') throw new Error('Field cannot be set');
    });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Release priority reply'), { target: { value: buildReply(['ENCUC-3', 'ENCUC-2', 'ENCUC-1']) } });
    fireEvent.click(screen.getByRole('button', { name: '↩ Load ranking' }));
    fireEvent.click(screen.getByRole('button', { name: '✔ Write Status Summary to Jira (3)' }));

    expect(await screen.findByText('2 written · ⚠ 1 failed')).toBeInTheDocument();
    expect(screen.getByText('⚠ Field cannot be set')).toBeInTheDocument();
  });

  it('scrolls inside itself instead of growing past the screen once a long ranking is loaded', () => {
    // GH #377: a twenty-row table made the modal taller than the viewport, and the fixed overlay
    // never scrolls — so the title was clipped and the write button was unreachable.
    installContextFixtures();
    renderPanel();

    const modalElement = screen.getByRole('dialog').firstElementChild as HTMLElement;

    expect(modalElement.className).toContain('releasePriorityModal');
    expect(modalElement.className).toContain('releasePromptWideModal');
  });

  it('closes on Close', () => {
    installContextFixtures();
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
