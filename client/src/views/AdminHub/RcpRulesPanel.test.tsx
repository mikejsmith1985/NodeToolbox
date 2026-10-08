// RcpRulesPanel.test.tsx — The Admin Hub switch for the temporary RCP production-change rules (GH #415).

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { readRcpRulesEnabled } from '../SnowHub/rcp/rcpApprovalEmail.ts';
import { RcpRulesPanel } from './RcpRulesPanel.tsx';

describe('RcpRulesPanel', () => {
  afterEach(() => localStorage.clear());

  it('is on by default, says when the rules end, and switches them off', () => {
    render(<RcpRulesPanel />);
    const toggle = screen.getByRole('checkbox', { name: /Check Production changes against the RCP rules/ });

    expect(toggle).toBeChecked();
    expect(screen.getByText(/2027-01-19/)).toBeInTheDocument();
    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(readRcpRulesEnabled()).toBe(false);
  });
});
