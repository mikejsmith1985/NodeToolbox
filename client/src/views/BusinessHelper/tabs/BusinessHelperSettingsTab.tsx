// BusinessHelperSettingsTab.tsx — Business Helper settings UI for column behavior and Simple Search transfer mapping.

import { useState } from 'react';

import {
  SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS,
  STABLIZATION_COLUMN_LABELS,
  STABLIZATION_CONFIGURABLE_COLUMNS,
  useBusinessHelperSettings,
  type StablizationColumnInputKind,
  type StablizationConfigurableColumn,
} from '../hooks/useBusinessHelperSettings.ts';
import styles from './BusinessHelperSettingsTab.module.css';

const TAB_TITLE = 'Settings';
const TAB_SUBTITLE =
  'Configure how Business Helper tables behave and how Simple Search sends Jira data into Stablization.';
const COLUMN_SECTION_TITLE = 'Stablization column settings';
const COLUMN_SECTION_DESCRIPTION =
  'Choose whether each editable text column stays freeform or becomes a dropdown with a curated option list.';
const MAPPING_SECTION_TITLE = 'Simple Search to Stablization mapping';
const MAPPING_SECTION_DESCRIPTION =
  'Choose which Jira result field should populate each Stablization text column when the user sends a result into the table.';
const INPUT_KIND_OPTIONS: Array<{ value: StablizationColumnInputKind; label: string }> = [
  { value: 'text', label: 'Freeform text' },
  { value: 'dropdown', label: 'Dropdown list' },
];
const EMPTY_DROPDOWN_HINT = 'No dropdown options configured yet.';
const TEXT_INPUT_HINT = 'This column stays freeform unless you switch it to a dropdown.';

function createDefaultOptionDrafts(): Record<StablizationConfigurableColumn, string> {
  return {
    grouping: '',
    name: '',
    justification: '',
  };
}

/** Renders Business Helper settings so the Stablization table can be configured without editing code. */
export default function BusinessHelperSettingsTab() {
  const businessHelperSettings = useBusinessHelperSettings();
  const [optionDraftsByColumn, setOptionDraftsByColumn] = useState(createDefaultOptionDrafts);

  function handleOptionDraftChange(columnKey: StablizationConfigurableColumn, nextDraftValue: string): void {
    setOptionDraftsByColumn((currentDrafts) => ({
      ...currentDrafts,
      [columnKey]: nextDraftValue,
    }));
  }

  function handleAddDropdownOption(columnKey: StablizationConfigurableColumn): void {
    businessHelperSettings.addDropdownOption(columnKey, optionDraftsByColumn[columnKey]);
    setOptionDraftsByColumn((currentDrafts) => ({
      ...currentDrafts,
      [columnKey]: '',
    }));
  }

  return (
    <section className={styles.settingsTab} aria-label={TAB_TITLE}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{TAB_TITLE}</h2>
        <p className={styles.sectionSubtitle}>{TAB_SUBTITLE}</p>
      </header>

      <section className={styles.settingsSection}>
        <h3 className={styles.sectionHeading}>{COLUMN_SECTION_TITLE}</h3>
        <p className={styles.sectionDescription}>{COLUMN_SECTION_DESCRIPTION}</p>

        <div className={styles.settingsTableWrapper}>
          <table className={styles.settingsTable}>
            <thead>
              <tr>
                <th className={styles.tableHeaderCell} scope="col">Column</th>
                <th className={styles.tableHeaderCell} scope="col">Input style</th>
                <th className={styles.tableHeaderCell} scope="col">Dropdown list</th>
              </tr>
            </thead>
            <tbody>
              {STABLIZATION_CONFIGURABLE_COLUMNS.map(({ key: columnKey, label: columnLabel }) => {
                const columnSetting = businessHelperSettings.settings.stablizationColumns[columnKey];

                return (
                  <tr key={columnKey}>
                    <td className={styles.tableCell}>{columnLabel}</td>
                    <td className={styles.tableCell}>
                      <select
                        aria-label={`${columnLabel} input type`}
                        className={styles.controlSelect}
                        onChange={(changeEvent) =>
                          businessHelperSettings.updateColumnInputKind(
                            columnKey,
                            changeEvent.target.value as StablizationColumnInputKind,
                          )
                        }
                        value={columnSetting.inputKind}
                      >
                        {INPUT_KIND_OPTIONS.map((inputKindOption) => (
                          <option key={inputKindOption.value} value={inputKindOption.value}>
                            {inputKindOption.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.tableCell}>
                      {columnSetting.inputKind === 'dropdown' ? (
                        <div className={styles.optionEditor}>
                          <div className={styles.optionInputRow}>
                            <input
                              aria-label={`New option for ${columnLabel}`}
                              className={styles.controlInput}
                              onChange={(changeEvent) => handleOptionDraftChange(columnKey, changeEvent.target.value)}
                              placeholder={`Add a ${columnLabel} option`}
                              type="text"
                              value={optionDraftsByColumn[columnKey]}
                            />
                            <button
                              aria-label={`Add option to ${columnLabel}`}
                              className={styles.optionAddButton}
                              onClick={() => handleAddDropdownOption(columnKey)}
                              type="button"
                            >
                              Add option
                            </button>
                          </div>

                          {columnSetting.dropdownOptions.length > 0 ? (
                            <ul className={styles.optionList}>
                              {columnSetting.dropdownOptions.map((dropdownOption) => (
                                <li key={dropdownOption} className={styles.optionChip}>
                                  <span>{dropdownOption}</span>
                                  <button
                                    aria-label={`Remove ${dropdownOption} from ${columnLabel}`}
                                    className={styles.optionRemoveButton}
                                    onClick={() =>
                                      businessHelperSettings.removeDropdownOption(columnKey, dropdownOption)
                                    }
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.emptyHint}>{EMPTY_DROPDOWN_HINT}</p>
                          )}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>{TEXT_INPUT_HINT}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.settingsSection}>
        <h3 className={styles.sectionHeading}>{MAPPING_SECTION_TITLE}</h3>
        <p className={styles.sectionDescription}>{MAPPING_SECTION_DESCRIPTION}</p>

        <div className={styles.settingsTableWrapper}>
          <table className={styles.settingsTable}>
            <thead>
              <tr>
                <th className={styles.tableHeaderCell} scope="col">Destination column</th>
                <th className={styles.tableHeaderCell} scope="col">Simple Search source</th>
              </tr>
            </thead>
            <tbody>
              {STABLIZATION_CONFIGURABLE_COLUMNS.map(({ key: columnKey }) => (
                <tr key={columnKey}>
                  <td className={styles.tableCell}>{STABLIZATION_COLUMN_LABELS[columnKey]}</td>
                  <td className={styles.tableCell}>
                    <select
                      aria-label={`${STABLIZATION_COLUMN_LABELS[columnKey]} mapping source`}
                      className={styles.controlSelect}
                      onChange={(changeEvent) =>
                        businessHelperSettings.updateSimpleSearchMapping(
                          columnKey,
                          changeEvent.target.value as (typeof SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS)[number]['value'],
                        )
                      }
                      value={businessHelperSettings.settings.simpleSearchMapping[columnKey]}
                    >
                      {SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS.map((mappingOption) => (
                        <option key={mappingOption.value} value={mappingOption.value}>
                          {mappingOption.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
