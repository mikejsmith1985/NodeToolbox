// MermaidEditorView.test.tsx — Exercises the Mermaid Editor user interface with Mermaid mocked.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="rendered-svg"></svg>', diagramType: 'flowchart' }),
  },
}));

import mermaid from 'mermaid';

import MermaidEditorView from './MermaidEditorView.tsx';
import { MERMAID_EDITOR_STORAGE_KEY } from './hooks/useMermaidEditorState.ts';

const MOCKED_MERMAID = vi.mocked(mermaid);
const EDITED_DIAGRAM_SOURCE = 'flowchart LR\n  Input --> Output';
const MOCK_RENDER_RESPONSE = { svg: '<svg data-testid="rendered-svg"></svg>', diagramType: 'flowchart' };
const RENDER_DEBOUNCE_MS = 300;
const TIMER_FLUSH_MS = RENDER_DEBOUNCE_MS + 10;

async function flushDebouncedRender() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TIMER_FLUSH_MS);
  });
}

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.navigator, {
    clipboard: { writeText },
  });
  return writeText;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  MOCKED_MERMAID.render.mockReset();
  MOCKED_MERMAID.render.mockResolvedValue(MOCK_RENDER_RESPONSE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MermaidEditorView', () => {
  it('renders the split editor, preview, and toolbar controls', async () => {
    render(<MermaidEditorView />);

    expect(screen.getByRole('heading', { name: 'Mermaid Editor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mermaid diagram source')).toBeInTheDocument();
    expect(screen.getByLabelText('Templates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy SVG' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeDisabled();
  });

  it('debounces Mermaid rendering after source edits', async () => {
    render(<MermaidEditorView />);

    fireEvent.change(screen.getByLabelText('Mermaid diagram source'), {
      target: { value: EDITED_DIAGRAM_SOURCE },
    });

    expect(MOCKED_MERMAID.render).not.toHaveBeenCalled();

    await flushDebouncedRender();

    expect(MOCKED_MERMAID.render).toHaveBeenCalledWith(expect.stringContaining('mermaid-editor-'), EDITED_DIAGRAM_SOURCE);
    expect(window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY)).toBe(EDITED_DIAGRAM_SOURCE);
    expect(screen.getByTestId('rendered-svg')).toBeInTheDocument();
  });

  it('loads a selected template into the editor', async () => {
    render(<MermaidEditorView />);

    fireEvent.change(screen.getByLabelText('Templates'), { target: { value: 'gantt' } });

    expect((screen.getByLabelText('Mermaid diagram source') as HTMLTextAreaElement).value).toContain('gantt');

    await flushDebouncedRender();

    expect(MOCKED_MERMAID.render).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('gantt'));
  });

  it('copies the rendered SVG markup to the clipboard', async () => {
    const writeText = installClipboardMock();
    render(<MermaidEditorView />);

    await flushDebouncedRender();
    expect(screen.getByTestId('rendered-svg')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SVG' }));
    });

    expect(writeText).toHaveBeenCalledWith('<svg data-testid="rendered-svg"></svg>');
  });

  it('clears the editor, preview, and persisted draft when Clear is clicked', async () => {
    render(<MermaidEditorView />);
    const sourceTextarea = screen.getByLabelText('Mermaid diagram source') as HTMLTextAreaElement;

    fireEvent.change(sourceTextarea, { target: { value: EDITED_DIAGRAM_SOURCE } });
    await flushDebouncedRender();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(sourceTextarea.value).toBe('');
    expect(screen.queryByTestId('rendered-svg')).not.toBeInTheDocument();
    expect(screen.getByText('Enter Mermaid source to render a preview.')).toBeInTheDocument();
    expect(window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY)).toBeNull();
  });

  it('shows a status error when the Clipboard API rejects the copy request', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    Object.assign(window.navigator, {
      clipboard: { writeText },
    });
    render(<MermaidEditorView />);

    await flushDebouncedRender();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SVG' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to copy SVG to the clipboard. Clipboard denied');
  });

  it('creates a Blob URL when downloading the rendered SVG', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MermaidEditorView />);

    await flushDebouncedRender();
    expect(screen.getByTestId('rendered-svg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickAnchor).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:diagram');
  });

  it('shows Mermaid render errors without crashing the view', async () => {
    MOCKED_MERMAID.render.mockRejectedValueOnce(new Error('Unexpected Mermaid token'));

    render(<MermaidEditorView />);
    await flushDebouncedRender();

    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected Mermaid token');
  });
});
