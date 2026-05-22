// StablizationFundingTab.tsx — Business Helper funding table for rebuilding the stablization spreadsheet workflow.

import {
  formatUsdCurrencyAmount,
  useStablizationFundingTable,
  type StablizationCurrencyField,
  type StablizationFundingComputedRow,
  type StablizationTextField,
} from '../hooks/useStablizationFundingTable.ts';
import {
  useBusinessHelperSettings,
  type StablizationColumnInputKind,
  type StablizationConfigurableColumn,
} from '../hooks/useBusinessHelperSettings.ts';
import styles from './StablizationFundingTab.module.css';

const TAB_TITLE = 'Stablization';
const TAB_SUBTITLE =
  'Rebuild the stablization funding table here, with Testing and Total calculated automatically from the entered costs.';
const AUTO_SAVE_MESSAGE = 'Rows save automatically in this browser while the business partner works.';
const ROW_COUNT_LABEL = 'Funding rows';
const ADD_ROW_BUTTON_LABEL = '+ Add Funding Row';
const FOOTER_LABEL = 'Totals';

interface EditableTextCellProps {
  ariaLabel: string;
  inputValue: string;
  onChange: (value: string) => void;
}

interface EditableCurrencyCellProps extends EditableTextCellProps {
  minimumValue?: number;
}

interface ConfiguredTextCellProps extends EditableTextCellProps {
  inputKind: StablizationColumnInputKind;
  dropdownOptions: string[];
}

interface CalculatedCurrencyCellProps {
  ariaLabel: string;
  currencyAmount: number;
}

interface FundingTableRowProps {
  row: StablizationFundingComputedRow;
  rowIndex: number;
  settingsByColumn: Record<StablizationConfigurableColumn, { inputKind: StablizationColumnInputKind; dropdownOptions: string[] }>;
  onRemove: (rowId: string) => void;
  onTextChange: (rowId: string, fieldName: StablizationTextField, value: string) => void;
  onCurrencyChange: (rowId: string, fieldName: StablizationCurrencyField, value: string) => void;
}

function EditableTextCell({ ariaLabel, inputValue, onChange }: EditableTextCellProps) {
  return (
    <input
      aria-label={ariaLabel}
      className={styles.textInput}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
      type="text"
      value={inputValue}
    />
  );
}

function EditableCurrencyCell({ ariaLabel, inputValue, minimumValue = 0, onChange }: EditableCurrencyCellProps) {
  return (
    <input
      aria-label={ariaLabel}
      className={styles.currencyInput}
      inputMode="decimal"
      min={minimumValue}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
      step="0.01"
      type="number"
      value={inputValue}
    />
  );
}

function ConfiguredTextCell({
  ariaLabel,
  inputValue,
  inputKind,
  dropdownOptions,
  onChange,
}: ConfiguredTextCellProps) {
  if (inputKind === 'dropdown') {
    const renderedOptions = buildRenderedDropdownOptions(inputValue, dropdownOptions);

    return (
      <select
        aria-label={ariaLabel}
        className={styles.selectInput}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        value={inputValue}
      >
        <option value="">
          {dropdownOptions.length > 0 ? 'Select an option' : 'No options configured'}
        </option>
        {renderedOptions.map((dropdownOption) => (
          <option key={dropdownOption} value={dropdownOption}>
            {dropdownOption}
          </option>
        ))}
      </select>
    );
  }

  return <EditableTextCell ariaLabel={ariaLabel} inputValue={inputValue} onChange={onChange} />;
}

function EditableDateCell({ ariaLabel, inputValue, onChange }: EditableTextCellProps) {
  return (
    <input
      aria-label={ariaLabel}
      className={styles.dateInput}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
      type="date"
      value={inputValue}
    />
  );
}

function CalculatedCurrencyCell({ ariaLabel, currencyAmount }: CalculatedCurrencyCellProps) {
  return (
    <output aria-label={ariaLabel} className={styles.calculatedValue}>
      {formatUsdCurrencyAmount(currencyAmount)}
    </output>
  );
}

function FundingTableRow({
  row,
  rowIndex,
  settingsByColumn,
  onRemove,
  onTextChange,
  onCurrencyChange,
}: FundingTableRowProps) {
  const rowNumber = rowIndex + 1;
  const removeButtonLabel = row.name ? `Remove ${row.name}` : `Remove row ${rowNumber}`;

  return (
    <tr className={styles.tableRow}>
      <td className={styles.tableCell}>
        <ConfiguredTextCell
          ariaLabel={`Grouping for row ${rowNumber}`}
          dropdownOptions={settingsByColumn.grouping.dropdownOptions}
          inputKind={settingsByColumn.grouping.inputKind}
          inputValue={row.grouping}
          onChange={(value) => onTextChange(row.id, 'grouping', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <ConfiguredTextCell
          ariaLabel={`Name for row ${rowNumber}`}
          dropdownOptions={settingsByColumn.name.dropdownOptions}
          inputKind={settingsByColumn.name.inputKind}
          inputValue={row.name}
          onChange={(value) => onTextChange(row.id, 'name', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <EditableCurrencyCell
          ariaLabel={`Fulfillment Cost for row ${rowNumber}`}
          inputValue={row.fulfillmentCost}
          onChange={(value) => onCurrencyChange(row.id, 'fulfillmentCost', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <EditableCurrencyCell
          ariaLabel={`Enrollment Cost for row ${rowNumber}`}
          inputValue={row.enrollmentCost}
          onChange={(value) => onCurrencyChange(row.id, 'enrollmentCost', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <EditableCurrencyCell
          ariaLabel={`Billing for row ${rowNumber}`}
          inputValue={row.billing}
          onChange={(value) => onCurrencyChange(row.id, 'billing', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <CalculatedCurrencyCell ariaLabel={`Testing amount for row ${rowNumber}`} currencyAmount={row.testingAmount} />
      </td>
      <td className={styles.tableCell}>
        <CalculatedCurrencyCell ariaLabel={`Total amount for row ${rowNumber}`} currencyAmount={row.totalAmount} />
      </td>
      <td className={styles.tableCell}>
        <ConfiguredTextCell
          ariaLabel={`Justification for row ${rowNumber}`}
          dropdownOptions={settingsByColumn.justification.dropdownOptions}
          inputKind={settingsByColumn.justification.inputKind}
          inputValue={row.justification}
          onChange={(value) => onTextChange(row.id, 'justification', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <EditableDateCell
          ariaLabel={`Timing for row ${rowNumber}`}
          inputValue={row.timing}
          onChange={(value) => onTextChange(row.id, 'timing', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <EditableCurrencyCell
          ariaLabel={`Cost for row ${rowNumber}`}
          inputValue={row.cost}
          onChange={(value) => onCurrencyChange(row.id, 'cost', value)}
        />
      </td>
      <td className={styles.tableCell}>
        <button
          aria-label={removeButtonLabel}
          className={styles.removeRowButton}
          onClick={() => onRemove(row.id)}
          type="button"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

/** Renders the first Business Helper funding table so a partner can rebuild the stablization spreadsheet in-app. */
export default function StablizationFundingTab() {
  const stablizationFundingTable = useStablizationFundingTable();
  const businessHelperSettings = useBusinessHelperSettings();

  return (
    <div className={styles.stablizationTab}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{TAB_TITLE}</h2>
        <p className={styles.sectionSubtitle}>{TAB_SUBTITLE}</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.toolbarMeta}>
          <span className={styles.infoBadge}>
            {ROW_COUNT_LABEL}: {stablizationFundingTable.rows.length}
          </span>
          <p className={styles.autosaveNote}>{AUTO_SAVE_MESSAGE}</p>
        </div>
        <button className={styles.addRowButton} onClick={stablizationFundingTable.addRow} type="button">
          {ADD_ROW_BUTTON_LABEL}
        </button>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.fundingTable}>
          <thead>
            <tr>
              <th className={styles.tableHeaderCell} scope="col">Grouping</th>
              <th className={styles.tableHeaderCell} scope="col">Name</th>
              <th className={styles.tableHeaderCell} scope="col">Fulfillment Cost</th>
              <th className={styles.tableHeaderCell} scope="col">Enrollment Cost</th>
              <th className={styles.tableHeaderCell} scope="col">Billing</th>
              <th className={styles.tableHeaderCell} scope="col">Testing</th>
              <th className={styles.tableHeaderCell} scope="col">Total</th>
              <th className={styles.tableHeaderCell} scope="col">Justification</th>
              <th className={styles.tableHeaderCell} scope="col">Timing</th>
              <th className={styles.tableHeaderCell} scope="col">Cost</th>
              <th className={styles.tableHeaderCell} scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stablizationFundingTable.rows.map((row, rowIndex) => (
              <FundingTableRow
                key={row.id}
                onCurrencyChange={stablizationFundingTable.updateCurrencyField}
                onRemove={stablizationFundingTable.removeRow}
                onTextChange={stablizationFundingTable.updateTextField}
                row={row}
                rowIndex={rowIndex}
                settingsByColumn={businessHelperSettings.settings.stablizationColumns}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.footerRow}>
              <th className={styles.footerLabelCell} colSpan={2} scope="row">{FOOTER_LABEL}</th>
              <td aria-label="Fulfillment Cost footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.fulfillmentCost)}
              </td>
              <td aria-label="Enrollment Cost footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.enrollmentCost)}
              </td>
              <td aria-label="Billing footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.billing)}
              </td>
              <td aria-label="Testing footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.testing)}
              </td>
              <td aria-label="Total footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.total)}
              </td>
              <td className={styles.footerCell}>—</td>
              <td className={styles.footerCell}>—</td>
              <td aria-label="Cost footer total" className={styles.footerCell}>
                {formatUsdCurrencyAmount(stablizationFundingTable.totals.cost)}
              </td>
              <td className={styles.footerCell}>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
function buildRenderedDropdownOptions(currentValue: string, dropdownOptions: string[]): string[] {
  if (!currentValue || dropdownOptions.includes(currentValue)) {
    return dropdownOptions;
  }

  return [currentValue, ...dropdownOptions];
}
