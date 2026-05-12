// StatusMappingEditor.tsx — Settings UI for configuring Jira → SNow status equivalences.
//
// Allows users to define which Jira status name maps to which SNow state label for
// the My Issues health-check feature. Mappings are persisted in localStorage via
// settingsStore so they survive app restarts and updates.
//
// The system-defined "To Do → New" mapping is always displayed at the top as a
// locked, read-only row that cannot be removed.

import React, { useState } from 'react';

import styles from './StatusMappingEditor.module.css';
import { useSettingsStore } from '../../store/settingsStore.ts';
import type { StatusMapping } from '../../types/issueLinking.ts';

// ── Constants ──

/** The system-defined mapping that is always active and cannot be removed. */
const SYSTEM_MAPPING: StatusMapping = {
  jiraStatus: 'To Do',
  snowStatus: 'New',
  isSystemDefined: true,
};

const EMPTY_STRING = '';

// ── Component ──

/**
 * Editor panel for the Jira→SNow status mapping configuration.
 *
 * Renders a table of current mappings with inline delete buttons, plus
 * a form row at the bottom for adding new mappings. Changes are written
 * to localStorage immediately — no explicit "Save" action is required.
 */
export function StatusMappingEditor(): React.ReactElement {
  const { statusMappings, setStatusMappings } = useSettingsStore();
  const [pendingJiraStatus, setPendingJiraStatus] = useState(EMPTY_STRING);
  const [pendingSnowStatus, setPendingSnowStatus] = useState(EMPTY_STRING);

  /** The mappings currently in the store (user-defined only — system mapping is always shown separately). */
  const userDefinedMappings = statusMappings.filter((mapping) => !mapping.isSystemDefined);

  function handleAddMapping(): void {
    const trimmedJiraStatus = pendingJiraStatus.trim();
    const trimmedSnowStatus = pendingSnowStatus.trim();

    if (!trimmedJiraStatus || !trimmedSnowStatus) {
      return;
    }

    // Guard against adding a duplicate Jira status key.
    const isDuplicate = statusMappings.some(
      (existingMapping) => existingMapping.jiraStatus.toLowerCase() === trimmedJiraStatus.toLowerCase(),
    );
    if (isDuplicate) {
      return;
    }

    const newMapping: StatusMapping = {
      jiraStatus: trimmedJiraStatus,
      snowStatus: trimmedSnowStatus,
      isSystemDefined: false,
    };

    // Persist the full list (system mapping + user mappings + new entry).
    setStatusMappings([SYSTEM_MAPPING, ...userDefinedMappings, newMapping]);
    setPendingJiraStatus(EMPTY_STRING);
    setPendingSnowStatus(EMPTY_STRING);
  }

  function handleRemoveMapping(jiraStatusToRemove: string): void {
    const updatedMappings = userDefinedMappings.filter(
      (mapping) => mapping.jiraStatus !== jiraStatusToRemove,
    );
    setStatusMappings([SYSTEM_MAPPING, ...updatedMappings]);
  }

  function handlePendingJiraStatusChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setPendingJiraStatus(event.target.value);
  }

  function handlePendingSnowStatusChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setPendingSnowStatus(event.target.value);
  }

  function handleAddKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      handleAddMapping();
    }
  }

  const isAddButtonDisabled = !pendingJiraStatus.trim() || !pendingSnowStatus.trim();

  return (
    <div className={styles.editorWrapper}>
      <p className={styles.sectionTitle}>Jira → ServiceNow Status Mapping</p>
      <p className={styles.sectionSubtitle}>
        Define which Jira status maps to which SNow state for the health-check badge.
        Mappings are saved automatically and persist across app updates.
      </p>

      <div className={styles.mappingTable} role="list" aria-label="Status mappings">

        {/* System-defined row — always shown, cannot be removed */}
        <div className={`${styles.mappingRow} ${styles.mappingRowSystem}`} role="listitem">
          <input
            className={`${styles.mappingInput} ${styles.mappingInputDisabled}`}
            value={SYSTEM_MAPPING.jiraStatus}
            readOnly
            disabled
            aria-label="System Jira status (read-only)"
          />
          <span className={styles.mappingArrow}>→</span>
          <input
            className={`${styles.mappingInput} ${styles.mappingInputDisabled}`}
            value={SYSTEM_MAPPING.snowStatus}
            readOnly
            disabled
            aria-label="System SNow state (read-only)"
          />
          <span className={styles.systemLabel}>System</span>
        </div>

        {/* User-defined mapping rows */}
        {userDefinedMappings.map((mapping) => (
          <div
            key={mapping.jiraStatus}
            className={styles.mappingRow}
            role="listitem"
            aria-label={`Mapping: ${mapping.jiraStatus} → ${mapping.snowStatus}`}
          >
            <input
              className={styles.mappingInput}
              value={mapping.jiraStatus}
              readOnly
              aria-label={`Jira status: ${mapping.jiraStatus}`}
            />
            <span className={styles.mappingArrow}>→</span>
            <input
              className={styles.mappingInput}
              value={mapping.snowStatus}
              readOnly
              aria-label={`SNow state: ${mapping.snowStatus}`}
            />
            <button
              className={styles.removeButton}
              onClick={() => handleRemoveMapping(mapping.jiraStatus)}
              aria-label={`Remove mapping for ${mapping.jiraStatus}`}
              title={`Remove "${mapping.jiraStatus}" mapping`}
            >
              ×
            </button>
          </div>
        ))}

        {/* Add new mapping row */}
        <div className={styles.addRowWrapper}>
          <input
            className={styles.mappingInput}
            placeholder="Jira status (e.g. In Progress)"
            value={pendingJiraStatus}
            onChange={handlePendingJiraStatusChange}
            onKeyDown={handleAddKeyDown}
            aria-label="New Jira status"
          />
          <span className={styles.mappingArrow}>→</span>
          <input
            className={styles.mappingInput}
            placeholder="SNow state (e.g. In Progress)"
            value={pendingSnowStatus}
            onChange={handlePendingSnowStatusChange}
            onKeyDown={handleAddKeyDown}
            aria-label="New SNow state"
          />
          <button
            className={styles.addButton}
            onClick={handleAddMapping}
            disabled={isAddButtonDisabled}
            aria-label="Add status mapping"
          >
            + Add
          </button>
        </div>
      </div>

      <p className={styles.persistenceNote}>
        ✓ Mappings are saved automatically in your browser and will persist after updates.
      </p>
    </div>
  );
}
