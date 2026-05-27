// TeamDashboardHygieneTab.test.tsx — Tests for Team Dashboard hygiene adapter behavior.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import TeamDashboardHygieneTab from './TeamDashboardHygieneTab.tsx';
import { HYGIENE_PROJECT_KEY_STORAGE_KEY } from '../Hygiene/hooks/useHygieneState.ts';

describe('TeamDashboardHygieneTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores the active Team Dashboard project key for the embedded Hygiene view', () => {
    render(<TeamDashboardHygieneTab projectKey="tbx" />);

    expect(window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY)).toBe('TBX');
    expect(screen.getByRole('heading', { name: 'Hygiene' })).toBeInTheDocument();
  });

  it('does not overwrite stored hygiene project key when Team Dashboard project key is blank', () => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, 'EXISTING');

    render(<TeamDashboardHygieneTab projectKey="   " />);

    expect(window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY)).toBe('EXISTING');
  });
});
