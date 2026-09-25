// EpicChecklistTab.test.tsx — The tab produces a readiness verdict a team acts on and can write to a real Epic,
// so these prove: the report is the output, an unreadable checklist still gets validated, and a tick keeps the
// rest of the checklist intact.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EpicChecklistTab from './EpicChecklistTab.tsx';
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import { DEFAULT_DOR_CRITERIA } from './dorCriteria.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(), jiraPut: vi.fn() }));
vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', async () => {
  const actualModule = await vi.importActual<typeof import('../../Hygiene/checks/hygieneFieldConfig.ts')>(
    '../../Hygiene/checks/hygieneFieldConfig.ts',
  );
  return { ...actualModule, loadHygieneFieldConfig: vi.fn().mockResolvedValue({ acceptanceCriteriaFieldIds: ['customfield_ac'] }) };
});

import { jiraGet } from '../../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';

const CHECKLIST_FIELD_ID = 'customfield_22222';

/** The Epic's own checklist, in the team's real shape. */
const EPIC_CHECKLIST_TEXT = [
  '# Definition of Ready (DoR)',
  '## Business Readiness',
  '- [ ] Business objective, success criteria, and stakeholder alignment are established',
  '## Requirements Readiness',
  '- [ ] Scope and acceptance criteria are understood',
].join('\n');

/** Answers every Jira read the tab makes. `checklistText: ''` is the linked-template case. */
function installJira(options: { checklistText?: string } = {}): void {
  const { checklistText = EPIC_CHECKLIST_TEXT } = options;

  vi.mocked(jiraGet).mockImplementation((path: string) => {
    if (path === '/rest/api/2/field') {
      return Promise.resolve([{ id: CHECKLIST_FIELD_ID, name: 'Smart Checklist' }]) as never;
    }
    if (path.includes('/properties')) {
      return Promise.resolve({ keys: [] }) as never;
    }
    if (path.includes('/rest/api/2/search')) {
      return Promise.resolve({ issues: [{ key: 'DENP-1437', fields: { summary: 'Build intake', status: { name: 'Done' } } }] }) as never;
    }
    return Promise.resolve({
      key: 'DENP-1436',
      fields: {
        summary: '[GIPM] - Preprocessor MBI History Enhancement',
        status: { name: 'In Progress' },
        description: 'Stakeholders signed off the objective on 12 August.',
        customfield_ac: 'Given a member enrols…',
        [CHECKLIST_FIELD_ID]: checklistText,
      },
    }) as never;
  });
}

async function loadEpic(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Epic key'), 'denp-1436');
  await user.click(screen.getByRole('button', { name: 'Load Epic' }));
  await waitFor(() => expect(screen.getByText(/DENP-1436 — \[GIPM\]/)).toBeInTheDocument());
}

/** Pastes a reply through the panel, as the PO does. */
async function pasteReply(user: ReturnType<typeof userEvent.setup>, replyText: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
  await user.click(screen.getByLabelText(/Paste the assistant/i));
  await user.paste(replyText);
  await user.click(screen.getByRole('button', { name: 'Read the reply' }));
}

/** A reply against the Epic's own checklist ids: the first satisfied, the second only partly. */
function buildChecklistReply(): string {
  return JSON.stringify({
    kind: 'epicReadinessReview',
    items: [
      { criterionId: 'line-2', status: 'satisfied', evidence: 'Stakeholders signed off the objective on 12 August.', whatIsMissing: '' },
      { criterionId: 'line-4', status: 'partial', evidence: 'Acceptance criteria cover enrolment only.', whatIsMissing: 'Acceptance criteria for the rejection path.' },
    ],
  });
}

describe('EpicChecklistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAiAssistUnlocked(true);
  });

  it('validates against the Epic’s own checklist when it can be read', async () => {
    installJira();
    render(<EpicChecklistTab />);

    await loadEpic(userEvent.setup());

    expect(screen.getByText('2 Definition of Ready criteria to check')).toBeInTheDocument();
    expect(screen.getByText(/Using this Epic’s own checklist/)).toBeInTheDocument();
  });

  it('still validates when the checklist cannot be read, and says which criteria it used', async () => {
    // The reported defect: Jira shows 0/11 from a linked template, but the issue's own fields hold no text.
    installJira({ checklistText: '' });
    render(<EpicChecklistTab />);

    await loadEpic(userEvent.setup());

    // Definition of Ready only, by default: the two definitions are never checked at the same time.
    expect(screen.getByText(`${DEFAULT_DOR_CRITERIA.length} Definition of Ready criteria to check`)).toBeInTheDocument();
    expect(screen.getByText(/standard Definition of Ready and Done/)).toBeInTheDocument();
    expect(screen.getByText(/comes from a linked template/)).toBeInTheDocument();
  });

  it('reports a verdict per definition, with the evidence and what is still needed', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);

    await pasteReply(user, buildChecklistReply());

    await waitFor(() => expect(screen.getByText(/NOT MET — 1 of 2 satisfied/)).toBeInTheDocument());
    expect(screen.getByText(/Evidence: Stakeholders signed off/)).toBeInTheDocument();
    expect(screen.getByText(/Still needed: Acceptance criteria for the rejection path./)).toBeInTheDocument();
    expect(screen.getByText('Partly satisfied')).toBeInTheDocument();
  });

  it('writes nothing to Jira from reading a reply', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);

    await pasteReply(user, buildChecklistReply());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy for Jira' })).toBeInTheDocument());
    expect(saveFeatureReviewSimpleField).not.toHaveBeenCalled();
  });

  it('ticks only the satisfied criterion, keeping every other line of the checklist', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);
    await pasteReply(user, buildChecklistReply());

    await waitFor(() => expect(screen.getByRole('button', { name: /Tick 1 item/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Tick 1 item/ }));

    await waitFor(() => expect(saveFeatureReviewSimpleField).toHaveBeenCalledTimes(1));
    const [issueKey, fieldId, savedText] = vi.mocked(saveFeatureReviewSimpleField).mock.calls[0];

    expect(issueKey).toBe('DENP-1436');
    expect(fieldId).toBe(CHECKLIST_FIELD_ID);
    expect(savedText).toBe(EPIC_CHECKLIST_TEXT.replace(
      '- [ ] Business objective',
      '- [x] Business objective',
    ));
  });

  it('offers no ticking at all when the checklist could not be read', async () => {
    installJira({ checklistText: '' });
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);

    await pasteReply(user, JSON.stringify({
      kind: 'epicReadinessReview',
      items: [{ criterionId: DEFAULT_DOR_CRITERIA[0].id, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' }],
    }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy for Jira' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Tick/ })).not.toBeInTheDocument();
  });

  // ── Toolbox writes the review onto the Epic, because pasting it never rendered (GH #387) ──

  it('appends the review to the end of the Epic’s own description, as HTML', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);
    await pasteReply(user, buildChecklistReply());

    await waitFor(() => expect(screen.getByRole('button', { name: /Add review to DENP-1436 description/ })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add review to DENP-1436 description/ }));

    await waitFor(() => expect(saveFeatureReviewSimpleField).toHaveBeenCalled());
    const [issueKey, fieldId, writtenDescription] = vi.mocked(saveFeatureReviewSimpleField).mock.calls
      .find((call) => call[1] === 'description')!;

    expect(issueKey).toBe('DENP-1436');
    expect(fieldId).toBe('description');
    // What the Epic already said survives, and the review is real HTML rather than markup characters.
    expect(writtenDescription).toContain('Stakeholders signed off the objective on 12 August.');
    expect(writtenDescription).toContain('<h1>Readiness review');
    expect(writtenDescription).toContain('<ul><li>');
    expect(writtenDescription).not.toContain('## ');
  });

  it('says so on screen once the review is on the Epic', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);
    await pasteReply(user, buildChecklistReply());

    await waitFor(() => expect(screen.getByRole('button', { name: /Add review to DENP-1436 description/ })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add review to DENP-1436 description/ }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/now at the end of DENP-1436/);
    });
  });
});
