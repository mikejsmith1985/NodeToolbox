// PiDeliveryPlanTab.test.tsx — Smoke tests for the PI Delivery Planner tab (spec 032, US1). Confirms the
// tab renders its pipeline sections and that the AI-gated step is hidden until AI Assist is unlocked.

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PiDeliveryPlanTab from './PiDeliveryPlanTab.tsx';
import { useAiAssistStore, setAiAssistUnlocked } from '../../store/aiAssistStore.ts';

afterEach(() => {
  // Reset the shared AI-gate so tests don't leak unlock state into each other.
  setAiAssistUnlocked(false);
});

describe('PiDeliveryPlanTab', () => {
  it('renders the load section with the selected PI', () => {
    render(<PiDeliveryPlanTab piName="26.4" />);
    expect(screen.getByText(/Load committed Features/i)).toBeTruthy();
    // The PI name is surfaced in the load section.
    expect(screen.getByText('26.4')).toBeTruthy();
  });

  it('renders the on-demand Defect sub-task card (unplanned defect flow)', () => {
    render(<PiDeliveryPlanTab piName="26.4" />);
    expect(screen.getByText(/Defect sub-tasks \(on demand\)/i)).toBeTruthy();
    expect(screen.getByPlaceholderText('DENP-1234')).toBeTruthy();
  });

  it('hides the whole generate section — and never reveals the AI gate — until unlocked', () => {
    render(<PiDeliveryPlanTab piName="26.4" />);
    // The generator is absent AND nothing instructs the user to unlock AI Assist (the gate stays hidden).
    expect(screen.queryByText(/Generate delivery-plan prompt/i)).toBeNull();
    expect(screen.queryByText(/2 · Generate the plan prompt/i)).toBeNull();
    expect(screen.queryByText(/Unlock AI Assist/i)).toBeNull();
  });

  it('shows the prompt generator once AI Assist is unlocked', () => {
    setAiAssistUnlocked(true);
    // Re-render after unlocking so the gate re-evaluates.
    render(<PiDeliveryPlanTab piName="26.4" />);
    // The zustand selector reads the unlocked flag; the generate button is present.
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(true);
    expect(screen.getByText(/Generate delivery-plan prompt/i)).toBeTruthy();
  });
});
