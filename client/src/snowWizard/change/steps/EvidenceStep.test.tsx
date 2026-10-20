// EvidenceStep.test.tsx — Proves the Jira files are offered, chosen local files are listed and remembered by name, a set too big is refused, and lost local files are asked for again after a reload.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import { listJiraEvidence } from '../jiraEvidence.ts';
import { useJiraEvidenceChoiceStore } from '../jiraEvidenceChoiceStore.ts';
import EvidenceStep from './EvidenceStep.tsx';

vi.mock('../jiraEvidence.ts', async (importOriginal) => ({ ...await importOriginal<object>(), listJiraEvidence: vi.fn() }));

const MEGABYTE = 1024 * 1024;
const JOB_ID = 'job-1';

function buildCrg(issueKeys: string[] = []): CrgHook {
  return { state: { selectedIssueKeys: new Set(issueKeys) } } as unknown as CrgHook;
}

function buildFile(fileName: string, sizeBytes: number): File {
  const file = new File(['x'], fileName);
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

beforeEach(() => {
  useJiraEvidenceChoiceStore.setState({ choices: {} });
  vi.mocked(listJiraEvidence).mockReset();
  vi.mocked(listJiraEvidence).mockResolvedValue({ attachments: [], issuesWithoutFiles: [], missingKeys: [] });
});

describe('EvidenceStep', () => {
  it('adds chosen files and remembers their names', () => {
    const onEvidenceFilesChange = vi.fn();
    const updateSession = vi.fn();
    render(<EvidenceStep jobId={JOB_ID} crg={buildCrg()} session={createChangeWizardSession('create')} updateSession={updateSession} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={onEvidenceFilesChange} />);
    fireEvent.change(screen.getByLabelText('Choose evidence files'), { target: { files: [buildFile('results.pdf', 2048)] } });
    expect(onEvidenceFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'results.pdf' })]);
    expect(updateSession).toHaveBeenCalledWith({ evidenceFileNames: ['results.pdf'] });
  });

  it('refuses a set too big for ServiceNow before anything is uploaded', () => {
    const onEvidenceFilesChange = vi.fn();
    render(<EvidenceStep jobId={JOB_ID} crg={buildCrg()} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={onEvidenceFilesChange} />);
    fireEvent.change(screen.getByLabelText('Choose evidence files'), { target: { files: [buildFile('video.mp4', 90 * MEGABYTE)] } });
    expect(onEvidenceFilesChange).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 75\.0 MB/)).toBeTruthy();
  });

  it('counts the ticked Jira files when a local file is added', () => {
    useJiraEvidenceChoiceStore.getState().saveChoice(JOB_ID, {
      tickedAttachments: [{ issueKey: 'A-1', issueSummary: '', attachment: { attachmentId: '1', filename: 'big.mp4', sizeBytes: 70 * MEGABYTE, contentUrl: '' } }],
      untickedAttachmentIds: [],
    });
    const onEvidenceFilesChange = vi.fn();
    render(<EvidenceStep jobId={JOB_ID} crg={buildCrg(['A-1'])} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={onEvidenceFilesChange} />);
    fireEvent.change(screen.getByLabelText('Choose evidence files'), { target: { files: [buildFile('notes.pdf', 10 * MEGABYTE)] } });
    expect(onEvidenceFilesChange).not.toHaveBeenCalled();
    expect(screen.getByText(/80\.0 MB/)).toBeTruthy();
  });

  it('looks for files on the change’s Jira issues', async () => {
    render(<EvidenceStep jobId={JOB_ID} crg={buildCrg(['ENCUC-2', 'ENCUC-1'])} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={vi.fn()} />);
    expect(await screen.findByText(/no files attached/)).toBeTruthy();
    expect(listJiraEvidence).toHaveBeenCalledWith(['ENCUC-1', 'ENCUC-2']);
  });

  it('asks for the files again when the window was reloaded', () => {
    const session = { ...createChangeWizardSession('create'), evidenceFileNames: ['results.pdf'] };
    render(<EvidenceStep jobId={JOB_ID} crg={buildCrg()} session={session} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={vi.fn()} />);
    expect(screen.getByText(/Choose the files again \(results\.pdf\)/)).toBeTruthy();
  });
});
