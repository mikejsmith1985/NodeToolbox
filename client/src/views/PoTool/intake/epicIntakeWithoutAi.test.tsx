// epicIntakeWithoutAi.test.tsx — The Epic Intake mode works from notes to created Epics with the assistant LOCKED,
// and no assistant affordance is reachable at any step (spec 037, FR-026, R-011, quickstart V-13).
//
// This is the intake's companion to poToolWithoutAi.test.tsx: the same sweep, driven through Feature Composition's
// Epic Intake mode by the PO's own answers alone. It lives beside the intake so the shipped sweep stays byte-identical.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore';
import type { CreateIssueRequest, JiraIssue } from '../../../types/jira.ts';
import type { IntakeJiraDeps } from './components/IntakeTurnPanel.tsx';
import EpicIntakeWorkspace from './EpicIntakeWorkspace.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const EPIC_NAME_FIELD_ID = 'epicNameField';

/** Four items that exercise every rule: sizes decide two owners, one key is named, one item is deferred. */
const FLOW_NOTES_TEXT = [
  '•\tCore Integration (denp-632)',
  'o\tXL Enrollment',
  'o\tFulfillment M',
  '•\tPaperless Options',
  '•\tInvoice overhaul',
  'o\tFulfilment dev M',
  '•\tMass ID Card Reissue - future conversation',
].join('\n');

/** The same net as poToolWithoutAi.test.tsx's findAnyAiAffordance: anything only the assist itself produces. */
function findAnyAiAffordance(): HTMLElement[] {
  return [
    ...screen.queryAllByText(/⚡/),
    ...screen.queryAllByText(/\bAI\b/),
    ...screen.queryAllByText(/assistant/i),
    ...screen.queryAllByText(/unlock/i),
    ...screen.queryAllByRole('button', { name: /prompt|reply/i }),
    ...screen.queryAllByRole('textbox', { name: /prompt|assistant/i }),
  ];
}

function buildOpenEpic(issueKey: string): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary: 'Core Integration',
      issuetype: { id: '10000', name: 'Epic' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
    },
  } as unknown as JiraIssue;
}

/** A stand-in for Jira: DENP has an Epic type, DENP-632 is open, searches find nothing, and creates succeed. */
function createFlowJiraDeps(createdRequests: CreateIssueRequest[]): IntakeJiraDeps {
  return {
    search: {
      getProjectIssueTypes: vi.fn(async () => ({ values: [{ id: '10000', name: 'Epic', subtask: false }] })),
      searchIssues: vi.fn(async () => []),
      fetchIssueByKey: vi.fn(async (issueKey: string) => buildOpenEpic(issueKey)),
      extractHttpStatus: vi.fn(() => null),
    },
    create: {
      createIssue: vi.fn(async (request: CreateIssueRequest) => {
        createdRequests.push(request);
        return { id: '900', key: 'DENP-900', self: '' };
      }),
      searchIssues: vi.fn(async () => []),
      nowIso: () => NOW_ISO,
    },
    loadCreateFields: vi.fn(async () => ({
      values: [
        { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false, schema: { type: 'string' } },
        { fieldId: EPIC_NAME_FIELD_ID, name: 'Epic Name', required: true, hasDefaultValue: false, schema: { type: 'string' } },
      ],
    })) as unknown as IntakeJiraDeps['loadCreateFields'],
  };
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup({ delay: null });
  window.localStorage.clear();
  useAiAssistStore.setState({ isAiAssistUnlocked: false });
});

/** Changes one value in the review table by its select's accessible name. Each change is saved straight away. */
async function chooseInReviewTable(selectName: RegExp, optionLabel: string): Promise<void> {
  const reviewTable = screen.getByRole('region', { name: 'Review the items' });
  const select = within(reviewTable).getByRole('combobox', { name: selectName });
  await user.selectOptions(select, within(select).getByRole('option', { name: optionLabel }));
}

describe('Epic Intake with the assistant locked', () => {
  it('runs from notes to created Epics by the PO\'s own answers, with no assistant affordance at any step', async () => {
    const createdRequests: CreateIssueRequest[] = [];
    render(<EpicIntakeWorkspace dashboardTeamProfileId="team-a" jiraDeps={createFlowJiraDeps(createdRequests)} nowIso={() => NOW_ISO} />);

    await user.click(screen.getByLabelText('Pasted notes'));
    await user.paste(FLOW_NOTES_TEXT);
    await user.click(screen.getByRole('button', { name: 'Add pasted notes' }));
    await user.click(screen.getByRole('button', { name: 'Start intake' }));
    expect(findAnyAiAffordance()).toEqual([]);

    // Review the kinds: the deferred item was settled by rule, so only three kinds are open.
    expect(screen.getByRole('combobox', { name: /Kind for "Mass ID Card Reissue/ })).toHaveValue('deferred');
    await chooseInReviewTable(/Kind for "Core Integration/, 'Work');
    await chooseInReviewTable(/Kind for "Paperless Options"/, 'Work');
    await chooseInReviewTable(/Kind for "Invoice overhaul"/, 'Work');
    expect(findAnyAiAffordance()).toEqual([]);

    // Review the owners: sizes decided Core and Invoice; only Paperless is still open.
    expect(screen.getByRole('combobox', { name: /Owner for "Core Integration/ })).toHaveValue('enrollment');
    expect(screen.getByRole('combobox', { name: /Owner for "Invoice overhaul"/ })).toHaveValue('fulfillment');
    await chooseInReviewTable(/Owner for "Paperless Options"/, 'Enrollment');

    // Check DENP: the named open Epic settles Core; the empty search makes Paperless a new Epic.
    await user.click(screen.getByRole('button', { name: 'Check DENP' }));
    await screen.findByRole('combobox', { name: /Label for "Paperless Options"/ });
    expect(screen.getByRole('combobox', { name: /DENP Epic for "Core Integration/ })).toHaveValue('DENP-632');
    expect(findAnyAiAffordance()).toEqual([]);
    await chooseInReviewTable(/Label for "Paperless Options"/, 'Roadmap');

    // Draft: the plain template is shown pre-filled; Create is the single confirmation.
    expect(screen.getByRole('textbox', { name: 'Epic summary for "Paperless Options"' })).toHaveValue('Paperless Options');
    await user.click(await screen.findByRole('button', { name: 'Create 1 Epic(s)' }));
    await screen.findByText(/Finished\./);
    expect(findAnyAiAffordance()).toEqual([]);

    expect(createdRequests).toHaveLength(1);
    expect(createdRequests[0].fields).toMatchObject({
      project: { key: 'DENP' },
      issuetype: { id: '10000' },
      summary: 'Paperless Options',
      labels: ['Roadmap'],
      [EPIC_NAME_FIELD_ID]: 'Paperless Options',
    });
    expect(JSON.stringify(createdRequests[0].fields)).not.toMatch(/\bXL\b|Fulfil/);

    const summary = screen.getByRole('region', { name: 'Summary' });
    await waitFor(() => expect(within(summary).getByRole('link', { name: 'DENP-900' })).toBeInTheDocument());
    expect(within(summary).getByRole('link', { name: 'DENP-632' })).toBeInTheDocument();
    expect(within(summary).getByText('Skipped — Fulfillment-owned')).toBeInTheDocument();
  });
});
