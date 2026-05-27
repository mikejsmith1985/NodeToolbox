// BusinessHelperSettingsTab.tsx — Business Helper settings UI for column behavior and Simple Search transfer mapping.

import { useState } from 'react';

import {
  SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS,
  STABLIZATION_COLUMN_LABELS,
  STABLIZATION_CONFIGURABLE_COLUMNS,
  canUserColumnUseSimpleSearchMapping,
  useBusinessHelperSettings,
  type SimpleSearchMappingSource,
  type StablizationColumnInputKind,
  type StablizationConfigurableColumn,
  type StablizationUserColumnDataType,
} from '../hooks/useBusinessHelperSettings.ts';
import styles from './BusinessHelperSettingsTab.module.css';

const TAB_TITLE = 'Settings';
const TAB_SUBTITLE =
  'Configure how Business Helper tables behave and how Simple Search sends Jira data into Stablization.';
const CUSTOM_COLUMN_SECTION_TITLE = 'Custom Stablization columns';
const CUSTOM_COLUMN_SECTION_DESCRIPTION =
  'Add your own Stablization columns and choose whether they behave as text, dropdown, currency, or date fields.';
const COLUMN_SECTION_TITLE = 'Built-in Stablization column settings';
const COLUMN_SECTION_DESCRIPTION =
  'Choose whether each built-in editable text column stays freeform or becomes a dropdown with a curated option list.';
const MAPPING_SECTION_TITLE = 'Simple Search to built-in Stablization mapping';
const MAPPING_SECTION_DESCRIPTION =
  'Choose which Jira result field should populate each built-in Stablization text column when the user sends a result into the table.';
const INPUT_KIND_OPTIONS: Array<{ value: StablizationColumnInputKind; label: string }> = [
  { value: 'text', label: 'Freeform text' },
  { value: 'dropdown', label: 'Dropdown list' },
];
const USER_COLUMN_DATA_TYPE_OPTIONS: Array<{ value: StablizationUserColumnDataType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
];
const EMPTY_DROPDOWN_HINT = 'No dropdown options configured yet.';
const TEXT_INPUT_HINT = 'This column stays freeform unless you switch it to a dropdown.';
const CUSTOM_COLUMN_LABEL_PLACEHOLDER = 'Column label';
const ADD_CUSTOM_COLUMN_BUTTON_LABEL = 'Add custom column';
const MANUAL_ONLY_MAPPING_HINT = 'Manual only for this data type.';

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
  const [builtInOptionDraftsByColumn, setBuiltInOptionDraftsByColumn] = useState(createDefaultOptionDrafts);
  const [userColumnOptionDraftsById, setUserColumnOptionDraftsById] = useState<Record<string, string>>({});
  const [newUserColumnLabel, setNewUserColumnLabel] = useState('');
  const [newUserColumnDataType, setNewUserColumnDataType] = useState<StablizationUserColumnDataType>('text');

  function handleBuiltInOptionDraftChange(
    columnKey: StablizationConfigurableColumn,
    nextDraftValue: string,
  ): void {
    setBuiltInOptionDraftsByColumn((currentDraftsByColumn) => ({
      ...currentDraftsByColumn,
      [columnKey]: nextDraftValue,
    }));
  }

  function handleUserColumnOptionDraftChange(columnId: string, nextDraftValue: string): void {
    setUserColumnOptionDraftsById((currentDraftsById) => ({
      ...currentDraftsById,
      [columnId]: nextDraftValue,
    }));
  }

  function handleAddDropdownOption(columnKey: StablizationConfigurableColumn): void {
    businessHelperSettings.addDropdownOption(columnKey, builtInOptionDraftsByColumn[columnKey]);
    setBuiltInOptionDraftsByColumn((currentDraftsByColumn) => ({
      ...currentDraftsByColumn,
      [columnKey]: '',
    }));
  }

  function handleAddUserColumn(): void {
    businessHelperSettings.addUserColumn(newUserColumnLabel, newUserColumnDataType);
    setNewUserColumnLabel('');
    setNewUserColumnDataType('text');
  }

  function handleAddUserColumnDropdownOption(columnId: string): void {
    businessHelperSettings.addUserColumnDropdownOption(columnId, userColumnOptionDraftsById[columnId] ?? '');
    setUserColumnOptionDraftsById((currentDraftsById) => ({
      ...currentDraftsById,
      [columnId]: '',
    }));
  }

  return (
    <section className={styles.settingsTab} aria-label={TAB_TITLE}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{TAB_TITLE}</h2>
        <p className={styles.sectionSubtitle}>{TAB_SUBTITLE}</p>
      </header>

      <section className={styles.settingsSection}>
        <h3 className={styles.sectionHeading}>{CUSTOM_COLUMN_SECTION_TITLE}</h3>
        <p className={styles.sectionDescription}>{CUSTOM_COLUMN_SECTION_DESCRIPTION}</p>

        <div className={styles.customColumnCreator}>
          <input
            aria-label="New custom column label"
            className={styles.controlInput}
            onChange={(changeEvent) => setNewUserColumnLabel(changeEvent.target.value)}
            placeholder={CUSTOM_COLUMN_LABEL_PLACEHOLDER}
            type="text"
            value={newUserColumnLabel}
          />
          <select
            aria-label="New custom column data type"
            className={styles.controlSelect}
            onChange={(changeEvent) => setNewUserColumnDataType(changeEvent.target.value as StablizationUserColumnDataType)}
            value={newUserColumnDataType}
          >
            {USER_COLUMN_DATA_TYPE_OPTIONS.map((dataTypeOption) => (
              <option key={dataTypeOption.value} value={dataTypeOption.value}>
                {dataTypeOption.label}
              </option>
            ))}
          </select>
          <button
            className={styles.optionAddButton}
            onClick={handleAddUserColumn}
            type="button"
          >
            {ADD_CUSTOM_COLUMN_BUTTON_LABEL}
          </button>
        </div>

        <div className={styles.settingsTableWrapper}>
          <table className={styles.settingsTable}>
            <thead>
              <tr>
                <th className={styles.tableHeaderCell} scope="col">Column label</th>
                <th className={styles.tableHeaderCell} scope="col">Data type</th>
                <th className={styles.tableHeaderCell} scope="col">Simple Search mapping</th>
                <th className={styles.tableHeaderCell} scope="col">Dropdown list</th>
                <th className={styles.tableHeaderCell} scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {businessHelperSettings.settings.stablizationUserColumns.length > 0 ? (
                businessHelperSettings.settings.stablizationUserColumns.map((stablizationUserColumn) => (
                  <tr key={stablizationUserColumn.id}>
                    <td className={styles.tableCell}>
                      <input
                        aria-label={`${stablizationUserColumn.label} label`}
                        className={styles.controlInput}
                        onChange={(changeEvent) =>
                          businessHelperSettings.updateUserColumnLabel(
                            stablizationUserColumn.id,
                            changeEvent.target.value,
                          )
                        }
                        type="text"
                        value={stablizationUserColumn.label}
                      />
                    </td>
                    <td className={styles.tableCell}>
                      <select
                        aria-label={`${stablizationUserColumn.label} data type`}
                        className={styles.controlSelect}
                        onChange={(changeEvent) =>
                          businessHelperSettings.updateUserColumnDataType(
                            stablizationUserColumn.id,
                            changeEvent.target.value as StablizationUserColumnDataType,
                          )
                        }
                        value={stablizationUserColumn.dataType}
                      >
                        {USER_COLUMN_DATA_TYPE_OPTIONS.map((dataTypeOption) => (
                          <option key={dataTypeOption.value} value={dataTypeOption.value}>
                            {dataTypeOption.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.tableCell}>
                      {canUserColumnUseSimpleSearchMapping(stablizationUserColumn.dataType) ? (
                        <select
                          aria-label={`${stablizationUserColumn.label} mapping source`}
                          className={styles.controlSelect}
                          onChange={(changeEvent) =>
                            businessHelperSettings.updateUserColumnSimpleSearchMapping(
                              stablizationUserColumn.id,
                              changeEvent.target.value as SimpleSearchMappingSource,
                            )
                          }
                          value={stablizationUserColumn.simpleSearchMapping}
                        >
                          {SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS.map((mappingOption) => (
                            <option key={mappingOption.value} value={mappingOption.value}>
                              {mappingOption.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className={styles.emptyHint}>{MANUAL_ONLY_MAPPING_HINT}</p>
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      {stablizationUserColumn.dataType === 'dropdown' ? (
                        <div className={styles.optionEditor}>
                          <div className={styles.optionInputRow}>
                            <input
                              aria-label={`New option for ${stablizationUserColumn.label}`}
                              className={styles.controlInput}
                              onChange={(changeEvent) =>
                                handleUserColumnOptionDraftChange(stablizationUserColumn.id, changeEvent.target.value)
                              }
                              placeholder={`Add a ${stablizationUserColumn.label} option`}
                              type="text"
                              value={userColumnOptionDraftsById[stablizationUserColumn.id] ?? ''}
                            />
                            <button
                              aria-label={`Add option to ${stablizationUserColumn.label}`}
                              className={styles.optionAddButton}
                              onClick={() => handleAddUserColumnDropdownOption(stablizationUserColumn.id)}
                              type="button"
                            >
                              Add option
                            </button>
                          </div>

                          {stablizationUserColumn.dropdownOptions.length > 0 ? (
                            <ul className={styles.optionList}>
                              {stablizationUserColumn.dropdownOptions.map((dropdownOption) => (
                                <li key={dropdownOption} className={styles.optionChip}>
                                  <span>{dropdownOption}</span>
                                  <button
                                    aria-label={`Remove ${dropdownOption} from ${stablizationUserColumn.label}`}
                                    className={styles.optionRemoveButton}
                                    onClick={() =>
                                      businessHelperSettings.removeUserColumnDropdownOption(
                                        stablizationUserColumn.id,
                                        dropdownOption,
                                      )
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
                        <p className={styles.emptyHint}>Not used for this data type.</p>
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      <button
                        aria-label={`Remove ${stablizationUserColumn.label}`}
                        className={styles.optionRemoveButton}
                        onClick={() => businessHelperSettings.removeUserColumn(stablizationUserColumn.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={styles.tableCell} colSpan={5}>
                    <p className={styles.emptyHint}>No custom columns yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
                              onChange={(changeEvent) => handleBuiltInOptionDraftChange(columnKey, changeEvent.target.value)}
                              placeholder={`Add a ${columnLabel} option`}
                              type="text"
                              value={builtInOptionDraftsByColumn[columnKey]}
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
                          changeEvent.target.value as SimpleSearchMappingSource,
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
