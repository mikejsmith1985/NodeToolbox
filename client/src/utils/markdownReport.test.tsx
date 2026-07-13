// markdownReport.test.tsx — Unit tests for the lightweight, safe Markdown-to-React report renderer.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderMarkdownReport } from './markdownReport.tsx';

describe('renderMarkdownReport', () => {
  it('renders ATX headings at descending levels', () => {
    render(<div>{renderMarkdownReport('# Release Risk\n## Summary\n### Details')}</div>);

    expect(screen.getByRole('heading', { level: 3, name: 'Release Risk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'Details' })).toBeInTheDocument();
  });

  it('renders inline bold and code spans inside a paragraph', () => {
    render(<div>{renderMarkdownReport('This is **critical** and `config-only`.')}</div>);

    expect(screen.getByText('critical').tagName).toBe('STRONG');
    expect(screen.getByText('config-only').tagName).toBe('CODE');
  });

  it('renders an unordered list with one item per bullet line', () => {
    render(<div>{renderMarkdownReport('- First risk\n- Second risk')}</div>);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent('First risk');
    expect(listItems[1]).toHaveTextContent('Second risk');
  });

  it('renders a GFM pipe table with header cells and body rows', () => {
    const markdownTable = [
      '| Ticket | Dev-Skip Risk |',
      '| --- | --- |',
      '| TBX-1 | Low |',
      '| TBX-2 | High |',
    ].join('\n');

    render(<div>{renderMarkdownReport(markdownTable)}</div>);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Ticket' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Dev-Skip Risk' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'TBX-1' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'High' })).toBeInTheDocument();
  });

  it('does not execute embedded HTML — it is rendered as literal text, not markup', () => {
    render(<div>{renderMarkdownReport('Watch out <img src=x onerror=alert(1)> here')}</div>);

    // The angle-bracket content is escaped by React into text, so no <img> element exists.
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/onerror=alert\(1\)/)).toBeInTheDocument();
  });

  it('returns an empty fragment for blank input without throwing', () => {
    render(<div data-testid="empty">{renderMarkdownReport('   ')}</div>);
    expect(screen.getByTestId('empty')).toBeEmptyDOMElement();
  });
});
