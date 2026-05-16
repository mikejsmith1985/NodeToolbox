// useCrgSubmissionDebugStore.test.ts — Tests for CRG submission debug store.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ChgSubmissionDebug } from '../views/SnowHub/hooks/useCrgState.ts';
import { useCrgSubmissionDebugStore } from './useCrgSubmissionDebugStore.ts';

describe('useCrgSubmissionDebugStore', () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
    useCrgSubmissionDebugStore.setState({ lastSubmissionDebug: null });
  });

  it('initializes with null lastSubmissionDebug', () => {
    const state = useCrgSubmissionDebugStore.getState();
    expect(state.lastSubmissionDebug).toBeNull();
  });

  it('updates lastSubmissionDebug when updateLastSubmissionDebug is called', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'create',
      targetChgNumber: 'CHG0001234',
      requestPayloadJson: '{"test": "data"}',
      operationResponseJson: '{"result": "success"}',
      verificationRecordJson: '{"verified": true}',
      mismatchMessages: [],
    };

    useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(mockDebug);

    const updatedState = useCrgSubmissionDebugStore.getState();
    expect(updatedState.lastSubmissionDebug).toEqual(mockDebug);
    expect(updatedState.lastSubmissionDebug?.operation).toBe('create');
  });

  it('updates lastSubmissionDebug to null when passed null', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'update',
      targetChgNumber: 'CHG0005678',
      requestPayloadJson: '{}',
      operationResponseJson: '{}',
      verificationRecordJson: '{}',
      mismatchMessages: ['warning: test'],
    };

    // First set a debug value
    useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(mockDebug);
    expect(useCrgSubmissionDebugStore.getState().lastSubmissionDebug).not.toBeNull();

    // Then clear it
    useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(null);
    expect(useCrgSubmissionDebugStore.getState().lastSubmissionDebug).toBeNull();
  });

  it('preserves mismatchMessages in stored submission debug', () => {
    const mockDebug: ChgSubmissionDebug = {
      operation: 'create',
      targetChgNumber: 'CHG0001111',
      requestPayloadJson: '{}',
      operationResponseJson: '{}',
      verificationRecordJson: '{}',
      mismatchMessages: ['field1: expected "value1"', 'field2: expected "value2"'],
    };

    useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(mockDebug);

    const storedDebug = useCrgSubmissionDebugStore.getState().lastSubmissionDebug;
    expect(storedDebug?.mismatchMessages).toHaveLength(2);
    expect(storedDebug?.mismatchMessages[0]).toBe('field1: expected "value1"');
  });
});
