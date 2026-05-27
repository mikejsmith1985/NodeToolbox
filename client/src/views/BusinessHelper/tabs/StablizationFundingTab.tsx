// StablizationFundingTab.tsx — Business Helper funding table for rebuilding the stablization spreadsheet workflow.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  formatUsdCurrencyAmount,
  useStablizationFundingTable,
  type StablizationCurrencyField,
  type StablizationFundingComputedRow,
  type StablizationTextField,
} from '../hooks/useStablizationFundingTable.ts';
import {
  DEFAULT_STABLIZATION_COLUMN_WIDTHS,
  DEFAULT_STABLIZATION_USER_COLUMN_WIDTH_PX,
  MAX_STABLIZATION_COLUMN_WIDTH_PX,
  MIN_STABLIZATION_COLUMN_WIDTH_PX,
  useBusinessHelperSettings,
  type BusinessHelperSettingsState,
  type StablizationColumnInputKind,
  type StablizationConfigurableColumn,
  type StablizationTableColumn,
  type StablizationUserColumn,
  type StablizationUserColumnDataType,
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

const FIXED_TABLE_COLUMNS = [
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
  stablizationUserColumns: readonly StablizationUserColumn[];
  onRemove: (rowId: string) => void;
  onTextChange: (rowId: string, fieldName: StablizationTextField, value: string) => void;
  onCurrencyChange: (rowId: string, fieldName: StablizationCurrencyField, value: string) => void;
  onUserColumnChange: (rowId: string, columnId: string, value: string) => void;
}

interface SourceJiraLinkProps {
  browseUrl: string;
  issueKey: string;
}

interface ColumnResizeSession {
  columnKey: string;
  startingClientX: number;
  startingWidthPx: number;
}

interface UserTableColumnDefinition {
  key: string;
  label: string;
  className: 'userColumn';
  canResize: true;
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
  stablizationUserColumns,
  onRemove,
  onTextChange,
  onCurrencyChange,
  onUserColumnChange,
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
      {stablizationUserColumns.map((stablizationUserColumn) => (
        <td key={stablizationUserColumn.id} className={styles.tableCell}>
          {renderUserColumnInput(stablizationUserColumn, row, rowNumber, onUserColumnChange)}
          {row.sourceJiraLinkedColumns.includes(stablizationUserColumn.id) && (
            <SourceJiraLink browseUrl={row.sourceJiraBrowseUrl} issueKey={row.sourceJiraIssueKey} />
          )}
        </td>
      ))}
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
  const {
    settings: businessHelperSettings,
    updateStablizationColumnWidth,
    updateUserColumnWidth,
  } = useBusinessHelperSettings();
  const stablizationFundingTable = useStablizationFundingTable(businessHelperSettings);
  const renderedTableColumns = useMemo(
    () => buildRenderedTableColumns(businessHelperSettings.stablizationUserColumns),
    [businessHelperSettings.stablizationUserColumns],
  );
  const [columnWidthsByKey, setColumnWidthsByKey] = useState(() => buildColumnWidthsByKey(businessHelperSettings));
  const totalTableWidthPx = calculateTotalTableWidth(renderedTableColumns, columnWidthsByKey);
  const columnWidthsRef = useRef(columnWidthsByKey);
  const resizeSessionRef = useRef<ColumnResizeSession | null>(null);
  columnWidthsRef.current = columnWidthsByKey;

  useEffect(() => {
    const nextColumnWidths = buildColumnWidthsByKey(businessHelperSettings);
    setColumnWidthsByKey((currentColumnWidths) => mergeColumnWidths(currentColumnWidths, nextColumnWidths));
  }, [businessHelperSettings]);

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

    if (isFixedStablizationColumnKey(resizeSession.columnKey)) {
      updateStablizationColumnWidth(
        resizeSession.columnKey,
        columnWidthsRef.current[resizeSession.columnKey],
      );
    } else {
      updateUserColumnWidth(
        resizeSession.columnKey,
        columnWidthsRef.current[resizeSession.columnKey],
      );
    }
    resizeSessionRef.current = null;
  }, [handleColumnResizeMove, updateStablizationColumnWidth, updateUserColumnWidth]);
  const handleBeginColumnResize = useCallback(
    (columnKey: string, startingClientX: number) => {
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
    (columnKey: string) => {
      const defaultColumnWidth = resolveDefaultColumnWidth(columnKey);
      const nextColumnWidths = {
        ...columnWidthsRef.current,
        [columnKey]: defaultColumnWidth,
      };
      columnWidthsRef.current = nextColumnWidths;
      setColumnWidthsByKey(nextColumnWidths);

      if (isFixedStablizationColumnKey(columnKey)) {
        updateStablizationColumnWidth(columnKey, defaultColumnWidth);
      } else {
        updateUserColumnWidth(columnKey, defaultColumnWidth);
      }
    },
    [updateStablizationColumnWidth, updateUserColumnWidth],
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
        <table
          className={styles.fundingTable}
          data-testid="business-helper-stablization-table"
          style={{ width: `${totalTableWidthPx}px` }}
        >
          <colgroup>
            {renderedTableColumns.map((tableColumn) => (
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
              {renderedTableColumns.map((tableColumn) => (
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
                        data-testid={`business-helper-resize-${tableColumn.key}`}
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
                onUserColumnChange={stablizationFundingTable.updateUserColumnValue}
                row={row}
                rowIndex={rowIndex}
                settingsByColumn={businessHelperSettings.stablizationColumns}
                stablizationUserColumns={businessHelperSettings.stablizationUserColumns}
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
              {businessHelperSettings.stablizationUserColumns.map((stablizationUserColumn) => (
                <td
                  key={stablizationUserColumn.id}
                  aria-label={`${stablizationUserColumn.label} footer total`}
                  className={styles.footerCell}
                >
                  {renderUserColumnFooterValue(
                    stablizationUserColumn,
                    stablizationFundingTable.totals.userColumnCurrencyTotals,
                  )}
                </td>
              ))}
              <td className={styles.footerCell}>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function renderUserColumnInput(
  stablizationUserColumn: StablizationUserColumn,
  row: StablizationFundingComputedRow,
  rowNumber: number,
  onUserColumnChange: (rowId: string, columnId: string, value: string) => void,
) {
  const ariaLabel = `${stablizationUserColumn.label} for row ${rowNumber}`;
  const inputValue = row.userColumnValues[stablizationUserColumn.id] ?? '';
  const handleChange = (nextValue: string) => onUserColumnChange(row.id, stablizationUserColumn.id, nextValue);

  if (stablizationUserColumn.dataType === 'currency') {
    return (
      <EditableCurrencyCell
        ariaLabel={ariaLabel}
        inputValue={inputValue}
        onChange={handleChange}
      />
    );
  }

  if (stablizationUserColumn.dataType === 'date') {
    return (
      <EditableDateCell
        ariaLabel={ariaLabel}
        inputValue={inputValue}
        onChange={handleChange}
      />
    );
  }

  return (
    <ConfiguredTextCell
      ariaLabel={ariaLabel}
      dropdownOptions={stablizationUserColumn.dropdownOptions}
      inputKind={resolveUserColumnInputKind(stablizationUserColumn.dataType)}
      inputValue={inputValue}
      onChange={handleChange}
    />
  );
}

function renderUserColumnFooterValue(
  stablizationUserColumn: StablizationUserColumn,
  userColumnCurrencyTotals: Record<string, number>,
) {
  if (stablizationUserColumn.dataType !== 'currency') {
    return '—';
  }

  return formatUsdCurrencyAmount(userColumnCurrencyTotals[stablizationUserColumn.id] ?? 0);
}

function resolveUserColumnInputKind(
  dataType: StablizationUserColumnDataType,
): StablizationColumnInputKind {
  return dataType === 'dropdown' ? 'dropdown' : 'text';
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
  return Math.min(
    MAX_STABLIZATION_COLUMN_WIDTH_PX,
    Math.max(MIN_STABLIZATION_COLUMN_WIDTH_PX, startingWidthPx + (currentClientX - startingClientX)),
  );
}

function calculateTotalTableWidth(
  renderedTableColumns: ReadonlyArray<(typeof FIXED_TABLE_COLUMNS)[number] | UserTableColumnDefinition>,
  columnWidthsByKey: Record<string, number>,
): number {
  return renderedTableColumns.reduce(
    (totalWidthPx, tableColumn) => totalWidthPx + columnWidthsByKey[tableColumn.key],
    0,
  );
}

function buildRenderedDropdownOptions(currentValue: string, dropdownOptions: string[]): string[] {
  if (!currentValue || dropdownOptions.includes(currentValue)) {
    return dropdownOptions;
  }

  return [currentValue, ...dropdownOptions];
}

function buildRenderedTableColumns(
  stablizationUserColumns: readonly StablizationUserColumn[],
): Array<(typeof FIXED_TABLE_COLUMNS)[number] | UserTableColumnDefinition> {
  const fixedColumnsBeforeActions = FIXED_TABLE_COLUMNS.filter((tableColumn) => tableColumn.key !== 'actions');
  const actionsColumn = FIXED_TABLE_COLUMNS.find((tableColumn) => tableColumn.key === 'actions');

  return [
    ...fixedColumnsBeforeActions,
    ...stablizationUserColumns.map<UserTableColumnDefinition>((stablizationUserColumn) => ({
      key: stablizationUserColumn.id,
      label: stablizationUserColumn.label,
      className: 'userColumn',
      canResize: true,
    })),
    ...(actionsColumn ? [actionsColumn] : []),
  ];
}

function buildColumnWidthsByKey(
  businessHelperSettings: BusinessHelperSettingsState,
): Record<string, number> {
  return {
    ...businessHelperSettings.stablizationColumnWidths,
    ...businessHelperSettings.stablizationUserColumns.reduce<Record<string, number>>(
      (columnWidths: Record<string, number>, stablizationUserColumn: StablizationUserColumn) => ({
        ...columnWidths,
        [stablizationUserColumn.id]: stablizationUserColumn.widthPx,
      }),
      {},
    ),
  };
}

function mergeColumnWidths(
  currentColumnWidths: Record<string, number>,
  nextColumnWidths: Record<string, number>,
): Record<string, number> {
  const mergedColumnWidths = Object.keys(nextColumnWidths).reduce<Record<string, number>>(
    (columnWidthsByKey, columnKey) => ({
      ...columnWidthsByKey,
      [columnKey]: currentColumnWidths[columnKey] ?? nextColumnWidths[columnKey],
    }),
    {},
  );

  return areColumnWidthMapsEqual(currentColumnWidths, mergedColumnWidths)
    ? currentColumnWidths
    : mergedColumnWidths;
}

function areColumnWidthMapsEqual(
  previousColumnWidths: Record<string, number>,
  nextColumnWidths: Record<string, number>,
): boolean {
  const previousColumnKeys = Object.keys(previousColumnWidths);
  const nextColumnKeys = Object.keys(nextColumnWidths);
  if (previousColumnKeys.length !== nextColumnKeys.length) {
    return false;
  }

  return previousColumnKeys.every((columnKey) => previousColumnWidths[columnKey] === nextColumnWidths[columnKey]);
}

function resolveDefaultColumnWidth(
  columnKey: string,
): number {
  if (isFixedStablizationColumnKey(columnKey)) {
    return DEFAULT_STABLIZATION_COLUMN_WIDTHS[columnKey];
  }

  return DEFAULT_STABLIZATION_USER_COLUMN_WIDTH_PX;
}

function isFixedStablizationColumnKey(columnKey: string): columnKey is StablizationTableColumn {
  return FIXED_TABLE_COLUMNS.some((tableColumn) => tableColumn.key === columnKey);
}
