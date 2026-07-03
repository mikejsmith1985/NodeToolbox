// SurfaceScopeBar.test.tsx — Verifies the Surface scope control renders, surfaces, and refines.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_SCOPE_FILTERS } from './scopeQuery.ts';
import { SurfaceScopeBar, type SurfaceScopeBarProps } from './SurfaceScopeBar.tsx';

function renderBar(overrides: Partial<SurfaceScopeBarProps> = {}) {
  const props: SurfaceScopeBarProps = {
    jql: 'project = "DENP" AND issuetype in (Feature, Epic)',
    onJqlChange: vi.fn(),
    onSurface: vi.fn(),
    filters: EMPTY_SCOPE_FILTERS,
    onFiltersChange: vi.fn(),
    status: 'ready',
    error: null,
    resultCount: 3,
    ...overrides,
  };
  render(<SurfaceScopeBar {...props} />);
  return props;
}

describe('SurfaceScopeBar', () => {
  it('renders the pre-filled query and surfaces on the Surface button', () => {
    const props = renderBar();
    expect((screen.getByLabelText(/surface query/i) as HTMLInputElement).value).toContain('issuetype in (Feature, Epic)');
    fireEvent.click(screen.getByRole('button', { name: /surface/i }));
    expect(props.onSurface).toHaveBeenCalledTimes(1);
  });

  it('emits query edits and refine-filter changes', () => {
    const props = renderBar();
    fireEvent.change(screen.getByLabelText(/surface query/i), { target: { value: 'labels = ENCUC' } });
    expect(props.onJqlChange).toHaveBeenCalledWith('labels = ENCUC');

    fireEvent.change(screen.getByLabelText(/filter by label/i), { target: { value: 'ENCUC' } });
    expect(props.onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'ENCUC' }));
  });

  it('disables Surface while loading and shows the query error', () => {
    renderBar({ status: 'loading' });
    expect(screen.getByRole('button', { name: /surfacing/i })).toBeDisabled();

    renderBar({ status: 'error', error: 'jql error 400' });
    expect(screen.getByRole('alert')).toHaveTextContent(/jql error 400/);
  });
});
