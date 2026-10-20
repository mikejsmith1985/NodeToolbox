// JiraEvidencePicker.test.tsx — Proves the files on the change's Jira issues are listed with ticks (all that fit, pre-ticked), unticks are remembered, an over-size tick is refused plainly, and a failed look-up can be retried.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listJiraEvidence, type JiraEvidenceAttachment } from '../jiraEvidence.ts';
import { useJiraEvidenceChoiceStore } from '../jiraEvidenceChoiceStore.ts';
import JiraEvidencePicker from './JiraEvidencePicker.tsx';

vi.mock('../jiraEvidence.ts', async (importOriginal) => ({ ...await importOriginal<object>(), listJiraEvidence: vi.fn() }));

const MEGABYTE = 1024 * 1024;
const JOB_ID = 'job-1';

function buildEvidence(issueKey: string, attachmentId: string, filename: string, sizeBytes = 2048): JiraEvidenceAttachment {
  return { issueKey, issueSummary: '', attachment: { attachmentId, filename, sizeBytes, contentUrl: '' } };
}

const REPORT = buildEvidence('ENCUC-9', '1', 'report.pdf');
const SCREENSHOT = buildEvidence('ENCUC-10', '2', 'screen.png');

function readChoice() {
  return useJiraEvidenceChoiceStore.getState().choices[JOB_ID];
}

beforeEach(() => {
  useJiraEvidenceChoiceStore.setState({ choices: {} });
  vi.mocked(listJiraEvidence).mockReset();
});

describe('JiraEvidencePicker', () => {
  it('lists each file with its issue, size and type, all ticked, and remembers the ticks', async () => {
    vi.mocked(listJiraEvidence).mockResolvedValue({ attachments: [REPORT, SCREENSHOT], issuesWithoutFiles: ['ENCUC-11'], missingKeys: [] });
    render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={['ENCUC-9', 'ENCUC-10', 'ENCUC-11']} localBytes={0} />);

    const reportBox = await screen.findByRole('checkbox', { name: /ENCUC-9: report\.pdf/ });
    expect((reportBox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('2.0 KB · PDF')).toBeTruthy();
    expect(screen.getByText(/No files on: ENCUC-11/)).toBeTruthy();
    expect(listJiraEvidence).toHaveBeenCalledWith(['ENCUC-9', 'ENCUC-10', 'ENCUC-11']);
    expect(readChoice().tickedAttachments).toEqual([REPORT, SCREENSHOT]);
  });

  it('remembers an untick, and keeps it unticked when the step is opened again', async () => {
    vi.mocked(listJiraEvidence).mockResolvedValue({ attachments: [REPORT, SCREENSHOT], issuesWithoutFiles: [], missingKeys: [] });
    const { unmount } = render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={['ENCUC-9', 'ENCUC-10']} localBytes={0} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /screen\.png/ }));
    expect(readChoice()).toEqual({ tickedAttachments: [REPORT], untickedAttachmentIds: ['2'] });
    unmount();

    render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={['ENCUC-9', 'ENCUC-10']} localBytes={0} />);

    expect(((await screen.findByRole('checkbox', { name: /screen\.png/ })) as HTMLInputElement).checked).toBe(false);
    expect(readChoice().tickedAttachments).toEqual([REPORT]);
  });

  it('refuses a tick that would make the set too big for ServiceNow, saying so plainly', async () => {
    const video = buildEvidence('ENCUC-9', '3', 'video.mp4', 70 * MEGABYTE);
    vi.mocked(listJiraEvidence).mockResolvedValue({ attachments: [video], issuesWithoutFiles: [], missingKeys: [] });
    render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={['ENCUC-9']} localBytes={10 * MEGABYTE} />);

    const videoBox = await screen.findByRole('checkbox', { name: /video\.mp4/ });
    expect((videoBox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/left unticked.*video\.mp4/)).toBeTruthy();

    fireEvent.click(videoBox);

    expect((videoBox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/at most 75\.0 MB/)).toBeTruthy();
  });

  it('says plainly when Jira could not be read, and can look again', async () => {
    vi.mocked(listJiraEvidence)
      .mockRejectedValueOnce(new Error('Jira is not connected'))
      .mockResolvedValueOnce({ attachments: [REPORT], issuesWithoutFiles: [], missingKeys: ['ENCUC-99'] });
    render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={['ENCUC-9', 'ENCUC-99']} localBytes={0} />);

    expect(await screen.findByText(/Could not look at Jira: Jira is not connected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /report\.pdf/ })).toBeTruthy());
    expect(screen.getByText(/Jira could not find: ENCUC-99/)).toBeTruthy();
  });

  it('asks for Jira issues first when the change has none', () => {
    render(<JiraEvidencePicker jobId={JOB_ID} issueKeys={[]} localBytes={0} />);
    expect(screen.getByText(/Pick Jira issues on the first step/)).toBeTruthy();
    expect(listJiraEvidence).not.toHaveBeenCalled();
  });
});
