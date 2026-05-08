// EnterpriseStandardsPanel.tsx — Enterprise hygiene rules panel for Admin Hub.
//
// Shows a list of rules (name + description + enabled toggle). Built-in rules can be
// disabled but not deleted; custom rules can be fully edited or removed.
// Rule list persists to localStorage under the key tbxEnterpriseStandards.

import { useState } from 'react';

import ConfirmDialog from '../../components/ConfirmDialog/index.tsx';
import styles from './AdminHubView.module.css';

// ── Types ──

/** A single enterprise standards hygiene rule. */
export interface EnterpriseRule {
  id: string;
  name: string;
  description: string;
  /** Built-in rules ship with the app and cannot be deleted, only disabled. */
  isBuiltIn: boolean;
  isEnabled: boolean;
}

/** Form state for the Add Custom Rule inline form. */
interface AddRuleFormValues {
  name: string;
  description: string;
}

// ── Constants ──

const ENTERPRISE_STANDARDS_STORAGE_KEY = 'tbxEnterpriseStandards';

const EMPTY_ADD_FORM: AddRuleFormValues = { name: '', description: '' };

const SAVE_STATUS_SAVED = '✓ Saved';
const SAVE_STATUS_RESET = '✓ Reset to defaults';
const SAVE_STATUS_CLEAR_MS = 2000;

/** Factory default rules bundled with NodeToolbox. */
export const DEFAULT_ENTERPRISE_RULES: EnterpriseRule[] = [
  {
    id: 'rule-missing-assignee',
    name: 'Missing Assignee',
    description: 'Every in-progress ticket must have an assignee.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-unpointed-story',
    name: 'Unpointed Story',
    description: 'Stories in active sprints must have story points set.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-stale-ticket',
    name: 'Stale Ticket',
    description: 'Tickets in-progress with no updates for 5+ days.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-missing-epic',
    name: 'Missing Epic Link',
    description: 'Stories must be linked to an epic.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-blocker-no-comment',
    name: 'Blocker Without Comment',
    description: 'Blocked tickets must have a blocker comment explaining the impediment.',
    isBuiltIn: true,
    isEnabled: true,
  },
];

// ── Helpers ──

/** Reads the rule list from localStorage, falling back to the default rules. */
function loadRulesFromStorage(): EnterpriseRule[] {
  try {
    const rawValue = localStorage.getItem(ENTERPRISE_STANDARDS_STORAGE_KEY);
    if (rawValue === null) return DEFAULT_ENTERPRISE_RULES;
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsedValue) && parsedValue.length > 0) {
      return parsedValue as EnterpriseRule[];
    }
    return DEFAULT_ENTERPRISE_RULES;
  } catch {
    return DEFAULT_ENTERPRISE_RULES;
  }
}

/** Writes the rule list to localStorage. */
function saveRulesToStorage(rules: EnterpriseRule[]): void {
  try {
    localStorage.setItem(ENTERPRISE_STANDARDS_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Non-fatal: in-memory state remains authoritative.
  }
}

// ── Sub-components ──

interface RuleRowProps {
  rule: EnterpriseRule;
  onToggle(ruleId: string): void;
  onDelete(ruleId: string): void;
}

/** Renders a single rule row in the rules table. */
function RuleRow({ rule, onToggle, onDelete }: RuleRowProps) {
  return (
    <div className={styles.ruleRow}>
      <span className={styles.ruleName}>
        {rule.isBuiltIn && <span className={styles.builtInBadge}>🔒</span>}
        {rule.name}
      </span>
      <span className={styles.ruleDescription}>{rule.description}</span>
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
  const [rules, setRules] = useState<EnterpriseRule[]>(loadRulesFromStorage);
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
      saveRulesToStorage(nextRules);
      return nextRules;
    });
  }

  function handleDeleteRule(ruleId: string) {
    setRules((currentRules) => {
      const nextRules = currentRules.filter((rule) => rule.id !== ruleId);
      saveRulesToStorage(nextRules);
      return nextRules;
    });
  }

  function handleSaveChanges() {
    saveRulesToStorage(rules);
    showSaveStatus(SAVE_STATUS_SAVED);
  }

  function handleChangeAddField(field: keyof AddRuleFormValues, value: string) {
    setAddFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function handleSubmitCustomRule() {
    const trimmedName = addFormValues.name.trim();
    if (trimmedName === '') return;

    const newRule: EnterpriseRule = {
      id: `custom-${Date.now()}`,
      name: trimmedName,
      description: addFormValues.description.trim(),
      isBuiltIn: false,
      isEnabled: true,
    };

    setRules((currentRules) => {
      const nextRules = [...currentRules, newRule];
      saveRulesToStorage(nextRules);
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
    saveRulesToStorage(DEFAULT_ENTERPRISE_RULES);
    showSaveStatus(SAVE_STATUS_RESET);
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔒 Enterprise Standards Rules</h2>
      <p className={styles.adminDescription}>
        Hygiene rules applied to all teams. Built-in rules (🔒) can be disabled but not deleted.
        Custom rules can be removed. Changes auto-save on toggle; use Save Changes to persist edits.
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
