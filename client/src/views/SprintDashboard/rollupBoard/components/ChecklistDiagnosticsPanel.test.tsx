// ChecklistDiagnosticsPanel.test.tsx — Proves the panel answers the question it exists for: which
// field this Jira uses, what it actually stores, and what the board's parser made of it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { ChecklistDiagnosticsPanel } from './ChecklistDiagnosticsPanel.tsx';

const CHECKLIST_FIELD = {
  id: 'customfield_10240', name: 'Smart Checklist', schema: { custom: 'com.okapya.jira.checklist:checklist' },
};

/** Answers the field catalogue and then one issue, in the order the panel asks. */
function mockJiraResponses(fields: unknown[], issueFields: Record<string, unknown>) {
  mockJiraGet.mockImplementation((requestPath: string) => (
    requestPath.includes('/field')
      ? Promise.resolve(fields)
      : Promise.resolve({ fields: issueFields })
  ));
}

async function probeFor(issueKey: string) {
  render(<ChecklistDiagnosticsPanel />);
  fireEvent.change(screen.getByLabelText('Issue key to sample'), { target: { value: issueKey } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
}

beforeEach(() => {
  mockJiraGet.mockReset();
});

describe('ChecklistDiagnosticsPanel', () => {
  it('names the field the board would use, and shows the value it holds', async () => {
    mockJiraResponses([CHECKLIST_FIELD], { customfield_10240: '- [ ] this is a test @C8Q6T3' });

    await probeFor('ENCUC-2311');

    await waitFor(() => expect(screen.getByTestId('rollup-checklist-diagnostics').textContent)
      .toContain('customfield_10240'));
    expect(screen.getByTestId('rollup-checklist-diagnostics').textContent).toContain('this is a test');
  });

  it('reports how many items the board\'s own parser read, which is where a mismatch shows', async () => {
    mockJiraResponses([CHECKLIST_FIELD], { customfield_10240: '- [ ] one\n- [x] two' });

    await probeFor('ENCUC-2311');

    // The count sits in its own element, so the sentence is asserted against the panel as a whole.
    await waitFor(() => expect(screen.getByTestId('rollup-checklist-diagnostics').textContent)
      .toMatch(/parser read\s*2\s*item/));
  });

  it('says plainly when a stored value parses to nothing, and asks for it', async () => {
    // The suspected production case: the app stores structured objects, and the parser expects text.
    mockJiraResponses([CHECKLIST_FIELD], { customfield_10240: [{ name: 'this is a test', checked: false }] });

    await probeFor('ENCUC-2311');

    expect(await screen.findByText(/not the one the parser expects/)).toBeTruthy();
  });

  it('shows a raw value in a form that makes its TYPE unmistakable', async () => {
    // A string and an array of objects must not look alike here, or the panel answers nothing.
    mockJiraResponses([CHECKLIST_FIELD], { customfield_10240: [{ name: 'item' }] });

    await probeFor('ENCUC-2311');

    expect(await screen.findByText(/"name": "item"/)).toBeTruthy();
  });

  it('says the field is absent on this issue rather than showing an empty box', async () => {
    mockJiraResponses([CHECKLIST_FIELD], {});

    await probeFor('ENCUC-2311');

    expect(await screen.findByText(/field not present on this issue/)).toBeTruthy();
  });

  it('says when the instance has no checklist field at all, which is the whole explanation', async () => {
    mockJiraResponses([{ id: 'customfield_1', name: 'Story Points' }], {});

    await probeFor('ENCUC-2311');

    expect(await screen.findByText(/No field on this instance looks like a checklist/)).toBeTruthy();
  });

  it('reports a refused read instead of appearing to find nothing', async () => {
    mockJiraGet.mockRejectedValue(new Error('403 Forbidden'));

    await probeFor('ENCUC-2311');

    expect(await screen.findByText(/Jira refused the read/)).toBeTruthy();
  });

  it('asks Jira nothing until the button is pressed', () => {
    render(<ChecklistDiagnosticsPanel />);

    expect(mockJiraGet).not.toHaveBeenCalled();
  });
});
