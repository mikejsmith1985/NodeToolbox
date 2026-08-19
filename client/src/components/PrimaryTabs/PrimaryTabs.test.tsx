// PrimaryTabs.test.tsx — Unit tests for shared top-level tab navigation.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrimaryTabs } from './PrimaryTabs.tsx';

describe('PrimaryTabs', () => {
  it('renders tabs and marks the active tab', () => {
    render(
      <PrimaryTabs
        ariaLabel="Test tabs"
        idPrefix="test"
        tabs={[
          { key: 'one', label: 'One' },
          { key: 'two', label: 'Two' },
        ]}
        activeTab="one"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange when a tab is clicked', () => {
    const handleTabChange = vi.fn();
    render(
      <PrimaryTabs
        ariaLabel="Test tabs"
        idPrefix="test"
        tabs={[
          { key: 'one', label: 'One' },
          { key: 'two', label: 'Two' },
        ]}
        activeTab="one"
        onChange={handleTabChange}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(handleTabChange).toHaveBeenCalledWith('two');
  });
});

describe('PrimaryTabs — a nested strip must not pin over its parent', () => {
  it('drops the sticky class when nested inside another tabbed view', () => {
    // The Dev Panel renders its own strip inside the Admin Hub's. Both pinned to top: 0 with the
    // same z-index, so the inner one painted over the outer as soon as the page scrolled — and the
    // Admin Hub's own tabs, Change Review among them, became unreachable without scrolling to the
    // very top. An inner strip has no business pinning to the top of the window.
    const { container } = render(
      <PrimaryTabs
        ariaLabel="Dev Panel tabs"
        isNested
        tabs={[{ key: 'a', label: 'Jira API' }, { key: 'b', label: 'Server Logs' }]}
        activeTab="a"
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('[role="tablist"]')?.className).not.toMatch(/sticky/i);
  });

  it('stays sticky by default, which is what a top-level strip needs', () => {
    const { container } = render(
      <PrimaryTabs
        ariaLabel="Admin Hub tabs"
        tabs={[{ key: 'a', label: 'Config' }]}
        activeTab="a"
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('[role="tablist"]')?.className).toMatch(/sticky/i);
  });
});
