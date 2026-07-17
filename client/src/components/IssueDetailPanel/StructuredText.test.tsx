// StructuredText.test.tsx — Unit tests for structured-description rendering.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StructuredText } from './StructuredText.tsx';

describe('StructuredText', () => {
  it('renders headings, paragraphs, and groups consecutive list items into one list', () => {
    render(
      <StructuredText
        blocks={[
          { kind: 'heading', text: 'Day one:' },
          { kind: 'paragraph', text: 'Member is enrolled' },
          { kind: 'listItem', text: 'Export to Facets', level: 1 },
          { kind: 'listItem', text: 'Export to ESI', level: 1 },
        ]}
      />,
    );

    expect(screen.getByText('Day one:').tagName).toBe('H4');
    expect(screen.getByText('Member is enrolled').tagName).toBe('P');
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);
    expect(listItems[0].closest('ul')).toBe(listItems[1].closest('ul'));
  });

  it('marks level-2 items as nested', () => {
    render(<StructuredText blocks={[{ kind: 'listItem', text: 'nested step', level: 2 }]} />);
    expect(screen.getByText('nested step').className).toContain('structuredListItemNested');
  });
});
