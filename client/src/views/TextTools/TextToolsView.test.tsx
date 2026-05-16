// TextToolsView.test.tsx — Unit tests for the Text Tools tabbed view component.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'smart-formatter' as
      | 'smart-formatter'
      | 'json'
      | 'case'
      | 'url'
      | 'base64'
      | 'extractor',
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

import TextToolsView from './TextToolsView.tsx';

describe('TextToolsView', () => {
  beforeEach(() => {
    mockState.activeTab = 'smart-formatter';
    vi.clearAllMocks();
  });

  it('renders all 6 tab buttons', () => {
    render(<TextToolsView />);
    expect(screen.getByRole('tab', { name: /smart formatter/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /json/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /case/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /url/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /base64/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /extractor/i })).toBeInTheDocument();
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

  it('renders the Element Extractor tab', () => {
    mockState.activeTab = 'extractor';
    render(<TextToolsView />);
    // The extractor tab panel is rendered — tab button exists
    expect(screen.getByRole('tab', { name: /extractor/i })).toBeInTheDocument();
  });

  it('renders a real javascript bookmarklet href for the extractor installer link', () => {
    mockState.activeTab = 'extractor';
    render(<TextToolsView />);

    expect(screen.getByRole('link', { name: /nodetoolbox snow field extractor/i })).toHaveAttribute(
      'href',
      expect.stringContaining('javascript:'),
    );
  });

  it('filters pasted extractor JSON when a field is deselected', () => {
    mockState.activeTab = 'extractor';
    render(<TextToolsView />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Extractor validation JSON input' }), {
      target: {
        value: JSON.stringify({
          fields: {
            impact: { label: 'Impact', value: '3', displayValue: '3 - Low' },
            u_change_tested: { label: 'Has Been Tested', value: 'yes', displayValue: 'Yes' },
          },
          choiceOptions: {
            impact: [{ value: '3', label: '3 - Low' }],
            u_change_tested: [{ value: 'yes', label: 'Yes' }],
          },
        }),
      },
    });

    expect(screen.getByRole('group', { name: 'Extractor field selection' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Impact impact/i })).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: /Has Been Tested u_change_tested/i }));

    const filteredJsonOutput = screen.getByRole('textbox', { name: 'Extractor filtered JSON output' });
    const filteredPayload = JSON.parse((filteredJsonOutput as HTMLTextAreaElement).value) as {
      fields: Record<string, unknown>;
      choiceOptions: Record<string, unknown>;
    };
    expect(filteredPayload.fields.impact).toBeDefined();
    expect(filteredPayload.choiceOptions.impact).toBeDefined();
    expect(filteredPayload.fields.u_change_tested).toBeUndefined();
    expect(filteredPayload.choiceOptions.u_change_tested).toBeUndefined();
  });

  it('shows parse errors for invalid extractor JSON', () => {
    mockState.activeTab = 'extractor';
    render(<TextToolsView />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Extractor validation JSON input' }), {
      target: { value: '{ not valid json' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/i);
  });
});
