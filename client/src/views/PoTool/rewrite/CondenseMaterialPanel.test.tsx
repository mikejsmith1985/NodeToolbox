// CondenseMaterialPanel.test.tsx — Walking a corpus that is far larger than any prompt.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CondenseMaterialPanel from './CondenseMaterialPanel.tsx';
import type { DocumentExtract } from './ai/documentExtract.ts';
import type { CorpusBrief } from './ai/corpusBrief.ts';
import type { ReferencedSource } from '../sources/sourceModel.ts';
import { useAiAssistStore } from '../../../store/aiAssistStore';

function pasteSource(id: string, label: string, text: string): ReferencedSource {
  return { kind: 'paste', id, label, text };
}

function extract(sourceId: string, sourceTitle: string, fields: Partial<DocumentExtract> = {}): DocumentExtract {
  return {
    sourceId,
    sourceTitle,
    sourceOrigin: 'Pasted',
    summary: 'A page of the notebook.',
    decisions: ['Consolidated statements'],
    requirements: [],
    openQuestions: [],
    facts: [],
    extractedAtIso: '2026-08-27T00:00:00.000Z',
    ...fields,
  };
}

/** The panel with sensible defaults, so each test states only what it is about. */
function renderPanel(overrides: Partial<React.ComponentProps<typeof CondenseMaterialPanel>> = {}) {
  const onExtractDocument = vi.fn();
  const onBuildBrief = vi.fn();
  render(
    <CondenseMaterialPanel
      sources={[pasteSource('paste-1', 'Billing Grid', 'the notebook page text')]}
      extracts={{}}
      brief={null}
      onExtractDocument={onExtractDocument}
      onBuildBrief={onBuildBrief}
      {...overrides}
    />,
  );
  return { onExtractDocument, onBuildBrief };
}

describe('CondenseMaterialPanel', () => {
  beforeEach(() => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
  });

  it('renders nothing at all when the batch has no shared material', () => {
    const { container } = render(
      <CondenseMaterialPanel sources={[]} extracts={{}} brief={null} onExtractDocument={vi.fn()} onBuildBrief={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the arithmetic that makes condensing necessary', () => {
    // Added raw, thirty documents divide the shared-material budget thirty ways. The size of the
    // corpus beside the size of a prompt is the whole argument, so it is on screen.
    renderPanel({ sources: [pasteSource('paste-1', 'Billing Grid', 'x'.repeat(148000))] });

    expect(screen.getByText(/runs to 148,000 characters/)).toBeInTheDocument();
    expect(screen.getByText(/a prompt holds about/)).toBeInTheDocument();
  });

  it('says which documents have been condensed and which have not', () => {
    renderPanel({
      sources: [pasteSource('paste-1', 'Billing Grid', 'a'), pasteSource('paste-2', 'Cutover Email', 'b')],
      extracts: { 'paste-1': extract('paste-1', 'Billing Grid') },
    });

    const documentList = screen.getByLabelText('Documents to condense');

    expect(documentList).toHaveTextContent(/Billing Grid.*condensed to/);
    expect(documentList).toHaveTextContent(/Cutover Email.*not condensed yet/);
  });

  it('opens one document at a time rather than thirty prompts at once', async () => {
    const user = userEvent.setup();
    renderPanel({ sources: [pasteSource('paste-1', 'Billing Grid', 'the text'), pasteSource('paste-2', 'Cutover Email', 'more')] });

    expect(screen.queryByLabelText(/Condense "Billing Grid"/)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Condense this one' })[0]);

    expect(screen.getByLabelText('Condense "Billing Grid"')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Condense "Cutover Email"/)).not.toBeInTheDocument();
  });

  it('splits a document too long for one prompt instead of truncating it', async () => {
    const user = userEvent.setup();
    renderPanel({ sources: [pasteSource('paste-1', 'Big Notebook', 'x'.repeat(30000))] });

    await user.click(screen.getByRole('button', { name: 'Condense this one' }));

    expect(screen.getByLabelText(/part 1 of 3/)).toBeInTheDocument();
    expect(screen.getByLabelText(/part 3 of 3/)).toBeInTheDocument();
  });

  it('holds back the consolidation until two documents have been condensed', () => {
    renderPanel({
      sources: [pasteSource('paste-1', 'Billing Grid', 'a'), pasteSource('paste-2', 'Cutover Email', 'b')],
      extracts: { 'paste-1': extract('paste-1', 'Billing Grid') },
    });

    expect(screen.queryByLabelText(/Consolidate/)).not.toBeInTheDocument();
    expect(screen.getByText(/at least two documents/)).toBeInTheDocument();
  });

  it('offers the consolidation once there are two extracts', () => {
    renderPanel({
      sources: [pasteSource('paste-1', 'Billing Grid', 'a'), pasteSource('paste-2', 'Cutover Email', 'b')],
      extracts: {
        'paste-1': extract('paste-1', 'Billing Grid'),
        'paste-2': extract('paste-2', 'Cutover Email'),
      },
    });

    expect(screen.getByLabelText('Consolidate 2 extracts into one brief')).toBeInTheDocument();
  });

  it('reports the size the corpus came down to once a brief exists', () => {
    const brief: CorpusBrief = {
      overview: 'Billing moves to consolidated statements.',
      decisions: [{ text: 'Consolidated statements', sourceTitles: ['Billing Grid'] }],
      requirements: [],
      openQuestions: [],
      conflicts: [],
      extractCount: 31,
      builtAtIso: '2026-08-27T00:00:00.000Z',
    };

    renderPanel({ sources: [pasteSource('paste-1', 'Billing Grid', 'x'.repeat(148000))], brief });

    expect(screen.getByText(/from 31 documents/)).toBeInTheDocument();
    expect(screen.getByText(/carry this brief instead of the documents/)).toBeInTheDocument();
  });

  it('names the conflicts on screen, because that is what a PO has to act on', () => {
    // A contradiction nobody spotted is how a Feature gets written against last year's answer.
    const brief: CorpusBrief = {
      overview: '',
      decisions: [],
      requirements: [],
      openQuestions: [],
      conflicts: [{
        subject: 'Runout ownership',
        positions: [
          { text: 'Blue owns runout', sourceTitles: ['Billing Grid'] },
          { text: 'Purple owns runout', sourceTitles: ['Cutover Email'] },
        ],
      }],
      extractCount: 2,
      builtAtIso: '2026-08-27T00:00:00.000Z',
    };

    renderPanel({ brief });

    expect(screen.getByText(/Runout ownership/)).toBeInTheDocument();
    expect(screen.getByText(/1 conflict\(s\) found/)).toBeInTheDocument();
  });

  it('renders nothing of the AI round trip when AI Assist is locked', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
    renderPanel({
      extracts: {
        'paste-1': extract('paste-1', 'Billing Grid'),
        'paste-2': extract('paste-2', 'Cutover Email'),
      },
      sources: [pasteSource('paste-1', 'Billing Grid', 'a'), pasteSource('paste-2', 'Cutover Email', 'b')],
    });

    expect(screen.queryByLabelText(/Consolidate/)).not.toBeInTheDocument();
  });
});
