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
