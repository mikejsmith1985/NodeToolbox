// ReadinessFixControl.test.tsx — Proves each readiness alert offers an inline fix that delegates to
// the shared featureReviewFixes writers with the right target and payload.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the network write/search fns; pure helpers (normalizePcodeInput) stay real.
vi.mock('../../SprintDashboard/featureReviewFixes.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../SprintDashboard/featureReviewFixes.ts')>()),
  saveFeatureReviewUserField: vi.fn().mockResolvedValue(undefined),
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
  searchFeatureReviewUsers: vi.fn().mockResolvedValue([{ displayName: 'Alex Owner', userIdentifier: 'alex@x.com' }]),
}));

import { ReadinessFixControl } from './ReadinessFixControl.tsx';
import type { ReadinessAlertFamilyState, ReadinessAlertId, ReadinessFeature } from './readinessScan.ts';
import {
  saveFeatureReviewUserField,
  saveFeatureReviewSimpleField,
} from '../../SprintDashboard/featureReviewFixes.ts';

const WRITE_FIELD_IDS = {
  productOwnerFieldId: 'customfield_20002',
  estimateFieldId: 'customfield_20007',
  pcodeFieldId: 'customfield_20008',
  targetEndFieldId: 'customfield_10102',
};

const FAMILY_STATES: Record<ReadinessAlertId, ReadinessAlertFamilyState> = {
  'missing-ownership': 'active',
  'missing-estimate': 'active',
  'missing-pcode': 'active',
  'target-end-missing-or-past': 'active',
  'due-date-missing-or-past': 'active',
};

function buildFeature(): ReadinessFeature {
  return {
    issue: { key: 'FEAT-1', fields: { summary: 'F', status: { name: 'Analyzing', statusCategory: { key: 'new' } } } },
    key: 'FEAT-1',
    summary: 'F',
    statusName: 'Analyzing',
    statusBucket: 'todo',
    assigneeDisplayName: null,
    productOwnerDisplayName: null,
    estimateValue: null,
    pcodeValue: null,
    targetEndIso: null,
    dueDateIso: null,
    ageDays: 3,
    impedimentReasons: [],
    alerts: [],
  } as unknown as ReadinessFeature;
}

function renderControl(alertId: ReadinessAlertId, onFixed = vi.fn()) {
  render(
    <ReadinessFixControl
      feature={buildFeature()}
      alertId={alertId}
      writeFieldIds={WRITE_FIELD_IDS}
      alertFamilyStates={FAMILY_STATES}
      onFixed={onFixed}
    />,
  );
  return onFixed;
}

beforeEach(() => vi.clearAllMocks());

describe('ReadinessFixControl', () => {
  it('assigns ownership to the assignee field by default and calls onFixed', async () => {
    const onFixed = renderControl('missing-ownership');

    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'Alex' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alex Owner' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/owner candidate/i), { target: { value: 'alex@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewUserField).toHaveBeenCalledWith('FEAT-1', 'assignee', 'alex@x.com');
    });
    expect(onFixed).toHaveBeenCalled();
  });

  it('writes ownership to the Product Owner field when that target is chosen', async () => {
    renderControl('missing-ownership');

    fireEvent.change(screen.getByLabelText(/ownership target/i), { target: { value: 'customfield_20002' } });
    fireEvent.change(screen.getByLabelText(/search users/i), { target: { value: 'Alex' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alex Owner' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/owner candidate/i), { target: { value: 'alex@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewUserField).toHaveBeenCalledWith('FEAT-1', 'customfield_20002', 'alex@x.com');
    });
  });

  it('normalizes a P-prefixed PCode before writing the whole number', async () => {
    renderControl('missing-pcode');

    fireEvent.change(screen.getByLabelText(/pcode/i), { target: { value: 'P00012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('FEAT-1', 'customfield_20008', '12345');
    });
  });

  it('rejects a non-numeric PCode without writing', async () => {
    renderControl('missing-pcode');

    fireEvent.change(screen.getByLabelText(/pcode/i), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(saveFeatureReviewSimpleField).not.toHaveBeenCalled();
  });

  it('writes the estimate value to its field', async () => {
    renderControl('missing-estimate');

    fireEvent.change(screen.getByLabelText(/estimate/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('FEAT-1', 'customfield_20007', '8');
    });
  });

  it('writes a due date to the native duedate field', async () => {
    renderControl('due-date-missing-or-past');

    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('FEAT-1', 'duedate', '2026-08-20');
    });
  });

  it('writes a target end date to the configured target-end field', async () => {
    renderControl('target-end-missing-or-past');

    fireEvent.change(screen.getByLabelText(/target end/i), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('FEAT-1', 'customfield_10102', '2026-09-01');
    });
  });

  it('surfaces Jira errors on the row and leaves the alert unresolved', async () => {
    vi.mocked(saveFeatureReviewSimpleField).mockRejectedValueOnce(new Error('Field cannot be set'));
    const onFixed = renderControl('missing-estimate');

    fireEvent.change(screen.getByLabelText(/estimate/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Field cannot be set'));
    expect(onFixed).not.toHaveBeenCalled();
  });

  it('links out instead of editing when the field family is not configured', () => {
    render(
      <ReadinessFixControl
        feature={buildFeature()}
        alertId="missing-estimate"
        writeFieldIds={{ ...WRITE_FIELD_IDS, estimateFieldId: null }}
        alertFamilyStates={{ ...FAMILY_STATES, 'missing-estimate': 'notConfigured' }}
        onFixed={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: /open in jira/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix' })).not.toBeInTheDocument();
  });
});
