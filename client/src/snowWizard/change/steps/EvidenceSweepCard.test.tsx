// EvidenceSweepCard.test.tsx — Proves the one-button sweep reports what it swept, found, zipped and attached, says plainly
// when nothing was found, and cannot be pressed for a change with no Jira issues.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runEvidenceSweep, type EvidenceSweepReport } from '../evidenceSweep.ts';
import EvidenceSweepCard from './EvidenceSweepCard.tsx';

vi.mock('../evidenceSweep.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../evidenceSweep.ts')>()),
  runEvidenceSweep: vi.fn(),
}));

function buildReport(overrides: Partial<EvidenceSweepReport> = {}): EvidenceSweepReport {
  const file = (issueKey: string, filename: string) => ({ issueKey, issueSummary: '', attachment: { attachmentId: filename, filename, sizeBytes: 1, contentUrl: '' } });
  return {
    startingIssueKeys: ['ABC-1'], sweptIssueKeys: ['ABC-1', 'ABC-5'], foundFiles: [file('ABC-5', 'run.xlsx'), file('ABC-5', 'shot.png')],
    leftOutForSize: [], wereLinksSkipped: false, zippedFileCount: 2, archiveByteSize: 2048, results: { CHG1: 'attached' },
    attachedFileNames: { CHG1: 'Test-Evidence_CHG1_2026-10-22.zip' }, problems: [], ...overrides,
  };
}

async function pressSweep() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sweep Jira and attach the test evidence' })); });
}

describe('EvidenceSweepCard', () => {
  beforeEach(() => vi.mocked(runEvidenceSweep).mockReset());

  it('says how many issues were swept, files found and zipped, and that ServiceNow confirmed the zip', async () => {
    vi.mocked(runEvidenceSweep).mockResolvedValue(buildReport());
    const onSwept = vi.fn();
    render(<EvidenceSweepCard changeNumbers={['CHG1']} issueKeys={['ABC-1']} onSwept={onSwept} />);
    await pressSweep();
    const summary = screen.getByRole('status', { name: 'Evidence sweep result' }).textContent ?? '';
    expect(summary).toContain('Swept 2 Jira issues: ABC-1, ABC-5');
    expect(summary).toContain('Found 2 files on 1 issue.');
    expect(summary).toContain('ABC-5: run.xlsx, shot.png');
    expect(summary).toContain('Zipped 2 files (2.0 KB).');
    expect(summary).toContain('✅ Attached Test-Evidence_CHG1_2026-10-22.zip to CHG1 — ServiceNow confirmed it.');
    expect(onSwept).toHaveBeenCalledWith(expect.objectContaining({ results: { CHG1: 'attached' } }));
  });

  it('says plainly when the issues hold no files, and when an attach failed', async () => {
    vi.mocked(runEvidenceSweep).mockResolvedValue(buildReport({ foundFiles: [], zippedFileCount: 0, results: {}, attachedFileNames: {} }));
    render(<EvidenceSweepCard changeNumbers={['CHG1']} issueKeys={['ABC-1']} />);
    await pressSweep();
    expect(screen.getByText(/No test evidence files are on any of these issues yet/)).toBeTruthy();
  });

  it('cannot sweep a change with no Jira issues, and says where to choose them', () => {
    render(<EvidenceSweepCard changeNumbers={['CHG1']} issueKeys={[]} />);
    expect(screen.getByRole('button', { name: 'Sweep Jira and attach the test evidence' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/This change names no Jira issues/)).toBeTruthy();
  });
});
