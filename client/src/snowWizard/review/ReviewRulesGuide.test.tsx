// ReviewRulesGuide.test.tsx — Proves the explanation lists every check the review runs (and only those), with what
// passes each, the restricted-period rules, and what every verdict means.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { READINESS_ITEM_IDS } from '../../views/SnowHub/guided/changeReadiness.ts';
import ReviewRulesGuide from './ReviewRulesGuide.tsx';

describe('ReviewRulesGuide', () => {
  it('explains every check the review runs, leaving out the ones it does not', () => {
    render(<ReviewRulesGuide excludedItemIds={new Set(['riskCheck', 'prbs'])} />);
    const checkCount = READINESS_ITEM_IDS.length - 2;
    expect(screen.getByText(`What the Wizard checks, and why (${checkCount} checks)`)).toBeTruthy();
    const checks = within(screen.getByRole('list', { name: 'The checks' }));
    expect(checks.getAllByText('Passes when')).toHaveLength(checkCount);
    expect(checks.getByText('Outage record')).toBeTruthy();
    expect(checks.queryByText('Risk check')).toBeNull();
  });

  it('lists the restricted-period rules and what each verdict means', () => {
    render(<ReviewRulesGuide excludedItemIds={new Set()} />);
    expect(within(screen.getByRole('list', { name: 'Restricted change period rules: the rules' })).getByText('Submitted early enough')).toBeTruthy();
    const verdicts = within(screen.getByRole('list', { name: 'What each verdict means' }));
    expect(verdicts.getByText(/never counted as a pass/)).toBeTruthy();
    expect(verdicts.getAllByRole('listitem')).toHaveLength(4);
  });
});
