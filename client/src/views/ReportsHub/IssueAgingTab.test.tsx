// IssueAgingTab.test.tsx — Verifies the Aging tab wires the pure compute core to Jira: it builds a
// `statusCategory != Done` scope query, pages through the whole backlog, maps each issue to the engine's
// input shape, and renders the overall headline plus a per-issue-type row of computed ages. It also
// confirms the scope persists to localStorage. The age math itself is covered by issueAging.test.ts.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../store/aiAssistStore.ts';

// A single mock for the Jira client, routed by request path so one implementation answers the search.
const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

// The clipboard helper the "Copy JQL" button calls; mocked so a click can be asserted without a real
// clipboard in jsdom.
const { mockCopyToClipboard } = vi.hoisted(() => ({ mockCopyToClipboard: vi.fn() }));

vi.mock('../FeatureCanvas/ai/clipboard.ts', () => ({
  copyToClipboard: mockCopyToClipboard,
}));

import { IssueAgingTab } from './IssueAgingTab.tsx';

const SCOPE_STORAGE_KEY = 'tbxIssueAgingScope';

/** Builds a raw Jira issue of the given type, created a whole number of days before the fixed test clock. */
function issueAgedDays(issueType: string, ageDays: number, key = `${issueType}-${ageDays}`) {
  const createdMs = Date.parse('2026-07-09T00:00:00.000Z') - ageDays * 86_400_000;
  return {
    key,
    fields: {
      issuetype: { name: issueType },
      created: new Date(createdMs).toISOString(),
      status: { statusCategory: { key: 'indeterminate' } },
    },
  };
}

/** Returns every `/rest/api/2/search` path the mock was called with, URL-decoded for substring assertions. */
function decodedSearchPaths(): string[] {
  return mockJiraGet.mock.calls
    .map(([path]) => decodeURIComponent(String(path)))
    .filter((path) => path.includes('/rest/api/2/search'));
}

describe('IssueAgingTab', () => {
  beforeEach(() => {
    // Fake only Date so the injected `todayIso` is deterministic while promises stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'));
    mockJiraGet.mockReset();
    mockCopyToClipboard.mockReset();
    localStorage.removeItem(SCOPE_STORAGE_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(SCOPE_STORAGE_KEY);
    act(() => setAiAssistUnlocked(false));
  });

  it('disables Run until a scope is entered', () => {
    render(<IssueAgingTab />);
    const runButton = screen.getByRole('button', { name: /run report/i });
    expect(runButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    expect(runButton).toBeEnabled();
  });

  it('runs the aging report and renders the headline, per-type rows, buckets, oldest key, and the All row', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/rest/api/2/search')) {
        return Promise.resolve({
          issues: [
            issueAgedDays('Story', 3, 'ENCUC-1'), // 0–7 bucket
            issueAgedDays('Story', 20, 'ENCUC-2'), // 8–30 bucket; Story avg = 11.5
            issueAgedDays('Bug', 120, 'ENCUC-9'), // 90+ bucket; Bug avg = 120, the oldest overall
          ],
          total: 3,
        });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // The overall headline KPI cards name the total open count and the overall average age (3+20+120)/3 ≈ 47.67.
    await waitFor(() => expect(screen.getByText('Open issues')).toBeInTheDocument());
    expect(screen.getByText('Open issues').nextElementSibling?.textContent).toBe('3');
    expect(screen.getByText(/overall avg age/i).nextElementSibling?.textContent).toBe('47.67');

    // Columns: Type | Count | Avg | Median | Oldest | 0–7d | 8–30d | 31–90d | 90+d.
    // The Bug row (oldest average, sorts first): its Oldest cell shows the age AND the issue key.
    const bugRow = screen.getByText('Bug').closest('tr') as HTMLElement;
    const bugCells = Array.from(bugRow.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
    expect(bugCells[1]).toBe('1');
    expect(bugCells[2]).toBe('120');
    expect(bugCells[4]).toBe('120d · ENCUC-9'); // Oldest cell carries the oldest issue's key
    expect(bugCells[8]).toBe('1'); // 90+d bucket

    const storyRow = screen.getByText('Story').closest('tr') as HTMLElement;
    const storyCells = Array.from(storyRow.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
    expect(storyCells[1]).toBe('2');
    expect(storyCells[5]).toBe('1'); // 0–7d bucket
    expect(storyCells[6]).toBe('1'); // 8–30d bucket

    // The emphasised overall "All" row aggregates every type: count 3, buckets spread 1/1/0/1.
    // Matched by its first cell so the caption's bold "All" word is never picked up instead.
    const allRow = Array.from(document.querySelectorAll('tr'))
      .find((tableRow) => tableRow.querySelector('td')?.textContent === 'All') as HTMLElement;
    const allCells = Array.from(allRow.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
    expect(allCells[1]).toBe('3'); // total open count
    expect(allCells[5]).toBe('1'); // 0–7d
    expect(allCells[6]).toBe('1'); // 8–30d
    expect(allCells[8]).toBe('1'); // 90+d

    // The fetched JQL restricts to open work and carries the user's scope.
    const searchPath = decodedSearchPaths()[0] ?? '';
    expect(searchPath).toContain('statusCategory != Done');
    expect(searchPath).toContain('project = ENCUC');
  });

  it('pages through a backlog larger than one page and counts every issue across pages', async () => {
    // First page reports a total of 150 (> one 100-issue page); the second page completes the set.
    const firstPage = Array.from({ length: 100 }, () => issueAgedDays('Story', 5));
    const secondPage = Array.from({ length: 50 }, () => issueAgedDays('Bug', 5));
    mockJiraGet.mockImplementation((path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('/rest/api/2/search')) {
        if (decoded.includes('startAt=0')) {
          return Promise.resolve({ issues: firstPage, total: 150 });
        }
        return Promise.resolve({ issues: secondPage, total: 150 });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // All 150 issues across both pages are counted in the headline's "Open issues" KPI card.
    await waitFor(() => expect(screen.getByText('Open issues').nextElementSibling?.textContent).toBe('150'));
    // Both a first page (startAt=0) and a second page (startAt=100) were fetched.
    const searchPaths = decodedSearchPaths();
    expect(searchPaths.some((path) => path.includes('startAt=0'))).toBe(true);
    expect(searchPaths.some((path) => path.includes('startAt=100'))).toBe(true);
  });

  it('surfaces a fetch error as a role="alert" message', async () => {
    mockJiraGet.mockImplementation(() => Promise.reject(new Error('Jira GET search failed: 500')));

    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    const alertNode = await screen.findByRole('alert');
    expect(alertNode).toHaveTextContent(/500/);
  });

  it('persists the scope JQL to the tbxIssueAgingScope localStorage key', () => {
    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = SAVED' } });

    const persisted = JSON.parse(localStorage.getItem(SCOPE_STORAGE_KEY) ?? '{}');
    expect(persisted.scopeJql).toBe('project = SAVED');
  });

  it('no longer renders the AI cleanup triage here — it moved to the Team Dashboard', async () => {
    // Even with AI Assist unlocked, this tab is metrics-only now; the actionable triage lives on the
    // Team Dashboard's Backlog Remediation panel.
    act(() => setAiAssistUnlocked(true));
    mockJiraGet.mockImplementation(() => Promise.resolve({ issues: [issueAgedDays('Story', 3)], total: 1 }));

    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // The metrics still render...
    await waitFor(() => expect(screen.getByText('Open issues')).toBeInTheDocument());
    // ...but no triage prompt/panel appears, and the metrics fetch is a single search (no `key in` second hop).
    expect(screen.queryByLabelText(/ai cleanup triage/i)).toBeNull();
    expect(decodedSearchPaths().some((searchPath) => searchPath.includes('key in ('))).toBe(false);
  });

  it('copies the exact queried JQL to the clipboard when Copy JQL is clicked', async () => {
    mockJiraGet.mockImplementation(() => Promise.resolve({ issues: [issueAgedDays('Story', 3)], total: 1 }));

    render(<IssueAgingTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    const copyButton = await screen.findByRole('button', { name: /copy jql/i });
    fireEvent.click(copyButton);
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      '(project = ENCUC) AND statusCategory != Done ORDER BY created ASC',
    );
  });
});
