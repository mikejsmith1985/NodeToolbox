// ChangeModifierTab.test.tsx — Unit tests for the Change Modifier tab component.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChangeModifierTab } from './ChangeModifierTab.tsx';
import * as useChangeModifierModule from '../hooks/useChangeModifier.ts';

// Mock the useChangeModifier hook
vi.mock('../hooks/useChangeModifier.ts');

describe('ChangeModifierTab', () => {
  const mockActions = {
    fetchChangeByKey: vi.fn(),
    updateChangeField: vi.fn(),
    addCtask: vi.fn(),
    updateCtask: vi.fn(),
    removeCtask: vi.fn(),
    saveChange: vi.fn(),
  };

  const mockDefaultState = {
    changeKey: '',
    isLoading: false,
    error: null,
    isSaving: false,
    isSavingSuccess: false,
    change: null,
    ctasks: [],
    isDirty: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: mockDefaultState,
      actions: mockActions,
    });
  });

  it('should render the tab with header', () => {
    render(<ChangeModifierTab />);

    expect(screen.getByText('Modify Change')).toBeInTheDocument();
    expect(screen.getByText(/Fetch an existing ServiceNow CHG/)).toBeInTheDocument();
  });

  it('should render the lookup section with input and button', () => {
    render(<ChangeModifierTab />);

    const input = screen.getByPlaceholderText('e.g., CHG0123456');
    const button = screen.getByRole('button', { name: 'Fetch' });

    expect(input).toBeInTheDocument();
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it('should enable fetch button when change key is entered', () => {
    render(<ChangeModifierTab />);

    const input = screen.getByPlaceholderText('e.g., CHG0123456') as HTMLInputElement;
    const button = screen.getByRole('button', { name: 'Fetch' });

    fireEvent.change(input, { target: { value: 'CHG0001234' } });

    expect(input.value).toBe('CHG0001234');
    expect(button).not.toBeDisabled();
  });

  it('should call fetchChangeByKey when fetch button clicked', async () => {
    render(<ChangeModifierTab />);

    const input = screen.getByPlaceholderText('e.g., CHG0123456');
    const button = screen.getByRole('button', { name: 'Fetch' });

    fireEvent.change(input, { target: { value: 'CHG0001234' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockActions.fetchChangeByKey).toHaveBeenCalledWith('CHG0001234');
    });
  });

  it('should display loading state while fetching', () => {
    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, isLoading: true },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    const button = screen.getByRole('button', { name: 'Fetching...' });
    expect(button).toBeDisabled();
  });

  it('should display error message when fetch fails', () => {
    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, error: 'Change not found: CHG9999999' },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    expect(screen.getByText('Change not found: CHG9999999')).toBeInTheDocument();
  });

  it('should display success message after save', () => {
    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, isSavingSuccess: true },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    expect(screen.getByText('✓ Changes saved successfully')).toBeInTheDocument();
  });

  it('should render change details form when change is loaded', () => {
    const mockChange = {
      sysId: 'change-sys-id',
      number: 'CHG0001234',
      shortDescription: 'Test Change',
      description: 'Test Description',
      justification: 'Test Justification',
      riskImpactAnalysis: 'Test Risk',
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
        impact: '3',
        systemAvailabilityImplication: 'none',
        hasBeenTested: 'yes',
        impactedPersonsAware: 'yes',
        hasBeenPerformedPreviously: 'no',
        successProbability: 'high',
        canBeBackedOut: 'yes',
      },
      chgPlanningContent: {
        implementationPlan: 'Deploy via CI/CD',
        backoutPlan: 'Revert to previous version',
        testPlan: 'Run integration tests',
      },
    };

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    expect(screen.getByText('Change Details')).toBeInTheDocument();
    expect(screen.getByText('CHG0001234')).toBeInTheDocument();
    expect(screen.getByText('Summary & Description')).toBeInTheDocument();
  });

  it('should update change field when input changes', () => {
    const mockChange = {
      sysId: 'change-sys-id',
      number: 'CHG0001234',
      shortDescription: 'Original',
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

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    const shortDescInput = screen.getByDisplayValue('Original') as HTMLInputElement;
    fireEvent.change(shortDescInput, { target: { value: 'Updated' } });

    expect(mockActions.updateChangeField).toHaveBeenCalledWith('shortDescription', 'Updated');
  });

  it('should display CTASKs when change has CTASKs', () => {
    const mockChange = {
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

    const mockCtasks = [
      {
        sysId: 'ctask-sys-id',
        number: 'CTASK0000001',
        shortDescription: 'Deployment',
        description: 'Deploy to production',
        assignmentGroup: { sysId: 'group-id', displayName: 'DevOps' },
        assignedTo: { sysId: 'user-id', displayName: 'John Doe' },
        plannedStartDate: '2024-01-15T10:00',
        plannedEndDate: '2024-01-15T12:00',
        closeNotes: '',
      },
    ];

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange, ctasks: mockCtasks },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    expect(screen.getByText('Change Tasks (CTASKs)')).toBeInTheDocument();
    expect(screen.getByText('CTASK0000001')).toBeInTheDocument();
    expect(screen.getByText('Deployment')).toBeInTheDocument();
  });

  it('should remove CTASK when remove button clicked', () => {
    const mockChange = {
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

    const mockCtasks = [
      {
        sysId: 'ctask-sys-id',
        number: 'CTASK0000001',
        shortDescription: 'Deployment',
        description: '',
        assignmentGroup: { sysId: '', displayName: '' },
        assignedTo: { sysId: '', displayName: '' },
        plannedStartDate: '',
        plannedEndDate: '',
        closeNotes: '',
      },
    ];

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange, ctasks: mockCtasks },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    const removeButton = screen.getByRole('button', { name: '✕' });
    fireEvent.click(removeButton);

    expect(mockActions.removeCtask).toHaveBeenCalledWith('ctask-sys-id');
  });

  it('should save changes when save button clicked', async () => {
    const mockChange = {
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

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange, isDirty: true },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockActions.saveChange).toHaveBeenCalled();
    });
  });

  it('should disable save button when no changes', () => {
    const mockChange = {
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

    vi.mocked(useChangeModifierModule.useChangeModifier).mockReturnValue({
      state: { ...mockDefaultState, change: mockChange, isDirty: false },
      actions: mockActions,
    });

    render(<ChangeModifierTab />);

    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('should show empty state when no change loaded', () => {
    render(<ChangeModifierTab />);

    expect(screen.getByText(/Enter a change key above to fetch/)).toBeInTheDocument();
  });
});
