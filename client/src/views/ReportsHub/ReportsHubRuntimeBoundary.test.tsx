// ReportsHubRuntimeBoundary.test.tsx — Unit tests for the Reports Hub runtime diagnostic boundary.

import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ReportsHubRuntimeBoundary } from './ReportsHubRuntimeBoundary.tsx';

function CrashOnRender(): ReactElement {
  throw new Error('Simulated reports render crash');
}

describe('ReportsHubRuntimeBoundary', () => {
  it('renders child content when no runtime error occurs', () => {
    render(
      <ReportsHubRuntimeBoundary>
        <div>Reports content</div>
      </ReportsHubRuntimeBoundary>,
    );

    expect(screen.getByText('Reports content')).toBeInTheDocument();
  });

  it('renders diagnostics instead of a blank screen when child render throws', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ReportsHubRuntimeBoundary>
        <CrashOnRender />
      </ReportsHubRuntimeBoundary>,
    );

    expect(
      screen.getByRole('heading', { name: 'Reports Hub encountered a runtime error' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeInTheDocument();
    expect(screen.getByText(/Simulated reports render crash/i)).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
