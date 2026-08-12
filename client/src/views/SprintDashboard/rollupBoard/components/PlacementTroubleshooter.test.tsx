// PlacementTroubleshooter.test.tsx — Proves the answer arrives in one step rather than a round trip.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jiraGetMock = vi.fn();
vi.mock('../../../../services/jiraApi.ts', () => ({ jiraGet: (...args: unknown[]) => jiraGetMock(...args) }));

import { PlacementTroubleshooter } from './PlacementTroubleshooter.tsx';

const PI_FIELD = 'customfield_10301';
const FEATURE_LINK_FIELD = 'customfield_10108';

/** Renders the tool with a board scoped to PI 26.4, carrying over 26.3, tracking DENP. */
function renderTool() {
  render(
    <PlacementTroubleshooter
      carryOverPiValue="PI 26.3"
      featureLinkFieldId={FEATURE_LINK_FIELD}
      featureProjectKeys={['DENP']}
      piFieldId={PI_FIELD}
      selectedPiValue="PI 26.4"
    />,
  );
}

/** Asks about one issue and waits for the verdict. */
async function check(issueKey: string) {
  fireEvent.change(screen.getByLabelText('Issue key to check'), { target: { value: issueKey } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await waitFor(() => expect(screen.getByText(/reaches the board|never reaches|should be on/)).toBeTruthy());
}

beforeEach(() => vi.clearAllMocks());

describe('PlacementTroubleshooter', () => {
  it('explains a Feature in a project the team does not track — the DASP-925 case', async () => {
    jiraGetMock.mockImplementation(async (path: string) => {
      if (path.includes('ENCUC-9')) {
        return { fields: { [PI_FIELD]: 'PI 26.3', [FEATURE_LINK_FIELD]: 'DASP-925' } };
      }
      return { fields: { [PI_FIELD]: 'PI 26.3', status: { statusCategory: { key: 'new' } } } };
    });

    renderTool();
    await check('ENCUC-9');

    // Named in the carry-over step, alongside the projects the team DOES track, so the fix is obvious.
    expect(screen.getAllByText(/DASP-925 is in project DASP/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DENP/).length).toBeGreaterThan(0);
  });

  it('reads the FEATURE as well as the issue, since the sweep judges the Feature', async () => {
    jiraGetMock.mockResolvedValue({ fields: { [PI_FIELD]: 'PI 26.4', [FEATURE_LINK_FIELD]: 'DENP-1' } });

    renderTool();
    await check('ENCUC-1');

    const requestedPaths = jiraGetMock.mock.calls.map((call) => String(call[0]));
    expect(requestedPaths.some((path) => path.includes('ENCUC-1'))).toBe(true);
    expect(requestedPaths.some((path) => path.includes('DENP-1'))).toBe(true);
  });

  it('says plainly when the issue cannot be read at all', async () => {
    jiraGetMock.mockRejectedValue(new Error('404'));

    renderTool();
    fireEvent.change(screen.getByLabelText('Issue key to check'), { target: { value: 'NOPE-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(screen.getByText(/could not be read from Jira/)).toBeTruthy());
  });

  it('will not check an empty key', () => {
    renderTool();
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows every step, not only the failing one, since more than one can be wrong', async () => {
    jiraGetMock.mockResolvedValue({ fields: { [PI_FIELD]: 'PI 26.4', [FEATURE_LINK_FIELD]: 'DENP-1' } });

    renderTool();
    await check('ENCUC-1');

    expect(screen.getByText(/Is it in the PI the dashboard is showing/)).toBeInTheDocument();
    expect(screen.getByText(/Would the carry-over sweep pull it in/)).toBeInTheDocument();
    expect(screen.getByText(/Does it roll up to a Feature/)).toBeInTheDocument();
    expect(screen.getByText(/Is its Feature one this team tracks/)).toBeInTheDocument();
  });
});

describe('answering "why IS this here?"', () => {
  it('explains a key that is already on the board, without asking Jira anything', async () => {
    render(
      <PlacementTroubleshooter
        carryOverPiValue=""
        explainLanePresence={() => ({
          summary: 'It is ASSIGNED to the Product Owner for this team.',
          howToRemove: 'Set a Jira label for team Features in Board setup.',
          isGuess: true,
        })}
        featureLinkFieldId="customfield_10108"
        featureProjectKeys={[]}
        piFieldId="customfield_10301"
        selectedPiValue="PI 26.4"
      />,
    );

    fireEvent.change(screen.getByLabelText('Issue key to check'), { target: { value: 'DENP-1398' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/DENP-1398 IS on this board/)).toBeTruthy();
    expect(screen.getByText(/Set a Jira label/)).toBeTruthy();
    // Walking the exclusion steps would be answering a question nobody asked.
    expect(jiraGetMock).not.toHaveBeenCalled();
  });

  it('falls through to the missing-issue diagnosis when the key is not on the board', async () => {
    jiraGetMock.mockResolvedValue({ fields: {} });

    render(
      <PlacementTroubleshooter
        carryOverPiValue=""
        explainLanePresence={() => null}
        featureLinkFieldId="customfield_10108"
        featureProjectKeys={[]}
        piFieldId="customfield_10301"
        selectedPiValue="PI 26.4"
      />,
    );

    fireEvent.change(screen.getByLabelText('Issue key to check'), { target: { value: 'DENP-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(jiraGetMock).toHaveBeenCalled());
  });
});
