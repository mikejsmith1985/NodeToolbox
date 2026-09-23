// EpicChecklistTab.test.tsx — The tab writes to a real Epic's checklist, so these prove the two things that
// matter: nothing reaches Jira until the PO clicks, and what reaches it keeps every line it did not tick.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EpicChecklistTab from './EpicChecklistTab.tsx';
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  jiraPut: vi.fn(),
}));

vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', async () => {
  const actualModule = await vi.importActual<typeof import('../../Hygiene/checks/hygieneFieldConfig.ts')>(
    '../../Hygiene/checks/hygieneFieldConfig.ts',
  );
  return {
    ...actualModule,
    loadHygieneFieldConfig: vi.fn().mockResolvedValue({ acceptanceCriteriaFieldIds: ['customfield_ac'] }),
  };
});

import { jiraGet } from '../../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';

const CHECKLIST_FIELD_ID = 'customfield_22222';

const EPIC_CHECKLIST_TEXT = [
  '# Definition of Ready (DoR)',
  '## Business Readiness',
  '- [ ] Business objective, success criteria, and stakeholder alignment are established',
  '## Requirements Readiness',
  '- [ ] Scope and acceptance criteria are understood',
].join('\n');

/** Answers each Jira read the tab makes, in whatever order it makes them. */
function installJira(options: { hasChecklistField?: boolean; checklistText?: string } = {}): void {
  const { hasChecklistField = true, checklistText = EPIC_CHECKLIST_TEXT } = options;

  vi.mocked(jiraGet).mockImplementation((path: string) => {
    if (path === '/rest/api/2/field') {
      return Promise.resolve(hasChecklistField
        ? [{ id: CHECKLIST_FIELD_ID, name: 'Smart Checklist' }, { id: 'summary', name: 'Summary' }]
        : [{ id: 'summary', name: 'Summary' }]) as never;
    }
    if (path.includes('/rest/api/2/search')) {
      return Promise.resolve({ issues: [{ key: 'DENP-906', fields: { summary: 'Build intake', status: { name: 'Done' } } }] }) as never;
    }
    return Promise.resolve({
      key: 'DENP-905',
      fields: {
        summary: 'AEP enrollment intake',
        status: { name: 'In Progress' },
        description: 'Stakeholders signed off the objective on 12 August.',
        customfield_ac: 'Given a member enrols…',
        [CHECKLIST_FIELD_ID]: checklistText,
      },
    }) as never;
  });
}

/** Loads DENP-905 into the tab. */
async function loadEpic(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Epic key'), 'denp-905');
  await user.click(screen.getByRole('button', { name: 'Load Epic' }));
  await waitFor(() => expect(screen.getByText(/DENP-905 — AEP enrollment intake/)).toBeInTheDocument());
}

/** The reply an assistant would paste back, satisfying the first item only. */
function buildReply(): string {
  return JSON.stringify({
    kind: 'epicChecklistReview',
    items: [
      { itemId: 'line-2', isSatisfied: true, evidence: 'Stakeholders signed off the objective on 12 August.' },
      { itemId: 'line-4', isSatisfied: false, evidence: 'The Epic does not state the scope.' },
    ],
  });
}

describe('EpicChecklistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAiAssistUnlocked(true);
  });

  it('shows the Epic, which field the checklist came from, and how far along it is', async () => {
    installJira();
    render(<EpicChecklistTab />);

    await loadEpic(userEvent.setup());

    expect(screen.getByText('0 of 2 checklist items done')).toBeInTheDocument();
    expect(screen.getByText(/Smart Checklist/)).toBeInTheDocument();
    expect(screen.getByText(/Open items \(2\)/)).toBeInTheDocument();
  });

  it('says plainly when the instance has no checklist field, rather than showing an empty checklist', async () => {
    installJira({ hasChecklistField: false });
    const user = userEvent.setup();
    render(<EpicChecklistTab />);

    await user.type(screen.getByLabelText('Epic key'), 'DENP-905');
    await user.click(screen.getByRole('button', { name: 'Load Epic' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no checklist field/i));
  });

  it('proposes only the items the review found evidence for, and writes nothing yet', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    // The review is on screen and one tick is queued, but Jira has not been touched.
    await waitFor(() => expect(screen.getByRole('button', { name: /Tick 1 item/ })).toBeEnabled());
    expect(saveFeatureReviewSimpleField).not.toHaveBeenCalled();
  });

  it('ticks only the selected item and keeps every other line of the checklist', async () => {
    installJira();
    const user = userEvent.setup();
    render(<EpicChecklistTab />);
    await loadEpic(user);

    // Paste the reviewed answer through the panel's own textbox, as the PO does.
    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tick 1 item\(s\) on DENP-905/ })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /Tick 1 item\(s\) on DENP-905/ }));

    await waitFor(() => expect(saveFeatureReviewSimpleField).toHaveBeenCalledTimes(1));
    const [issueKey, fieldId, savedText] = vi.mocked(saveFeatureReviewSimpleField).mock.calls[0];

    expect(issueKey).toBe('DENP-905');
    expect(fieldId).toBe(CHECKLIST_FIELD_ID);
    expect(savedText).toBe([
      '# Definition of Ready (DoR)',
      '## Business Readiness',
      '- [x] Business objective, success criteria, and stakeholder alignment are established',
      '## Requirements Readiness',
      '- [ ] Scope and acceptance criteria are understood',
    ].join('\n'));
  });

  it('says so when the Epic carries no checklist items at all', async () => {
    installJira({ checklistText: '' });
    render(<EpicChecklistTab />);

    await loadEpic(userEvent.setup());

    expect(screen.getByText(/has no checklist items yet/i)).toBeInTheDocument();
  });
});
