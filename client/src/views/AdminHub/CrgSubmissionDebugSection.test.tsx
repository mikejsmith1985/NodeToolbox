// CrgSubmissionDebugSection.test.tsx — Tests for CRG Submission Debug section in Admin Hub.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChgSubmissionDebug } from '../SnowHub/hooks/useCrgState.ts';
import { useCrgSubmissionDebugStore } from '../../hooks/useCrgSubmissionDebugStore.ts';
import { CrgSubmissionDebugSection } from './CrgSubmissionDebugSection';

describe('CrgSubmissionDebugSection', () => {
  beforeEach(() => {
    useCrgSubmissionDebugStore.setState({ lastSubmissionDebug: null });
    vi.clearAllMocks();
  });

  it('renders when there is no submission debug', () => {
    render(<CrgSubmissionDebugSection />);
    expect(screen.getByRole('heading', { name: /CRG Submission Debug/i })).toBeInTheDocument();
    expect(screen.getByText(/No CRG submissions yet/i)).toBeInTheDocument();
  });

  it('displays submission debug data when available', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'create',
      targetChgNumber: 'CHG0001234',
      requestPayloadJson: JSON.stringify({ short_description: 'Test' }),
      operationResponseJson: JSON.stringify({ result: { number: 'CHG0001234' } }),
      verificationRecordJson: JSON.stringify({ sys_id: 'id-123' }),
      mismatchMessages: [],
    };

    useCrgSubmissionDebugStore.setState({ lastSubmissionDebug: mockDebug });

    render(<CrgSubmissionDebugSection />);

    expect(screen.getByText(/Operation: CREATE CHG0001234/i)).toBeInTheDocument();
  });

  it('displays verification warnings when present', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'update',
      targetChgNumber: 'CHG0005678',
      requestPayloadJson: '{}',
      operationResponseJson: '{}',
      verificationRecordJson: '{}',
      mismatchMessages: [
        'impact: expected "1-High" but SNow returned "3".',
        'changeManager: expected "sys-id-123" but SNow returned "empty".',
      ],
    };

    useCrgSubmissionDebugStore.setState({ lastSubmissionDebug: mockDebug });

    render(<CrgSubmissionDebugSection />);

    expect(screen.getByText('Verification warnings')).toBeInTheDocument();
    expect(screen.getByText(/impact: expected/i)).toBeInTheDocument();
    expect(screen.getByText(/changeManager: expected/i)).toBeInTheDocument();
  });

  it('renders textareas for JSON payloads', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'create',
      targetChgNumber: 'CHG0001234',
      requestPayloadJson: '{"test": "data"}',
      operationResponseJson: '{"result": "success"}',
      verificationRecordJson: '{"verified": true}',
      mismatchMessages: [],
    };

    useCrgSubmissionDebugStore.setState({ lastSubmissionDebug: mockDebug });

    render(<CrgSubmissionDebugSection />);

    expect(screen.getByDisplayValue('{"test": "data"}')).toBeInTheDocument();
    expect(screen.getByDisplayValue('{"result": "success"}')).toBeInTheDocument();
    expect(screen.getByDisplayValue('{"verified": true}')).toBeInTheDocument();
  });
});
