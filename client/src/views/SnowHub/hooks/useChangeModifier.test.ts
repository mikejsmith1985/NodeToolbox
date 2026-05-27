// useChangeModifier.test.ts — Unit tests for the Change Modifier hook.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as snowApi from '../../../services/snowApi.ts';
import { useChangeModifier } from './useChangeModifier.ts';

vi.mock('../../../services/snowApi.ts');

describe('useChangeModifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useChangeModifier());

    expect(result.current.state.changeKey).toBe('');
    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.isSaving).toBe(false);
    expect(result.current.state.isSavingSuccess).toBe(false);
    expect(result.current.state.change).toBeNull();
    expect(result.current.state.ctasks).toEqual([]);
    expect(result.current.state.isDirty).toBe(false);
  });

  it('should fetch change successfully by key', async () => {
    const mockChange = {
      result: [
        {
          sys_id: { value: 'change-sys-id', display_value: '' },
          number: 'CHG0001234',
          short_description: 'Test Change',
          description: 'Test Description',
          justification: 'Test Justification',
          risk_impact_analysis: 'Test Risk',
          category: { value: 'software', display_value: 'Software' },
          type: { value: 'normal', display_value: 'Normal' },
          u_environment: { value: 'PRD', display_value: 'PRD' },
          requested_by: { value: 'user-id', display_value: 'John Doe' },
          cmdb_ci: { value: 'ci-id', display_value: 'app.example.com' },
          assignment_group: { value: 'group-id', display_value: 'DevOps' },
          assigned_to: { value: 'assigned-user-id', display_value: 'Jane Smith' },
          change_manager: { value: 'manager-id', display_value: 'Manager' },
          u_tester: { value: 'tester-id', display_value: 'Tester' },
          u_service_manager: { value: 'sm-id', display_value: 'Service Manager' },
          u_expedited: 'false',
          impact: { value: '3', display_value: '3 - Low' },
          u_availability_impact: 'none',
          u_change_tested: 'yes',
          u_impacted_persons_aware: 'yes',
          u_performed_previously: 'no',
          u_success_probability: 'high',
          u_can_be_backed_out: 'yes',
          implementation_plan: 'Deploy via CI/CD',
          backout_plan: 'Revert to previous version',
          test_plan: 'Run integration tests',
        },
      ],
    };

    const mockCtasks = {
      result: [
        {
          sys_id: { value: 'ctask-sys-id', display_value: '' },
          number: 'CTASK0000001',
          short_description: 'Deployment',
          description: 'Deploy to production',
          assignment_group: { value: 'group-id', display_value: 'DevOps' },
          assigned_to: { value: 'user-id', display_value: 'John Doe' },
          planned_start_date: '2024-01-15 10:00:00',
          planned_end_date: '2024-01-15 12:00:00',
          close_notes: '',
        },
      ],
    };

    vi.mocked(snowApi.snowFetch).mockResolvedValueOnce(mockChange).mockResolvedValueOnce(mockCtasks);

    const { result } = renderHook(() => useChangeModifier());

    expect(result.current.state.isLoading).toBe(false);

    await act(async () => {
      await result.current.actions.fetchChangeByKey('CHG0001234');
    });

    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.change).toBeDefined();
    expect(result.current.state.change?.number).toBe('CHG0001234');
    expect(result.current.state.change?.shortDescription).toBe('Test Change');
    expect(result.current.state.ctasks).toHaveLength(1);
    expect(result.current.state.ctasks[0]?.number).toBe('CTASK0000001');
    expect(result.current.state.error).toBeNull();
  });

  it('should handle fetch error when change not found', async () => {
    vi.mocked(snowApi.snowFetch).mockResolvedValueOnce({ result: [] });

    const { result } = renderHook(() => useChangeModifier());

    await act(async () => {
      await result.current.actions.fetchChangeByKey('CHG9999999');
    });

    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.error).toBe('Change not found: CHG9999999');
    expect(result.current.state.change).toBeNull();
  });

  it('should handle error when fetching change', async () => {
    const fetchError = new Error('SNow relay not connected');
    vi.mocked(snowApi.snowFetch).mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useChangeModifier());

    await act(async () => {
      await result.current.actions.fetchChangeByKey('CHG0001234');
    });

    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.error).toBe('SNow relay not connected');
  });

  it('should validate empty change key', async () => {
    const { result } = renderHook(() => useChangeModifier());

    await act(async () => {
      await result.current.actions.fetchChangeByKey('   ');
    });

    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.error).toBe('Enter a change key (e.g., CHG0123456)');
  });

  it('should update change field and mark as dirty', () => {
    const { result } = renderHook(() => useChangeModifier());

    act(() => {
      result.current.state.change = {
        sysId: 'change-sys-id',
        number: 'CHG0001234',
        shortDescription: 'Original',
        description: 'Original description',
        justification: '',
        riskImpactAnalysis: '',
        chgBasicInfo: {
          category: '',
          changeType: '',
          environment: '',
          requestedBy: { sysId: '', displayName: '' },
          configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' },
          assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' },
          tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' },
          isExpedited: false,
        },
        chgPlanningAssessment: {
          impact: '',
          systemAvailabilityImplication: '',
          hasBeenTested: '',
          impactedPersonsAware: '',
          hasBeenPerformedPreviously: '',
          successProbability: '',
          canBeBackedOut: '',
        },
        chgPlanningContent: {
          implementationPlan: '',
          backoutPlan: '',
          testPlan: '',
        },
      };
    });

    act(() => {
      result.current.actions.updateChangeField('shortDescription', 'Updated');
    });

    expect(result.current.state.change?.shortDescription).toBe('Updated');
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should update nested change field', () => {
    const { result } = renderHook(() => useChangeModifier());

    act(() => {
      result.current.state.change = {
        sysId: 'change-sys-id',
        number: 'CHG0001234',
        shortDescription: '',
        description: '',
        justification: '',
        riskImpactAnalysis: '',
        chgBasicInfo: {
          category: 'hardware',
          changeType: 'emergency',
          environment: 'REL',
          requestedBy: { sysId: '', displayName: '' },
          configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' },
          assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' },
          tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' },
          isExpedited: false,
        },
        chgPlanningAssessment: {
          impact: '',
          systemAvailabilityImplication: '',
          hasBeenTested: '',
          impactedPersonsAware: '',
          hasBeenPerformedPreviously: '',
          successProbability: '',
          canBeBackedOut: '',
        },
        chgPlanningContent: {
          implementationPlan: '',
          backoutPlan: '',
          testPlan: '',
        },
      };
    });

    act(() => {
      result.current.actions.updateChangeField('chgBasicInfo.category', 'software');
    });

    expect(result.current.state.change?.chgBasicInfo.category).toBe('software');
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should add a CTASK', () => {
    const { result } = renderHook(() => useChangeModifier());

    const newCtask = {
      sysId: 'new-ctask-sys-id',
      number: 'CTASK0000002',
      shortDescription: 'New Task',
      description: 'New task description',
      assignmentGroup: { sysId: 'group-id', displayName: 'DevOps' },
      assignedTo: { sysId: 'user-id', displayName: 'John Doe' },
      plannedStartDate: '2024-01-16T10:00',
      plannedEndDate: '2024-01-16T12:00',
      closeNotes: '',
    };

    act(() => {
      result.current.actions.addCtask(newCtask);
    });

    expect(result.current.state.ctasks).toHaveLength(1);
    expect(result.current.state.ctasks[0]).toEqual(newCtask);
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should update a CTASK', () => {
    const { result } = renderHook(() => useChangeModifier());

    const originalCtask = {
      sysId: 'ctask-sys-id',
      number: 'CTASK0000001',
      shortDescription: 'Original Task',
      description: 'Original description',
      assignmentGroup: { sysId: 'group-id', displayName: 'DevOps' },
      assignedTo: { sysId: 'user-id', displayName: 'John Doe' },
      plannedStartDate: '',
      plannedEndDate: '',
      closeNotes: '',
    };

    act(() => {
      result.current.actions.addCtask(originalCtask);
    });

    const updatedCtask = { ...originalCtask, shortDescription: 'Updated Task' };

    act(() => {
      result.current.actions.updateCtask('ctask-sys-id', updatedCtask);
    });

    expect(result.current.state.ctasks[0]?.shortDescription).toBe('Updated Task');
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should remove a CTASK', () => {
    const { result } = renderHook(() => useChangeModifier());

    const ctask = {
      sysId: 'ctask-sys-id',
      number: 'CTASK0000001',
      shortDescription: 'Task to remove',
      description: '',
      assignmentGroup: { sysId: '', displayName: '' },
      assignedTo: { sysId: '', displayName: '' },
      plannedStartDate: '',
      plannedEndDate: '',
      closeNotes: '',
    };

    act(() => {
      result.current.actions.addCtask(ctask);
    });

    expect(result.current.state.ctasks).toHaveLength(1);

    act(() => {
      result.current.actions.removeCtask('ctask-sys-id');
    });

    expect(result.current.state.ctasks).toHaveLength(0);
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should save change successfully', async () => {
    vi.mocked(snowApi.snowFetch).mockResolvedValue(undefined);

    const { result } = renderHook(() => useChangeModifier());

    act(() => {
      result.current.state.change = {
        sysId: 'change-sys-id',
        number: 'CHG0001234',
        shortDescription: 'Updated Summary',
        description: 'Updated Description',
        justification: '',
        riskImpactAnalysis: '',
        chgBasicInfo: {
          category: 'software',
          changeType: 'normal',
          environment: 'PRD',
          requestedBy: { sysId: '', displayName: '' },
          configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' },
          assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' },
          tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' },
          isExpedited: false,
        },
        chgPlanningAssessment: {
          impact: '',
          systemAvailabilityImplication: '',
          hasBeenTested: '',
          impactedPersonsAware: '',
          hasBeenPerformedPreviously: '',
          successProbability: '',
          canBeBackedOut: '',
        },
        chgPlanningContent: {
          implementationPlan: '',
          backoutPlan: '',
          testPlan: '',
        },
      };
    });

    await act(async () => {
      await result.current.actions.saveChange();
    });

    expect(result.current.state.isSaving).toBe(false);
    expect(result.current.state.isSavingSuccess).toBe(true);
    expect(result.current.state.isDirty).toBe(false);
  });

  it('should handle save error', async () => {
    const saveError = new Error('PATCH failed');
    vi.mocked(snowApi.snowFetch).mockRejectedValueOnce(saveError);

    const { result } = renderHook(() => useChangeModifier());

    act(() => {
      result.current.state.change = {
        sysId: 'change-sys-id',
        number: 'CHG0001234',
        shortDescription: '',
        description: '',
        justification: '',
        riskImpactAnalysis: '',
        chgBasicInfo: {
          category: '',
          changeType: '',
          environment: '',
          requestedBy: { sysId: '', displayName: '' },
          configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' },
          assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' },
          tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' },
          isExpedited: false,
        },
        chgPlanningAssessment: {
          impact: '',
          systemAvailabilityImplication: '',
          hasBeenTested: '',
          impactedPersonsAware: '',
          hasBeenPerformedPreviously: '',
          successProbability: '',
          canBeBackedOut: '',
        },
        chgPlanningContent: {
          implementationPlan: '',
          backoutPlan: '',
          testPlan: '',
        },
      };
    });

    await act(async () => {
      await result.current.actions.saveChange();
    });

    expect(result.current.state.isSaving).toBe(false);
    expect(result.current.state.error).toBe('PATCH failed');
  });
});
