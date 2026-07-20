// IssueSearchBar.test.tsx — Unit tests for the lookup key input: search parity, normalization, invalid hint.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueSearchBar } from './IssueSearchBar.tsx';

describe('IssueSearchBar', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls onSearch with the normalized key when the user presses Enter', () => {
    const onSearch = vi.fn();
    render(<IssueSearchBar onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: ' encuc-1234 ' } });
    fireEvent.keyDown(screen.getByLabelText('Issue key'), { key: 'Enter' });

    expect(onSearch).toHaveBeenCalledWith('ENCUC-1234');
  });

  it('calls onSearch when the Search button is clicked', () => {
    const onSearch = vi.fn();
    render(<IssueSearchBar onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'ENCUC-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith('ENCUC-1234');
  });

  it('extracts the key from a pasted Jira browse URL', () => {
    const onSearch = vi.fn();
    render(<IssueSearchBar onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Issue key'), {
      target: { value: 'https://jira.example.com/browse/ENCUC-42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith('ENCUC-42');
  });

  it('shows a hint and does not search for input that is not a key', () => {
    const onSearch = vi.fn();
    render(<IssueSearchBar onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter an issue key like ABC-123/)).toBeInTheDocument();
  });

  it('clears the hint once the user edits the input again', () => {
    render(<IssueSearchBar onSearch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText(/Enter an issue key like ABC-123/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'A' } });
    expect(screen.queryByText(/Enter an issue key like ABC-123/)).not.toBeInTheDocument();
  });
});
