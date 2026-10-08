// AddJiraIssueControl.test.tsx — Adding one Jira issue to an existing change from Modify.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchChangeJiraStories } from '../chgFormula/changeJiraStories.ts';
import { AddJiraIssueControl } from './AddJiraIssueControl.tsx';

vi.mock('../chgFormula/changeJiraStories.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/changeJiraStories.ts')>()),
  fetchChangeJiraStories: vi.fn(),
}));

const CHANGE_TEXT = {
  description: 'The following Jira issues are included in this release:\n\n- [ENCUC-1] Fix recon totals',
  justification: 'Planned release of 26.10 containing 1 issue(s).',
  riskImpactAnalysis: 'Standard deployment risk. 1 issue(s) included.',
};

/** Types a key and clicks Add; returns the callback that receives the new text. */
function addKey(typedKey: string) {
  const onApplyFields = vi.fn();
  render(<AddJiraIssueControl changeText={CHANGE_TEXT} onApplyFields={onApplyFields} />);
  fireEvent.change(screen.getByLabelText('Jira issue to add'), { target: { value: typedKey } });
  fireEvent.click(screen.getByRole('button', { name: 'Add issue to change' }));
  return onApplyFields;
}

describe('AddJiraIssueControl', () => {
  beforeEach(() => {
    vi.mocked(fetchChangeJiraStories).mockReset();
  });

  it('reads the issue from Jira and hands back the change text with it listed and counted', async () => {
    vi.mocked(fetchChangeJiraStories).mockResolvedValue([
      { key: 'ENCUC-77', fields: { summary: 'Correct member counts' } },
    ] as Awaited<ReturnType<typeof fetchChangeJiraStories>>);

    const onApplyFields = addKey('ENCUC-77');

    await waitFor(() => expect(onApplyFields).toHaveBeenCalledWith({
      description: `${CHANGE_TEXT.description}\n- [ENCUC-77] Correct member counts`,
      justification: 'Planned release of 26.10 containing 2 issue(s).',
      riskImpactAnalysis: 'Standard deployment risk. 2 issue(s) included.',
    }));
    expect(screen.getByText(/Added ENCUC-77 — save the change to write it to ServiceNow/)).toBeInTheDocument();
  });

  it('refuses text that is not a Jira key, without asking Jira', () => {
    const onApplyFields = addKey('recon fix');

    expect(screen.getByText(/is not a Jira key/)).toBeInTheDocument();
    expect(fetchChangeJiraStories).not.toHaveBeenCalled();
    expect(onApplyFields).not.toHaveBeenCalled();
  });

  it('says the change already lists an issue it names, and changes nothing', async () => {
    vi.mocked(fetchChangeJiraStories).mockResolvedValue([
      { key: 'ENCUC-1', fields: { summary: 'Fix recon totals' } },
    ] as Awaited<ReturnType<typeof fetchChangeJiraStories>>);

    const onApplyFields = addKey('ENCUC-1');

    expect(await screen.findByText(/already lists ENCUC-1/)).toBeInTheDocument();
    expect(onApplyFields).not.toHaveBeenCalled();
  });
});
