// EvidenceStep.test.tsx — Proves evidence files are listed and remembered by name, refused when too big, and asked for again after a reload.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import EvidenceStep from './EvidenceStep.tsx';

const CRG = {} as CrgHook;
const MEGABYTE = 1024 * 1024;

function buildFile(fileName: string, sizeBytes: number): File {
  const file = new File(['x'], fileName);
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('EvidenceStep', () => {
  it('adds chosen files and remembers their names', () => {
    const onEvidenceFilesChange = vi.fn();
    const updateSession = vi.fn();
    render(<EvidenceStep crg={CRG} session={createChangeWizardSession('create')} updateSession={updateSession} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={onEvidenceFilesChange} />);
    fireEvent.change(screen.getByLabelText('Choose evidence files'), { target: { files: [buildFile('results.pdf', 2048)] } });
    expect(onEvidenceFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'results.pdf' })]);
    expect(updateSession).toHaveBeenCalledWith({ evidenceFileNames: ['results.pdf'] });
  });

  it('refuses a set too big for ServiceNow before anything is uploaded', () => {
    const onEvidenceFilesChange = vi.fn();
    render(<EvidenceStep crg={CRG} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={onEvidenceFilesChange} />);
    fireEvent.change(screen.getByLabelText('Choose evidence files'), { target: { files: [buildFile('video.mp4', 90 * MEGABYTE)] } });
    expect(onEvidenceFilesChange).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 75\.0 MB/)).toBeTruthy();
  });

  it('asks for the files again when the window was reloaded', () => {
    const session = { ...createChangeWizardSession('create'), evidenceFileNames: ['results.pdf'] };
    render(<EvidenceStep crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} evidenceFiles={[]} onEvidenceFilesChange={vi.fn()} />);
    expect(screen.getByText(/Choose the files again \(results\.pdf\)/)).toBeTruthy();
  });
});
