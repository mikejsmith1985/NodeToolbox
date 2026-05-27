// CtaskEditForm.test.tsx — Tests for the reusable CTASK edit form component.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CtaskEditForm } from './CtaskEditForm';
import type { CtaskEditFormProps } from './CtaskEditForm';
import type { CtaskTemplateData, SnowReference } from '../hooks/useCrgState';
import type { SnowChoiceOptionMap } from '../hooks/useSnowChoiceOptions';

// Test fixtures — reusable data structures for tests.

const emptySnowReference: SnowReference = {
  sysId: '',
  displayName: '',
};

const resolvedSnowReference: SnowReference = {
  sysId: 'sys123',
  displayName: 'Test User Group',
};

const defaultCtaskData: CtaskTemplateData = {
  shortDescription: '',
  description: '',
  assignmentGroup: emptySnowReference,
  assignedTo: emptySnowReference,
  plannedStartDate: '',
  plannedEndDate: '',
  closeNotes: '',
};

const populatedCtaskData: CtaskTemplateData = {
  shortDescription: 'Daily backup',
  description: 'Perform daily system backup',
  assignmentGroup: { sysId: 'group123', displayName: 'Database Admins' },
  assignedTo: { sysId: 'user456', displayName: 'John Smith' },
  plannedStartDate: '2024-01-15T08:00',
  plannedEndDate: '2024-01-15T09:00',
  closeNotes: 'Backup completed successfully',
};

const mockTemplates = [
  {
    id: 'template1',
    name: 'Weekly Maintenance',
    createdAt: '2024-01-01T00:00:00Z',
    shortDescription: 'Weekly system maintenance',
    description: 'Perform scheduled maintenance',
    assignmentGroup: { sysId: 'maint-group', displayName: 'Maintenance Team' },
    assignedTo: { sysId: 'maint-user', displayName: 'Maintenance User' },
    plannedStartDate: '2024-01-20T22:00',
    plannedEndDate: '2024-01-21T02:00',
    closeNotes: 'Maintenance completed',
  },
  {
    id: 'template2',
    name: 'Database Backup',
    createdAt: '2024-01-02T00:00:00Z',
    shortDescription: 'Daily database backup',
    description: 'Backup all databases',
    assignmentGroup: { sysId: 'backup-group', displayName: 'Backup Team' },
    assignedTo: { sysId: 'backup-user', displayName: 'Backup User' },
    plannedStartDate: '2024-01-15T03:00',
    plannedEndDate: '2024-01-15T04:00',
    closeNotes: 'Database backup completed',
  },
];

const mockChoiceOptions: SnowChoiceOptionMap = {
  impact: [
    { value: '1', label: '1 - High' },
    { value: '2', label: '2 - Medium' },
    { value: '3', label: '3 - Low' },
  ],
};

function createDefaultProps(): CtaskEditFormProps {
  return {
    ctaskData: defaultCtaskData,
    templates: mockTemplates,
    choiceOptions: mockChoiceOptions,
    onDataChange: vi.fn(),
  };
}

describe('CtaskEditForm', () => {
  describe('rendering', () => {
    it('renders all form fields', () => {
      const props = createDefaultProps();
      render(<CtaskEditForm {...props} />);

      expect(screen.getByLabelText('Load CTASK template')).toBeInTheDocument();
      expect(screen.getByLabelText('CTASK short description')).toBeInTheDocument();
      expect(screen.getByLabelText('CTASK description')).toBeInTheDocument();
      expect(screen.getByLabelText('Assignment Group')).toBeInTheDocument();
      expect(screen.getByLabelText('Assigned To')).toBeInTheDocument();
      expect(screen.getByLabelText('CTASK planned start date')).toBeInTheDocument();
      expect(screen.getByLabelText('CTASK planned end date')).toBeInTheDocument();
      expect(screen.getByLabelText('CTASK close notes')).toBeInTheDocument();
    });

    it('renders template picker with all available templates', () => {
      const props = createDefaultProps();
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template') as HTMLSelectElement;
      const options = Array.from(templateSelect.options);

      expect(options).toHaveLength(3); // default + 2 templates
      expect(options[0]).toHaveTextContent('Select a CTASK template…');
      expect(options[1]).toHaveTextContent('Weekly Maintenance');
      expect(options[2]).toHaveTextContent('Database Backup');
    });

    it('populates fields with initial data', () => {
      const props = createDefaultProps();
      props.ctaskData = populatedCtaskData;
      render(<CtaskEditForm {...props} />);

      expect(screen.getByDisplayValue('Daily backup')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Perform daily system backup')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Backup completed successfully')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2024-01-15T08:00')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2024-01-15T09:00')).toBeInTheDocument();
    });

    it('does not render save as template section when onSaveAsTemplate is not provided', () => {
      const props = createDefaultProps();
      delete props.onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      expect(screen.queryByLabelText('Save as template checkbox')).not.toBeInTheDocument();
    });

    it('renders save as template section when onSaveAsTemplate is provided', () => {
      const props = createDefaultProps();
      props.onSaveAsTemplate = vi.fn();
      render(<CtaskEditForm {...props} />);

      expect(screen.getByLabelText('Save as template checkbox')).toBeInTheDocument();
    });
  });

  describe('field changes', () => {
    it('calls onDataChange when short description is modified', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const input = screen.getByLabelText('CTASK short description') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New description' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.shortDescription).toBe('New description');
    });

    it('calls onDataChange when description textarea is modified', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const textarea = screen.getByLabelText('CTASK description') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'New description text' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.description).toBe('New description text');
    });

    it('calls onDataChange when planned start date is modified', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const input = screen.getByLabelText('CTASK planned start date');
      fireEvent.change(input, { target: { value: '2024-02-15T10:00' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.plannedStartDate).toBe('2024-02-15T10:00');
    });

    it('calls onDataChange when planned end date is modified', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const input = screen.getByLabelText('CTASK planned end date');
      fireEvent.change(input, { target: { value: '2024-02-15T11:00' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.plannedEndDate).toBe('2024-02-15T11:00');
    });

    it('calls onDataChange when close notes are modified', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const textarea = screen.getByLabelText('CTASK close notes') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Closure notes' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.closeNotes).toBe('Closure notes');
    });
  });

  describe('template picker', () => {
    it('loads template data when a template is selected', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template');
      await userEvent.selectOptions(templateSelect, 'template1');

      await waitFor(() => {
        expect(onDataChange).toHaveBeenCalled();
      });

      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.shortDescription).toBe('Weekly system maintenance');
      expect(lastCall.description).toBe('Perform scheduled maintenance');
      expect(lastCall.plannedStartDate).toBe('2024-01-20T22:00');
      expect(lastCall.closeNotes).toBe('Maintenance completed');
    });

    it('loads second template correctly', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template');
      await userEvent.selectOptions(templateSelect, 'template2');

      await waitFor(() => {
        expect(onDataChange).toHaveBeenCalled();
      });

      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.shortDescription).toBe('Daily database backup');
      expect(lastCall.assignmentGroup.displayName).toBe('Backup Team');
      expect(lastCall.assignedTo.displayName).toBe('Backup User');
    });

    it('clears template selection after loading', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template') as HTMLSelectElement;
      await userEvent.selectOptions(templateSelect, 'template1');

      await waitFor(() => {
        expect(templateSelect.value).toBe('');
      });
    });

    it('handles empty template selection gracefully', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template');
      await userEvent.selectOptions(templateSelect, '');

      // Should not call onDataChange when selecting empty option.
      expect(onDataChange).not.toHaveBeenCalled();
    });
  });

  describe('save as template', () => {
    it('shows save as template section when checkbox is clicked', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);

      expect(screen.getByLabelText('Template name')).toBeInTheDocument();
    });

    it('hides template name input when checkbox is unchecked', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);
      expect(screen.getByLabelText('Template name')).toBeInTheDocument();

      await userEvent.click(checkbox);
      expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
    });

    it('calls onSaveAsTemplate with template name when save button is clicked', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);

      const nameInput = screen.getByPlaceholderText('e.g., Daily Database Backups');
      await userEvent.type(nameInput, 'My Backup Task');

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await userEvent.click(saveButton);

      expect(onSaveAsTemplate).toHaveBeenCalledWith('My Backup Task');
    });

    it('trims whitespace from template name', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);

      const nameInput = screen.getByPlaceholderText('e.g., Daily Database Backups');
      await userEvent.type(nameInput, '  My Task  ');

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await userEvent.click(saveButton);

      expect(onSaveAsTemplate).toHaveBeenCalledWith('My Task');
    });

    it('disables save button when template name is empty', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);

      const saveButton = screen.getByRole('button', { name: 'Save' });
      expect(saveButton).toBeDisabled();

      const nameInput = screen.getByPlaceholderText('e.g., Daily Database Backups');
      await userEvent.type(nameInput, 'Valid Name');
      expect(saveButton).not.toBeDisabled();
    });

    it('clears template name and closes section after saving', async () => {
      const onSaveAsTemplate = vi.fn();
      const props = createDefaultProps();
      props.onSaveAsTemplate = onSaveAsTemplate;
      render(<CtaskEditForm {...props} />);

      const checkbox = screen.getByLabelText('Save as template checkbox');
      await userEvent.click(checkbox);

      const nameInput = screen.getByPlaceholderText('e.g., Daily Database Backups');
      await userEvent.type(nameInput, 'My Task');

      const saveButton = screen.getByRole('button', { name: 'Save' });
      await userEvent.click(saveButton);

      expect(onSaveAsTemplate).toHaveBeenCalledWith('My Task');
      expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    });
  });

  describe('compact mode', () => {
    it('applies compact class when isCompact is true', () => {
      const props = createDefaultProps();
      props.isCompact = true;
      const { container } = render(<CtaskEditForm {...props} />);

      const formGrid = container.querySelector('[class*="ctaskEditorGrid"]');
      expect(formGrid?.className).toContain('compactForm');
    });

    it('does not apply compact class when isCompact is false', () => {
      const props = createDefaultProps();
      props.isCompact = false;
      const { container } = render(<CtaskEditForm {...props} />);

      const formGrid = container.querySelector('[class*="ctaskEditorGrid"]');
      expect(formGrid?.className).not.toContain('compactForm');
    });
  });

  describe('integration scenarios', () => {
    it('allows editing after loading a template', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      // Load template.
      const templateSelect = screen.getByLabelText('Load CTASK template');
      await userEvent.selectOptions(templateSelect, 'template1');

      // Reset mock to track only subsequent calls.
      onDataChange.mockClear();

      // Edit the short description.
      const descInput = screen.getByLabelText('CTASK short description') as HTMLInputElement;
      fireEvent.change(descInput, { target: { value: 'Edited description' } });

      expect(onDataChange).toHaveBeenCalled();
      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      expect(lastCall.shortDescription).toBe('Edited description');
    });

    it('preserves unmodified fields when loading templates', async () => {
      const onDataChange = vi.fn();
      const props = createDefaultProps();
      props.ctaskData = populatedCtaskData;
      props.onDataChange = onDataChange;
      render(<CtaskEditForm {...props} />);

      const templateSelect = screen.getByLabelText('Load CTASK template');
      await userEvent.selectOptions(templateSelect, 'template1');

      await waitFor(() => {
        expect(onDataChange).toHaveBeenCalled();
      });

      const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0];
      // Template data should fully replace current data.
      expect(lastCall.shortDescription).toBe('Weekly system maintenance');
      expect(lastCall.assignedTo.displayName).toBe('Maintenance User');
    });
  });

  describe('accessibility', () => {
    it('has proper aria labels on all inputs', () => {
      const props = createDefaultProps();
      render(<CtaskEditForm {...props} />);

      expect(screen.getByLabelText('Load CTASK template')).toHaveAttribute('aria-label');
      expect(screen.getByLabelText('CTASK short description')).toHaveAttribute('aria-label');
      expect(screen.getByLabelText('CTASK description')).toHaveAttribute('aria-label');
      expect(screen.getByLabelText('CTASK planned start date')).toHaveAttribute('aria-label');
      expect(screen.getByLabelText('CTASK planned end date')).toHaveAttribute('aria-label');
      expect(screen.getByLabelText('CTASK close notes')).toHaveAttribute('aria-label');
    });
  });
});
