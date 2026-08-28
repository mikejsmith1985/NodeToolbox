// reworkFetch.test.ts — Turning Jira changelog history into what the rework scan reads.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { buildReworkJql, fetchReworkIssues, readStatusHistory, toReworkIssue } from './reworkFetch.ts';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';

// Read from the central resolver: the field-mapping boundary fails any NEW file naming a custom
// field id, and a test is no exception.
const [STORY_POINTS_FIELD] = resolveStoryPointsFieldIds('');

/** One changelog entry moving an issue between two named statuses. */
function statusChange(fromName: string | null, toName: string, createdIso: string) {
  return { created: createdIso, items: [{ field: 'status', fromString: fromName, toString: toName }] };
}

describe('buildReworkJql', () => {
  it('scopes to the window when no JQL is given', () => {
    expect(buildReworkJql('', 90)).toBe('updated >= -90d ORDER BY updated DESC');
  });

  it('wraps the caller JQL so an OR inside it cannot escape the window', () => {
    // Without the brackets, "a OR b AND updated >= …" would return everything matching a, whenever.
    expect(buildReworkJql('project = A OR project = B', 30))
      .toBe('(project = A OR project = B) AND updated >= -30d ORDER BY updated DESC');
  });

  it('ignores whitespace somebody left in the box', () => {
    expect(buildReworkJql('   ', 60)).toBe('updated >= -60d ORDER BY updated DESC');
  });
});

describe('readStatusHistory', () => {
  it('reads the status it was created in from the FIRST change', () => {
    const history = readStatusHistory({
      fields: { status: { name: 'Done' } },
      changelog: {
        histories: [
          statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z'),
          statusChange('In Progress', 'Done', '2026-08-06T00:00:00.000Z'),
        ],
      },
    });

    expect(history.initialStatusName).toBe('To Do');
    expect(history.statusTransitions.map((each) => each.toStatusName)).toEqual(['In Progress', 'Done']);
  });

  it('falls back to the current status when the issue never moved', () => {
    const history = readStatusHistory({ fields: { status: { name: 'To Do' } }, changelog: { histories: [] } });

    expect(history.initialStatusName).toBe('To Do');
    expect(history.statusTransitions).toEqual([]);
  });

  it('reads history oldest first, whatever order Jira returned it in', () => {
    const history = readStatusHistory({
      fields: {},
      changelog: {
        histories: [
          statusChange('In Progress', 'Done', '2026-08-06T00:00:00.000Z'),
          statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z'),
        ],
      },
    });

    expect(history.initialStatusName).toBe('To Do');
  });

  it('ignores changes to fields other than status', () => {
    const history = readStatusHistory({
      fields: { status: { name: 'To Do' } },
      changelog: {
        histories: [{ created: '2026-08-03T00:00:00.000Z', items: [{ field: 'assignee', toString: 'Somebody' }] }],
      },
    });

    expect(history.statusTransitions).toEqual([]);
  });

  it('drops a history entry with no readable timestamp rather than failing', () => {
    const history = readStatusHistory({
      fields: { status: { name: 'To Do' } },
      changelog: { histories: [{ items: [{ field: 'status', toString: 'Done' }] }] },
    });

    expect(history.statusTransitions).toEqual([]);
  });
});

describe('toReworkIssue', () => {
  it('carries the key, summary, assignee and points the report shows', () => {
    const issue = toReworkIssue({
      key: 'ENCUC-1',
      fields: {
        summary: 'Wire up intake',
        status: { name: 'Done' },
        assignee: { displayName: 'Reynolds, Kevin' },
        [STORY_POINTS_FIELD]: 5,
      },
      changelog: { histories: [] },
    }, STORY_POINTS_FIELD);

    expect(issue.key).toBe('ENCUC-1');
    expect(issue.summary).toBe('Wire up intake');
    expect(issue.assigneeName).toBe('Reynolds, Kevin');
    expect(issue.storyPoints).toBe(5);
  });

  it('reads points held as a string, which some Jira configurations return', () => {
    const issue = toReworkIssue({ key: 'A-1', fields: { [STORY_POINTS_FIELD]: '8' } }, STORY_POINTS_FIELD);

    expect(issue.storyPoints).toBe(8);
  });

  it('reports an unassigned issue as unassigned rather than failing', () => {
    expect(toReworkIssue({ key: 'A-1', fields: { assignee: null } }, STORY_POINTS_FIELD).assigneeName).toBeNull();
  });
});

describe('fetchReworkIssues', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('asks for the changelog, without which there is nothing to measure', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchReworkIssues('project = ENCUC', 90);

    expect(String(mockJiraGet.mock.calls[0][0])).toContain('expand=changelog');
  });

  it('reads a second page when the first one filled', async () => {
    const fullPage = Array.from({ length: 100 }, (_unused, index) => ({
      key: `A-${index}`, fields: { status: { name: 'Done' } }, changelog: { histories: [] },
    }));
    mockJiraGet.mockResolvedValueOnce({ issues: fullPage }).mockResolvedValueOnce({ issues: [] });

    const result = await fetchReworkIssues('', 90);

    expect(mockJiraGet).toHaveBeenCalledTimes(2);
    expect(result.issues).toHaveLength(100);
    expect(result.wasTruncated).toBe(false);
  });

  it('says when it stopped short, so a sample is never quoted as the whole scope', async () => {
    // A report that silently described the first hundred of a thousand would be worse than one that
    // refused, because nothing on screen would say so.
    const fullPage = Array.from({ length: 100 }, (_unused, index) => ({
      key: `A-${index}`, fields: {}, changelog: { histories: [] },
    }));
    mockJiraGet.mockResolvedValue({ issues: fullPage });

    const result = await fetchReworkIssues('', 90);

    expect(result.wasTruncated).toBe(true);
  });

  it('stops on a short page rather than asking for another', async () => {
    mockJiraGet.mockResolvedValue({ issues: [{ key: 'A-1', fields: {}, changelog: { histories: [] } }] });

    await fetchReworkIssues('', 90);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });
});

describe('buildReworkJql — a bare project key (GH #376)', () => {
  it('reads a bare project key as a project clause', () => {
    // Somebody typing ENCUC into a box labelled "scope" has said exactly what they meant. Wrapping it
    // as "(ENCUC) AND updated >= …" produced a Jira parse error that blamed them for it.
    expect(buildReworkJql('ENCUC', 90)).toBe('(project = ENCUC) AND updated >= -90d ORDER BY updated DESC');
  });

  it('leaves a real JQL condition exactly as written', () => {
    expect(buildReworkJql('issuetype = Story', 90))
      .toBe('(issuetype = Story) AND updated >= -90d ORDER BY updated DESC');
  });

  it('does not mistake a clause that merely starts with a word for a project key', () => {
    expect(buildReworkJql('project in (A, B)', 30)).toContain('(project in (A, B))');
  });

  it('trims a key somebody pasted with spaces around it', () => {
    expect(buildReworkJql('  ENCUC  ', 90)).toContain('project = ENCUC');
  });
});
