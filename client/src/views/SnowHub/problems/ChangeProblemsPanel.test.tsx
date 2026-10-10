// ChangeProblemsPanel.test.tsx — Scanning a change's Jira issues for PRBs and linking them to the change (Modify).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linkProblemToChange, scanIssuesForProblems } from './changeProblems.ts';
import { ChangeProblemsPanel } from './ChangeProblemsPanel.tsx';

vi.mock('./changeProblems.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./changeProblems.ts')>()),
  scanIssuesForProblems: vi.fn(),
  linkProblemToChange: vi.fn(),
}));

const UNLINKED_ROW = {
  prbNumber: 'PRB0000001', issueKeys: ['ENCUC-1'],
  problem: { sysId: 'sys-1', number: 'PRB0000001', shortDescription: 'File rejected', stateLabel: 'Fix in Progress', linkedChange: { sysId: '', displayName: '' } },
};
const ELSEWHERE_ROW = {
  prbNumber: 'PRB0000002', issueKeys: ['ENCUC-2'],
  problem: { sysId: 'sys-2', number: 'PRB0000002', shortDescription: 'Mapping', stateLabel: 'Assess', linkedChange: { sysId: 'chg-9', displayName: 'CHG0009999' } },
};

describe('ChangeProblemsPanel', () => {
  beforeEach(() => {
    vi.mocked(scanIssuesForProblems).mockReset();
    vi.mocked(linkProblemToChange).mockReset();
    vi.mocked(linkProblemToChange).mockResolvedValue(undefined);
  });

  it('scans only when asked, then lists each PRB with the issues that mention it and where it is linked', async () => {
    vi.mocked(scanIssuesForProblems).mockResolvedValue([UNLINKED_ROW, ELSEWHERE_ROW]);
    render(<ChangeProblemsPanel changeNumber="CHG0001234" changeSysId="chg-1" issueKeys={['ENCUC-1', 'ENCUC-2']} />);

    expect(scanIssuesForProblems).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Scan Jira issues for PRBs' }));

    expect(await screen.findByText(/PRB0000001 · File rejected · Fix in Progress — mentioned in ENCUC-1 — not linked/)).toBeInTheDocument();
    expect(screen.getByText(/PRB0000002 · Mapping · Assess — mentioned in ENCUC-2 — linked to CHG0009999/)).toBeInTheDocument();
    expect(scanIssuesForProblems).toHaveBeenCalledWith(['ENCUC-1', 'ENCUC-2']);
  });

  it('links the unlinked PRBs to this change, and leaves one linked to another change alone', async () => {
    vi.mocked(scanIssuesForProblems).mockResolvedValue([UNLINKED_ROW, ELSEWHERE_ROW]);
    render(<ChangeProblemsPanel changeNumber="CHG0001234" changeSysId="chg-1" issueKeys={['ENCUC-1', 'ENCUC-2']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan Jira issues for PRBs' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Link 1 PRB to CHG0001234' }));

    await waitFor(() => expect(linkProblemToChange).toHaveBeenCalledWith('sys-1', 'chg-1'));
    expect(linkProblemToChange).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Linked PRB0000001 to CHG0001234/)).toBeInTheDocument();
  });

  it('says so when the change\'s Jira issues mention no PRB', async () => {
    vi.mocked(scanIssuesForProblems).mockResolvedValue([]);
    render(<ChangeProblemsPanel changeNumber="CHG0001234" changeSysId="chg-1" issueKeys={['ENCUC-1']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan Jira issues for PRBs' }));

    expect(await screen.findByText(/No PRB number found in ENCUC-1/)).toBeInTheDocument();
  });

  it('asks for Jira issues first when the change names none', () => {
    render(<ChangeProblemsPanel changeNumber="CHG0001234" changeSysId="chg-1" issueKeys={[]} />);

    expect(screen.getByText(/names no Jira issues/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan Jira issues for PRBs' })).not.toBeInTheDocument();
  });
});
