// SubmissionDropzone.test.tsx — Covers file-pick, drag-and-drop, and the error message rendering.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SubmissionDropzone from './SubmissionDropzone.tsx';

const FILE = new File(['data'], 'Jira-Intake.xlsx');

describe('SubmissionDropzone', () => {
  it('fires onFile when a file is picked', () => {
    const onFile = vi.fn();
    render(<SubmissionDropzone onFile={onFile} errorMessage={null} />);

    const input = screen.getByTestId('submission-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [FILE] } });

    expect(onFile).toHaveBeenCalledWith(FILE);
  });

  it('fires onFile when a file is dropped', () => {
    const onFile = vi.fn();
    render(<SubmissionDropzone onFile={onFile} errorMessage={null} />);

    fireEvent.drop(screen.getByRole('button', { name: /drop the exported submissions file/i }), {
      dataTransfer: { files: [FILE] },
    });

    expect(onFile).toHaveBeenCalledWith(FILE);
  });

  it('shows the error message when one is provided', () => {
    render(<SubmissionDropzone onFile={vi.fn()} errorMessage="This file could not be read." />);
    expect(screen.getByRole('alert')).toHaveTextContent('This file could not be read.');
  });
});
