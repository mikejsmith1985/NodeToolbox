// StablizationFundingTab.tsx — Business Helper funding table for rebuilding the stablization spreadsheet workflow.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatUsdCurrencyAmount,
  useStablizationFundingTable,
  type StablizationCurrencyField,
  type StablizationFundingComputedRow,
  type StablizationTextField,
} from '../hooks/useStablizationFundingTable.ts';
import {
  DEFAULT_STABLIZATION_COLUMN_WIDTHS,
  useBusinessHelperSettings,
  type StablizationColumnInputKind,
  type StablizationConfigurableColumn,
  type StablizationTableColumn,
} from '../hooks/useBusinessHelperSettings.ts';
import styles from './StablizationFundingTab.module.css';

const TAB_TITLE = 'Stablization';
const TAB_SUBTITLE =
  'Rebuild the stablization funding table here, with Testing and Total calculated automatically from the entered costs.';
const AUTO_SAVE_MESSAGE = 'Rows save automatically in this browser while the business partner works.';
const ROW_COUNT_LABEL = 'Funding rows';
const ADD_ROW_BUTTON_LABEL = '+ Add Funding Row';
const FOOTER_LABEL = 'Totals';
const MIN_TEXTAREA_HEIGHT_PX = 44;
const RESIZE_HANDLE_LABEL_PREFIX = 'Resize';
const MIN_COLUMN_WIDTH_PX = 96;
const TABLE_COLUMNS = [
  { key: 'grouping', label: 'Grouping', className: 'groupingColumn', canResize: true },
  { key: 'name', label: 'Name', className: 'nameColumn', canResize: true },
  { key: 'fulfillmentCost', label: 'Fulfillment Cost', className: 'currencyColumn', canResize: true },
  { key: 'enrollmentCost', label: 'Enrollment Cost', className: 'currencyColumn', canResize: true },
  { key: 'billing', label: 'Billing', className: 'currencyColumn', canResize: true },
  { key: 'testing', label: 'Testing', className: 'calculatedCurrencyColumn', canResize: true },
  { key: 'total', label: 'Total', className: 'calculatedCurrencyColumn', canResize: true },
  { key: 'justification', label: 'Justification', className: 'justificationColumn', canResize: true },
  { key: 'timing', label: 'Timing', className: 'timingColumn', canResize: true },
  { key: 'cost', label: 'Cost', className: 'currencyColumn', canResize: true },
  { key: 'actions', label: 'Actions', className: 'actionsColumn', canResize: false },
] as const;

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

interface SourceJiraLinkProps {
  browseUrl: string;
  issueKey: string;
}

interface ColumnResizeSession {
  columnKey: StablizationTableColumn;
  startingClientX: number;
  startingWidthPx: number;
}

const SOURCE_JIRA_LINK_LABEL = 'Open source Jira issue';

function EditableTextCell({ ariaLabel, inputValue, onChange }: EditableTextCellProps) {
  const textAreaElementRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    resizeTextAreaToContent(textAreaElementRef.current);
  }, [inputValue]);

  return (
    <textarea
      aria-label={ariaLabel}
      className={styles.textInput}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
      onInput={() => resizeTextAreaToContent(textAreaElementRef.current)}
      ref={textAreaElementRef}
      rows={1}
      value={inputValue}
    />
  );
}

function SourceJiraLink({ browseUrl, issueKey }: SourceJiraLinkProps) {
  if (!browseUrl || !issueKey) {
    return null;
  }

  return (
    <a
      aria-label={`${SOURCE_JIRA_LINK_LABEL} ${issueKey}`}
      className={styles.sourceJiraLink}
      href={browseUrl}
      rel="noreferrer"
      target="_blank"
    >
      {issueKey}
    </a>
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
  const hasGroupingJiraLink = row.sourceJiraLinkedColumns.includes('grouping');
  const hasNameJiraLink = row.sourceJiraLinkedColumns.includes('name');
  const hasJustificationJiraLink = row.sourceJiraLinkedColumns.includes('justification');

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
        {hasGroupingJiraLink && (
          <SourceJiraLink browseUrl={row.sourceJiraBrowseUrl} issueKey={row.sourceJiraIssueKey} />
        )}
      </td>
      <td className={styles.tableCell}>
        <ConfiguredTextCell
          ariaLabel={`Name for row ${rowNumber}`}
          dropdownOptions={settingsByColumn.name.dropdownOptions}
          inputKind={settingsByColumn.name.inputKind}
          inputValue={row.name}
          onChange={(value) => onTextChange(row.id, 'name', value)}
        />
        {hasNameJiraLink && (
          <SourceJiraLink browseUrl={row.sourceJiraBrowseUrl} issueKey={row.sourceJiraIssueKey} />
        )}
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
        {hasJustificationJiraLink && (
          <SourceJiraLink browseUrl={row.sourceJiraBrowseUrl} issueKey={row.sourceJiraIssueKey} />
        )}
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
  const businessHelperSettings = useBusinessHelperSettings();
  const stablizationFundingTable = useStablizationFundingTable(businessHelperSettings.settings);
  const [columnWidthsByKey, setColumnWidthsByKey] = useState(
    businessHelperSettings.settings.stablizationColumnWidths,
  );
  const columnWidthsRef = useRef(columnWidthsByKey);
  const resizeSessionRef = useRef<ColumnResizeSession | null>(null);
  columnWidthsRef.current = columnWidthsByKey;

  const handleColumnResizeMove = useCallback((moveEvent: MouseEvent) => {
    const resizeSession = resizeSessionRef.current;
    if (!resizeSession) {
      return;
    }

    const nextWidthPx = calculateNextColumnWidth(
      resizeSession.startingWidthPx,
      resizeSession.startingClientX,
      moveEvent.clientX,
    );
    if (columnWidthsRef.current[resizeSession.columnKey] === nextWidthPx) {
      return;
    }

    const nextColumnWidths = {
      ...columnWidthsRef.current,
      [resizeSession.columnKey]: nextWidthPx,
    };
    columnWidthsRef.current = nextColumnWidths;
    setColumnWidthsByKey(nextColumnWidths);
  }, []);
  const stopColumnResize = useCallback(function stopColumnResizeCallback() {
    const resizeSession = resizeSessionRef.current;
    window.removeEventListener('mousemove', handleColumnResizeMove);
    window.removeEventListener('mouseup', stopColumnResizeCallback);
    document.body.classList.remove(styles.isResizingColumns);

    if (!resizeSession) {
      return;
    }

    businessHelperSettings.updateStablizationColumnWidth(
      resizeSession.columnKey,
      columnWidthsRef.current[resizeSession.columnKey],
    );
    resizeSessionRef.current = null;
  }, [businessHelperSettings, handleColumnResizeMove]);
  const handleBeginColumnResize = useCallback(
    (columnKey: StablizationTableColumn, startingClientX: number) => {
      resizeSessionRef.current = {
        columnKey,
        startingClientX,
        startingWidthPx: columnWidthsRef.current[columnKey],
      };
      document.body.classList.add(styles.isResizingColumns);
      window.addEventListener('mousemove', handleColumnResizeMove);
      window.addEventListener('mouseup', stopColumnResize);
    },
    [handleColumnResizeMove, stopColumnResize],
  );
  const handleResetColumnWidth = useCallback(
    (columnKey: StablizationTableColumn) => {
      const defaultColumnWidth = DEFAULT_STABLIZATION_COLUMN_WIDTHS[columnKey];
      const nextColumnWidths = {
        ...columnWidthsRef.current,
        [columnKey]: defaultColumnWidth,
      };
      columnWidthsRef.current = nextColumnWidths;
      setColumnWidthsByKey(nextColumnWidths);
      businessHelperSettings.updateStablizationColumnWidth(columnKey, defaultColumnWidth);
    },
    [businessHelperSettings],
  );

  useEffect(() => () => stopColumnResize(), [stopColumnResize]);

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
          <colgroup>
            {TABLE_COLUMNS.map((tableColumn) => (
              <col
                key={tableColumn.key}
                className={styles[tableColumn.className]}
                data-column-key={tableColumn.key}
                style={{ width: `${columnWidthsByKey[tableColumn.key]}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((tableColumn) => (
                <th
                  key={tableColumn.key}
                  className={`${styles.tableHeaderCell} ${styles[tableColumn.className]}`}
                  data-column-key={tableColumn.key}
                  scope="col"
                >
                  <div className={styles.headerCellContent}>
                    <span>{tableColumn.label}</span>
                    {tableColumn.canResize && (
                      <button
                        aria-label={`${RESIZE_HANDLE_LABEL_PREFIX} ${tableColumn.label} column`}
                        className={styles.resizeHandle}
                        onDoubleClick={() => handleResetColumnWidth(tableColumn.key)}
                        onMouseDown={(mouseDownEvent) => {
                          mouseDownEvent.preventDefault();
                          handleBeginColumnResize(tableColumn.key, mouseDownEvent.clientX);
                        }}
                        type="button"
                      />
                    )}
                  </div>
                </th>
              ))}
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

function resizeTextAreaToContent(textAreaElement: HTMLTextAreaElement | null): void {
  if (!textAreaElement) {
    return;
  }

  textAreaElement.style.height = '0px';
  textAreaElement.style.height = `${Math.max(textAreaElement.scrollHeight, MIN_TEXTAREA_HEIGHT_PX)}px`;
}

function calculateNextColumnWidth(
  startingWidthPx: number,
  startingClientX: number,
  currentClientX: number,
): number {
  return Math.max(MIN_COLUMN_WIDTH_PX, startingWidthPx + (currentClientX - startingClientX));
}
function buildRenderedDropdownOptions(currentValue: string, dropdownOptions: string[]): string[] {
  if (!currentValue || dropdownOptions.includes(currentValue)) {
    return dropdownOptions;
  }

  return [currentValue, ...dropdownOptions];
}
