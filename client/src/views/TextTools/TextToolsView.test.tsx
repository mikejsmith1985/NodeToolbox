// TextToolsView.test.tsx — Unit tests for the Text Tools tabbed view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'smart-formatter' as
      | 'smart-formatter'
      | 'json'
      | 'case'
      | 'url'
      | 'base64'
      | 'extractor'
      | 'mermaid',
    smartFormatterInput: '',
    smartFormatterMode: 'markdown' as 'markdown' | 'plain' | 'structured',
    jsonInput: '',
    jsonIndentMode: 2 as 2 | 4 | 0,
    caseInput: '',
    urlInput: '',
    urlOperation: 'encode' as 'encode' | 'decode',
    urlScope: 'component' as 'component' | 'full',
    base64Input: '',
    base64Operation: 'encode' as 'encode' | 'decode',
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setSmartFormatterInput: vi.fn(),
    setSmartFormatterMode: vi.fn(),
    clearSmartFormatter: vi.fn(),
    setJsonInput: vi.fn(),
    setJsonIndentMode: vi.fn(),
    clearJson: vi.fn(),
    setCaseInput: vi.fn(),
    setUrlInput: vi.fn(),
    setUrlOperation: vi.fn(),
    setUrlScope: vi.fn(),
    clearUrl: vi.fn(),
    setBase64Input: vi.fn(),
    setBase64Operation: vi.fn(),
    clearBase64: vi.fn(),
  },
}));

vi.mock('./hooks/useTextToolsState.ts', () => ({
  useTextToolsState: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('./utils/textTransformUtils.ts', () => ({
  convertToMarkdown: vi.fn((input: string) => input),
  convertToPlainText: vi.fn((input: string) => input),
  convertToStructured: vi.fn((input: string) => input),
  formatJson: vi.fn(() => ({ output: '', errorMessage: null })),
  buildCaseVariants: vi.fn(() => []),
  transformUrl: vi.fn(() => ({ output: '', errorMessage: null })),
  transformBase64: vi.fn(() => ({ output: '', errorMessage: null })),
}));

vi.mock('../MermaidEditor/MermaidEditorView.tsx', () => ({
  default: () => <div>Mock Mermaid Editor</div>,
}));

import TextToolsView from './TextToolsView.tsx';

describe('TextToolsView', () => {
  beforeEach(() => {
    mockState.activeTab = 'smart-formatter';
    vi.clearAllMocks();
  });

  it('renders all 7 tab buttons', () => {
    render(<TextToolsView />);
    expect(screen.getByRole('tab', { name: /smart formatter/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /json/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /case/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /url/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /base64/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /extractor/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /mermaid/i })).toBeInTheDocument();
  });

  it('shows the Smart Formatter panel when that tab is active', () => {
    mockState.activeTab = 'smart-formatter';
    render(<TextToolsView />);
    expect(screen.getByLabelText(/smart formatter input/i)).toBeInTheDocument();
  });

  it('renders the JSON formatter panel when json tab is active', () => {
    mockState.activeTab = 'json';
    render(<TextToolsView />);
    expect(screen.getByLabelText(/json input/i)).toBeInTheDocument();
  });

  it('shows the case converter textarea and placeholder text', () => {
    mockState.activeTab = 'case';
    render(<TextToolsView />);
    expect(screen.getByPlaceholderText(/type or paste text/i)).toBeInTheDocument();
  });

  it('renders the URL encoder panels', () => {
    mockState.activeTab = 'url';
    render(<TextToolsView />);
    expect(screen.getByLabelText(/url input/i)).toBeInTheDocument();
  });

  it('renders the Base64 encoder panels', () => {
    mockState.activeTab = 'base64';
    render(<TextToolsView />);
    expect(screen.getByLabelText(/base64 input/i)).toBeInTheDocument();
  });

  it('renders the embedded Mermaid editor tab', () => {
    mockState.activeTab = 'mermaid';
    render(<TextToolsView />);
    expect(screen.getByText('Mock Mermaid Editor')).toBeInTheDocument();
  });
});
