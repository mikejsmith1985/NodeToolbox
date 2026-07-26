// PlannerTab.test.tsx — Smoke coverage for the live mount (spec 028, T024). The guard path (a PI with no
// date range) renders an honest status without touching the network; the deep data flow is covered by the
// unit tests of the pieces it composes.

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlannerTab } from './PlannerTab.tsx';

describe('PlannerTab', () => {
  it('shows an honest status when the selected PI has no date range (no fetch)', async () => {
    render(<PlannerTab boardId={1} projectKey="ABC" selectedPiName="PI 26.3" teamProfileId="team-1" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/no start\/end dates/i));
  });
});
