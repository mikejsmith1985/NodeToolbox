// FieldMappingPanel.test.tsx — Proves the panel says which field was chosen, warns when it is a
// guess, and offers a list rather than asking for an id.

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { FieldMappingPanel } from './FieldMappingPanel.tsx';

/** This Jira's field list, as the panel reads it. */
function mockFields(...named: Array<[string, string]>): void {
  mockJiraGet.mockResolvedValue(named.map(([id, name]) => ({ id, name })));
}

describe('FieldMappingPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockJiraGet.mockReset();
  });

  it('reports a field found by NAME as settled, whatever id this instance gave it', async () => {
    mockFields(
      ['customfield_99999', 'Feature Link'],
      ['customfield_2', 'Story Points'],
      ['customfield_6', 'PI (Program Increment)'],
      ['customfield_7', 'Target start'],
      ['customfield_8', 'Target end'],
      ['customfield_3', 'Acceptance Criteria'],
      ['customfield_4', 'Epic Link'],
      ['customfield_5', 'ServiceNow Reference'],
      ['customfield_9', 'Status Summary'],
    );
    render(<FieldMappingPanel />);

    await waitFor(() => expect(screen.getByText(/resolve cleanly/)).toBeTruthy());
    expect((screen.getByLabelText('Feature Link field') as HTMLSelectElement).textContent)
      .toContain('customfield_99999');
  });

  it('WARNS when a built-in default is being read because nothing matched', async () => {
    // The migration-day failure: that id exists here and belongs to something else, so it reads
    // perfectly and the app never mentions it.
    mockFields(['customfield_10108', 'Some Other Team Field']);
    render(<FieldMappingPanel />);

    await waitFor(() => expect(screen.getByText(/need attention/)).toBeTruthy());
    expect(screen.getAllByText(/may belong to something else entirely/).length).toBeGreaterThan(0);
  });

  it('offers this Jira’s own fields to choose from, rather than asking for an id', async () => {
    // The whole point of a config screen a ten-year-old could use: pick from a list, never look up
    // a customfield number.
    mockFields(['customfield_1', 'Feature Link'], ['customfield_7', 'Delivers Feature']);
    render(<FieldMappingPanel />);

    await waitFor(() => screen.getByLabelText('Feature Link field'));

    expect(screen.getAllByRole('option', { name: /Delivers Feature — customfield_7/ }).length)
      .toBeGreaterThan(0);
  });

  it('saves a choice where the rest of the app already reads it from', async () => {
    // Written into tbxARTSettings, which is the store the Feature Link and story-point readers
    // already consult — so choosing here takes effect rather than only looking like it did.
    mockFields(['customfield_1', 'Feature Link'], ['customfield_7', 'Delivers Feature']);
    render(<FieldMappingPanel />);
    await waitFor(() => screen.getByLabelText('Feature Link field'));

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('Feature Link field'), { target: { value: 'customfield_7' } });

    expect(JSON.parse(window.localStorage.getItem('tbxARTSettings') ?? '{}').featureLinkField)
      .toBe('customfield_7');
  });

  it('says which piece of the app each field drives, in the reader’s terms', async () => {
    mockFields(['customfield_1', 'Feature Link']);
    render(<FieldMappingPanel />);

    await waitFor(() => expect(screen.getByText(/whole Roll-Up Board/)).toBeTruthy());
  });

  it('says so plainly when the field list cannot be read at all', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unreachable'));
    render(<FieldMappingPanel />);

    await waitFor(() => expect(screen.getByText(/Could not read this Jira/)).toBeTruthy());
  });
});
