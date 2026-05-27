// EnterpriseStandardsPanel.tsx — Enterprise hygiene rules panel for Admin Hub.
//
// Shows a list of rules (name + description + enabled toggle). Built-in rules can be
// disabled but not deleted; custom rules can be fully edited or removed.
// Rule list persists to localStorage and custom rules can enforce required Jira fields.

import { useState } from 'react';

import ConfirmDialog from '../../components/ConfirmDialog/index.tsx';
import {
  CUSTOM_RULE_TYPE_REQUIRED_FIELD,
  DEFAULT_ENTERPRISE_RULES,
  loadEnterpriseRulesFromStorage,
  saveEnterpriseRulesToStorage,
  type EnterpriseRequiredFieldRule,
  type EnterpriseRule,
  type EnterpriseRuleType,
} from './enterpriseRules.ts';
import styles from './AdminHubView.module.css';

// ── Types ──

/** Form state for the Add Custom Rule inline form. */
interface AddRuleFormValues {
  name: string;
  description: string;
  ruleType: EnterpriseRuleType;
  fieldId: string;
  fieldLabel: string;
  issueTypeNamesText: string;
  severity: 'warn' | 'error';
}

// ── Constants ──

const EMPTY_ADD_FORM: AddRuleFormValues = {
  name: '',
  description: '',
  ruleType: CUSTOM_RULE_TYPE_REQUIRED_FIELD,
  fieldId: '',
  fieldLabel: '',
  issueTypeNamesText: '',
  severity: 'warn',
};

const SAVE_STATUS_SAVED = '✓ Saved';
const SAVE_STATUS_RESET = '✓ Reset to defaults';
const SAVE_STATUS_CLEAR_MS = 2000;

// ── Sub-components ──

interface RuleRowProps {
  rule: EnterpriseRule;
  onToggle(ruleId: string): void;
  onDelete(ruleId: string): void;
}

/** Renders a single rule row in the rules table. */
function RuleRow({ rule, onToggle, onDelete }: RuleRowProps) {
  const enforcementSummary = rule.ruleType === CUSTOM_RULE_TYPE_REQUIRED_FIELD
    ? readRequiredFieldRuleSummary(rule)
    : null;
  return (
    <div className={styles.ruleRow}>
      <span className={styles.ruleName}>
        {rule.isBuiltIn && <span className={styles.builtInBadge}>🔒</span>}
        {rule.name}
      </span>
      <span className={styles.ruleDescription}>
        {rule.description}
        {enforcementSummary ? ` ${enforcementSummary}` : ''}
      </span>
      <div className={styles.ruleToggleCell}>
        <input
          type="checkbox"
          id={`rule-toggle-${rule.id}`}
          checked={rule.isEnabled}
          onChange={() => onToggle(rule.id)}
          aria-label={`Toggle ${rule.name}`}
        />
      </div>
      <div className={styles.ruleActionsCell}>
        {!rule.isBuiltIn && (
          <button
            className={styles.actionButton}
            onClick={() => onDelete(rule.id)}
            aria-label={`Delete ${rule.name}`}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

interface AddRuleFormProps {
  formValues: AddRuleFormValues;
  onChangeField(field: keyof AddRuleFormValues, value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

/** Inline form for adding a new custom rule. */
function AddRuleForm({ formValues, onChangeField, onSubmit, onCancel }: AddRuleFormProps) {
  const isFieldRule = formValues.ruleType === CUSTOM_RULE_TYPE_REQUIRED_FIELD;
  return (
    <div className={styles.addRuleForm}>
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="new-rule-name">
          Rule Name
        </label>
        <input
          id="new-rule-name"
          type="text"
          className={styles.textInput}
          value={formValues.name}
          onChange={(changeEvent) => onChangeField('name', changeEvent.target.value)}
          placeholder="Rule name"
          aria-label="Rule name"
        />
      </div>
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="new-rule-type">
          Rule Type
        </label>
        <select
          id="new-rule-type"
          className={styles.textInput}
          value={formValues.ruleType}
          onChange={(changeEvent) => onChangeField('ruleType', changeEvent.target.value as EnterpriseRuleType)}
          aria-label="Rule type"
        >
          <option value={CUSTOM_RULE_TYPE_REQUIRED_FIELD}>Required Jira field</option>
        </select>
      </div>
      {isFieldRule && (
        <>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="new-rule-field-id">
              Jira Field ID
            </label>
            <input
              id="new-rule-field-id"
              type="text"
              className={styles.textInput}
              value={formValues.fieldId}
              onChange={(changeEvent) => onChangeField('fieldId', changeEvent.target.value)}
              placeholder="customfield_12345 or duedate"
              aria-label="Jira field ID"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="new-rule-field-label">
              Field Label
            </label>
            <input
              id="new-rule-field-label"
              type="text"
              className={styles.textInput}
              value={formValues.fieldLabel}
              onChange={(changeEvent) => onChangeField('fieldLabel', changeEvent.target.value)}
              placeholder="Due Date"
              aria-label="Field label"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="new-rule-issue-types">
              Applies To Issue Types
            </label>
            <input
              id="new-rule-issue-types"
              type="text"
              className={styles.textInput}
              value={formValues.issueTypeNamesText}
              onChange={(changeEvent) => onChangeField('issueTypeNamesText', changeEvent.target.value)}
              placeholder="Feature, Story"
              aria-label="Applies to issue types"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="new-rule-severity">
              Severity
            </label>
            <select
              id="new-rule-severity"
              className={styles.textInput}
              value={formValues.severity}
              onChange={(changeEvent) => onChangeField('severity', changeEvent.target.value as 'warn' | 'error')}
              aria-label="Severity"
            >
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
        </>
      )}
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="new-rule-description">
          Description
        </label>
        <input
          id="new-rule-description"
          type="text"
          className={styles.textInput}
          value={formValues.description}
          onChange={(changeEvent) => onChangeField('description', changeEvent.target.value)}
          placeholder="What this rule checks"
          aria-label="Description"
        />
      </div>
      <div className={styles.inputRow}>
        <button
          className={`${styles.actionButton} ${styles.saveButton}`}
          onClick={onSubmit}
        >
          Add Rule
        </button>
        <button className={styles.actionButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ──

/** Enterprise Standards Rules panel — manage and persist the org-wide hygiene rule list. */
export default function EnterpriseStandardsPanel() {
  const [rules, setRules] = useState<EnterpriseRule[]>(loadEnterpriseRulesFromStorage);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [addFormValues, setAddFormValues] = useState<AddRuleFormValues>(EMPTY_ADD_FORM);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  function showSaveStatus(message: string) {
    setSaveStatus(message);
    setTimeout(() => setSaveStatus(null), SAVE_STATUS_CLEAR_MS);
  }

  function handleToggleRule(ruleId: string) {
    setRules((currentRules) => {
      const nextRules = currentRules.map((rule) =>
        rule.id === ruleId ? { ...rule, isEnabled: !rule.isEnabled } : rule,
      );
      saveEnterpriseRulesToStorage(nextRules);
      return nextRules;
    });
  }

  function handleDeleteRule(ruleId: string) {
    setRules((currentRules) => {
      const nextRules = currentRules.filter((rule) => rule.id !== ruleId);
      saveEnterpriseRulesToStorage(nextRules);
      return nextRules;
    });
  }

  function handleSaveChanges() {
    saveEnterpriseRulesToStorage(rules);
    showSaveStatus(SAVE_STATUS_SAVED);
  }

  function handleChangeAddField(field: keyof AddRuleFormValues, value: string) {
    setAddFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function handleSubmitCustomRule() {
    const trimmedName = addFormValues.name.trim();
    const trimmedFieldId = addFormValues.fieldId.trim();
    if (trimmedName === '' || trimmedFieldId === '') return;

    const newRule: EnterpriseRequiredFieldRule = {
      id: `custom-${Date.now()}`,
      name: trimmedName,
      description: addFormValues.description.trim(),
      isBuiltIn: false,
      isEnabled: true,
      severity: addFormValues.severity,
      ruleType: CUSTOM_RULE_TYPE_REQUIRED_FIELD,
      fieldId: trimmedFieldId,
      fieldLabel: addFormValues.fieldLabel.trim(),
      issueTypeNames: readIssueTypeNames(addFormValues.issueTypeNamesText),
    };

    setRules((currentRules) => {
      const nextRules = [...currentRules, newRule];
      saveEnterpriseRulesToStorage(nextRules);
      return nextRules;
    });
    setAddFormValues(EMPTY_ADD_FORM);
    setIsAddFormOpen(false);
  }

  function handleCancelAddForm() {
    setIsAddFormOpen(false);
    setAddFormValues(EMPTY_ADD_FORM);
  }

  function handleConfirmResetToDefaults() {
    setIsResetDialogOpen(false);
    setRules(DEFAULT_ENTERPRISE_RULES);
    saveEnterpriseRulesToStorage(DEFAULT_ENTERPRISE_RULES);
    showSaveStatus(SAVE_STATUS_RESET);
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔒 Enterprise Standards Rules</h2>
      <p className={styles.adminDescription}>
        Hygiene rules applied to all teams. Built-in rules (🔒) can be disabled but not deleted.
        Custom rules can require a Jira field for selected issue types. Changes auto-save on toggle;
        use Save Changes to persist edits.
      </p>

      <div className={styles.rulesTable}>
        <div className={styles.rulesTableHeader}>
          <span>Rule Name</span>
          <span>Description</span>
          <span>Enabled</span>
          <span />
        </div>
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onToggle={handleToggleRule}
            onDelete={handleDeleteRule}
          />
        ))}
      </div>

      {isAddFormOpen && (
        <AddRuleForm
          formValues={addFormValues}
          onChangeField={handleChangeAddField}
          onSubmit={handleSubmitCustomRule}
          onCancel={handleCancelAddForm}
        />
      )}

      <div className={styles.inputRow}>
        <button
          className={`${styles.actionButton} ${styles.saveButton}`}
          onClick={handleSaveChanges}
        >
          💾 Save Changes
        </button>
        <button
          className={styles.actionButton}
          onClick={() => setIsAddFormOpen(true)}
          disabled={isAddFormOpen}
        >
          ➕ Add Custom Rule
        </button>
        <button
          className={`${styles.actionButton} ${styles.dangerButton}`}
          onClick={() => setIsResetDialogOpen(true)}
        >
          ↺ Reset to Defaults
        </button>
        {saveStatus !== null && <span className={styles.saveStatus}>{saveStatus}</span>}
      </div>

      {isResetDialogOpen && (
        <ConfirmDialog
          confirmLabel="Reset to Defaults"
          isDangerous
          message="Reset all enterprise standards rules to factory defaults? Custom rules will be removed."
          onCancel={() => setIsResetDialogOpen(false)}
          onConfirm={handleConfirmResetToDefaults}
        />
      )}
    </section>
  );
}

function readIssueTypeNames(issueTypeNamesText: string): string[] {
  return issueTypeNamesText
    .split(',')
    .map((issueTypeName) => issueTypeName.trim())
    .filter(Boolean);
}

function readRequiredFieldRuleSummary(rule: EnterpriseRequiredFieldRule): string {
  const displayFieldLabel = rule.fieldLabel.trim() || rule.fieldId;
  const issueTypeSummary = rule.issueTypeNames.length > 0
    ? `for ${rule.issueTypeNames.join(', ')}`
    : 'for every issue type';
  return `Validates that ${displayFieldLabel} is populated ${issueTypeSummary}.`;
}
