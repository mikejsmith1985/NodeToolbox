// SimpleSearchTab.tsx — Guided Jira keyword search tab for business users who should not write JQL.

import type { FormEvent } from 'react';
import { Fragment, useMemo, useState } from 'react';

import { useToast } from '../../../components/Toast/ToastContext.ts';
import { appendSimpleSearchResultToStablization } from '../hooks/useStablizationFundingTable.ts';
import type {
  SimpleSearchHierarchyLevel,
  SimpleSearchIssueDetail,
  SimpleSearchMatchLocation,
  SimpleSearchRelationshipIssue,
  SimpleSearchResult,
  SimpleSearchSortOption,
} from '../hooks/useSimpleSearchState.ts';
import { useSimpleSearchState } from '../hooks/useSimpleSearchState.ts';
import styles from './SimpleSearchTab.module.css';

const TAB_TITLE = 'Simple Search';
const TAB_SUBTITLE =
  'Search Jira with a plain keyword while Toolbox writes the hidden Jira query behind the scenes.';
const KEYWORD_PLACEHOLDER = 'Enter a business keyword';
const EMPTY_STATE_MESSAGE =
  'Enter a keyword and run the search to look across all accessible Jira projects.';
const EMPTY_RESULT_MESSAGE = 'No matching issues were found for the current keyword.';
const TABLE_COLUMN_LABELS = ['Key', 'Summary', 'Match', 'Type', 'Status', 'Assignee', 'Updated', 'Actions'];
const GROUP_ORDER: SimpleSearchHierarchyLevel[] = ['portfolio', 'art', 'team'];
const GROUP_LABELS: Record<SimpleSearchHierarchyLevel, string> = {
  portfolio: 'Portfolio',
  art: 'ART',
  team: 'Team',
};
const SORT_OPTIONS: Array<{ value: SimpleSearchSortOption; label: string }> = [
  { value: 'summary-first', label: 'Keyword in Summary first' },
  { value: 'description-first', label: 'Keyword in Description first' },
  { value: 'updated-desc', label: 'Last updated' },
  { value: 'created-desc', label: 'Created date' },
  { value: 'key-asc', label: 'Issue key' },
];
const NO_VALUE_LABEL = '—';
const JIRA_BROWSE_PREFIX = '/browse/';
const CHILD_SECTION_TITLE = 'Child Records';
const LINKED_SECTION_TITLE = 'Linked Issues';
const SEND_TO_STABLIZATION_BUTTON_LABEL = 'Send to Stablization';
const SEND_TO_STABLIZATION_EMPTY_MAPPING_MESSAGE =
  'No Stablization mapping could be applied. Review the Business Helper Settings tab.';

interface SearchResultGroup {
  hierarchyLevel: SimpleSearchHierarchyLevel;
  label: string;
  results: SimpleSearchResult[];
}

function formatMatchLocationLabel(matchLocation: SimpleSearchMatchLocation): string {
  if (matchLocation === 'summary-description') {
    return 'Summary + Description';
  }

  if (matchLocation === 'summary') {
    return 'Summary';
  }

  if (matchLocation === 'description') {
    return 'Description';
  }

  return 'Jira text match';
}

function formatDateLabel(dateText: string): string {
  return dateText ? dateText.slice(0, 10) : NO_VALUE_LABEL;
}

function buildBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_PREFIX}${encodeURIComponent(issueKey)}`;
}

function formatColumnLabelList(columnLabels: string[]): string {
  if (columnLabels.length <= 1) {
    return columnLabels[0] ?? '';
  }

  if (columnLabels.length === 2) {
    return `${columnLabels[0]} and ${columnLabels[1]}`;
  }

  return `${columnLabels.slice(0, -1).join(', ')}, and ${columnLabels[columnLabels.length - 1]}`;
}

function groupSearchResults(searchResults: SimpleSearchResult[]): SearchResultGroup[] {
  return GROUP_ORDER.flatMap((hierarchyLevel) => {
    const groupedResults = searchResults.filter((searchResult) => searchResult.hierarchyLevel === hierarchyLevel);
    if (groupedResults.length === 0) {
      return [];
    }

    return [
      {
        hierarchyLevel,
        label: GROUP_LABELS[hierarchyLevel],
        results: groupedResults,
      },
    ];
  });
}

function renderRelationshipIssue(
  relationshipIssue: SimpleSearchRelationshipIssue,
  relationshipClassName: string,
  relationshipDetail: SimpleSearchIssueDetail | undefined,
  isRelationshipDetailLoading: boolean,
  relationshipDetailError: string | undefined,
  isRelationshipExpanded: boolean,
  onToggleRelationshipDetail: (issueKey: string) => void,
) {
  return (
    <li key={relationshipIssue.key} className={styles.relationshipItem}>
      <div className={styles.relationshipRow}>
        <span className={`${styles.relationshipBadge} ${relationshipClassName}`}>
          {relationshipIssue.relationshipLabel}
        </span>
        <button
          aria-expanded={isRelationshipExpanded}
          aria-label={`Toggle description for ${relationshipIssue.key}`}
          className={styles.relationshipExpandButton}
          onClick={() => onToggleRelationshipDetail(relationshipIssue.key)}
          type="button"
        >
          <span className={styles.expandIcon}>{isRelationshipExpanded ? '▼' : '▶'}</span>
          <span className={styles.relationshipKey}>{relationshipIssue.key}</span>
        </button>
        <a
          aria-label={`Open ${relationshipIssue.key} in Jira`}
          className={styles.relationshipBrowseLink}
          href={buildBrowseUrl(relationshipIssue.key)}
          rel="noreferrer"
          target="_blank"
        >
          Open
        </a>
        <span className={styles.relationshipSummary}>{relationshipIssue.summary || NO_VALUE_LABEL}</span>
        <span className={styles.relationshipMeta}>
          {relationshipIssue.issueType || NO_VALUE_LABEL} · {relationshipIssue.status || NO_VALUE_LABEL}
        </span>
      </div>
      {isRelationshipExpanded && (
        <div className={styles.relationshipDetailPanel}>
          {isRelationshipDetailLoading && (
            <p className={styles.relationshipEmptyState} role="status">
              Loading description…
            </p>
          )}
          {!isRelationshipDetailLoading && relationshipDetailError && (
            <p className={styles.errorMessage} role="alert">
              ⚠ {relationshipDetailError}
            </p>
          )}
          {!isRelationshipDetailLoading && !relationshipDetailError && (
            <p className={styles.relationshipDescription}>
              {relationshipDetail?.description || 'No description available.'}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function renderRelationshipSection(
  sectionTitle: string,
  relationshipIssues: SimpleSearchRelationshipIssue[],
  relationshipClassName: string,
  sectionClassName: string,
  detailByIssueKey: Record<string, SimpleSearchIssueDetail | undefined>,
  detailErrorByIssueKey: Record<string, string | undefined>,
  loadingDetailKeys: readonly string[],
  expandedRelationshipIssueKeys: readonly string[],
  onToggleRelationshipDetail: (issueKey: string) => void,
) {
  return (
    <section className={`${styles.relationshipSection} ${sectionClassName}`} aria-label={sectionTitle}>
      <div className={styles.relationshipHeader}>
        <h4 className={styles.relationshipTitle}>{sectionTitle}</h4>
        <span className={styles.infoBadge}>{relationshipIssues.length}</span>
      </div>
      {relationshipIssues.length === 0 ? (
        <p className={styles.relationshipEmptyState}>No records found.</p>
      ) : (
        <ul className={styles.relationshipList}>
          {relationshipIssues.map((relationshipIssue) =>
            renderRelationshipIssue(
              relationshipIssue,
              relationshipClassName,
              detailByIssueKey[relationshipIssue.key],
              loadingDetailKeys.includes(relationshipIssue.key),
              detailErrorByIssueKey[relationshipIssue.key],
              expandedRelationshipIssueKeys.includes(relationshipIssue.key),
              onToggleRelationshipDetail,
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function renderDetailPanel(
  issueDetail: SimpleSearchIssueDetail,
  detailByIssueKey: Record<string, SimpleSearchIssueDetail | undefined>,
  detailErrorByIssueKey: Record<string, string | undefined>,
  loadingDetailKeys: readonly string[],
  expandedRelationshipIssueKeys: readonly string[],
  onToggleRelationshipDetail: (issueKey: string) => void,
) {
  return (
    <div className={styles.detailPanel}>
      <section className={styles.descriptionSection} aria-label="Description">
        <h4 className={styles.relationshipTitle}>Description</h4>
        <p className={styles.descriptionText}>{issueDetail.description || 'No description available.'}</p>
      </section>
      <div className={styles.relationshipGrid}>
        {renderRelationshipSection(
          CHILD_SECTION_TITLE,
          issueDetail.childIssues,
          styles.childBadge,
          styles.childSection,
          detailByIssueKey,
          detailErrorByIssueKey,
          loadingDetailKeys,
          expandedRelationshipIssueKeys,
          onToggleRelationshipDetail,
        )}
        {renderRelationshipSection(
          LINKED_SECTION_TITLE,
          issueDetail.linkedIssues,
          styles.linkedBadge,
          styles.linkedSection,
          detailByIssueKey,
          detailErrorByIssueKey,
          loadingDetailKeys,
          expandedRelationshipIssueKeys,
          onToggleRelationshipDetail,
        )}
      </div>
    </div>
  );
}

/** Renders the business-friendly Jira keyword search tab while keeping the underlying JQL hidden. */
export default function SimpleSearchTab() {
  const simpleSearchState = useSimpleSearchState();
  const { showToast } = useToast();
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [expandedRelationshipIssueKeys, setExpandedRelationshipIssueKeys] = useState<string[]>([]);
  const groupedResults = useMemo(
    () => groupSearchResults(simpleSearchState.results),
    [simpleSearchState.results],
  );

  function handleSubmit(searchEvent: FormEvent<HTMLFormElement>) {
    searchEvent.preventDefault();
    void simpleSearchState.runSearch();
  }

  function handleToggleDetails(issueKey: string): void {
    const isExpandingIssue = expandedIssueKey !== issueKey;
    setExpandedIssueKey(isExpandingIssue ? issueKey : null);
    setExpandedRelationshipIssueKeys([]);

    if (
      isExpandingIssue
      && !simpleSearchState.detailByIssueKey[issueKey]
      && !simpleSearchState.loadingDetailKeys.includes(issueKey)
    ) {
      void simpleSearchState.loadIssueDetail(issueKey);
    }
  }

  function handleToggleRelationshipDetail(issueKey: string): void {
    const isExpandingRelationshipIssue = !expandedRelationshipIssueKeys.includes(issueKey);
    setExpandedRelationshipIssueKeys((currentIssueKeys) =>
      isExpandingRelationshipIssue
        ? [...currentIssueKeys, issueKey]
        : currentIssueKeys.filter((expandedIssueKeyValue) => expandedIssueKeyValue !== issueKey),
    );

    if (
      isExpandingRelationshipIssue
      && !simpleSearchState.detailByIssueKey[issueKey]
      && !simpleSearchState.loadingDetailKeys.includes(issueKey)
    ) {
      void simpleSearchState.loadIssueDetail(issueKey);
    }
  }

  function handleSendToStablization(searchResult: SimpleSearchResult): void {
    const transferResult = appendSimpleSearchResultToStablization(searchResult);
    if (!transferResult.didCreateRow) {
      showToast(SEND_TO_STABLIZATION_EMPTY_MAPPING_MESSAGE, 'warning');
      return;
    }

    const successMessage = `Added ${searchResult.key} to Stablization using ${formatColumnLabelList(transferResult.appliedColumnLabels)}.`;
    if (transferResult.skippedColumnLabels.length > 0) {
      showToast(
        `${successMessage} ${formatColumnLabelList(transferResult.skippedColumnLabels)} were skipped because the dropdown list does not include that value.`,
        'warning',
      );
      return;
    }

    showToast(successMessage, 'success');
  }

  return (
    <section className={styles.simpleSearchTab} aria-label={TAB_TITLE}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{TAB_TITLE}</h2>
        <p className={styles.sectionSubtitle}>{TAB_SUBTITLE}</p>
      </header>

      <form className={styles.controlsPanel} onSubmit={handleSubmit}>
        <label className={styles.controlGroup}>
          Keyword
          <input
            aria-label="Search keyword"
            className={styles.controlInput}
            onChange={(changeEvent) => simpleSearchState.setKeyword(changeEvent.target.value)}
            placeholder={KEYWORD_PLACEHOLDER}
            type="text"
            value={simpleSearchState.keyword}
          />
        </label>

        <label className={styles.controlGroup}>
          Sort results
          <select
            aria-label="Sort results"
            className={styles.controlSelect}
            onChange={(changeEvent) =>
              simpleSearchState.setSortOption(changeEvent.target.value as SimpleSearchSortOption)
            }
            value={simpleSearchState.sortOption}
          >
            {SORT_OPTIONS.map((sortOption) => (
              <option key={sortOption.value} value={sortOption.value}>
                {sortOption.label}
              </option>
            ))}
          </select>
        </label>

        <button className={styles.buttonPrimary} disabled={simpleSearchState.isLoading} type="submit">
          {simpleSearchState.isLoading ? 'Searching…' : 'Run search'}
        </button>
      </form>

      <div className={styles.summaryBar} aria-live="polite">
        {simpleSearchState.hasSearched
          ? `Showing ${simpleSearchState.results.length} of ${simpleSearchState.rawResultCount} matching issues across ${groupedResults.length} Jira levels`
          : 'Search runs across all accessible Jira projects without exposing JQL to the user.'}
      </div>

      {simpleSearchState.isLoading && (
        <p className={styles.statusMessage} role="status">
          Searching Jira…
        </p>
      )}

      {simpleSearchState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {simpleSearchState.errorMessage}
        </p>
      )}

      {groupedResults.length > 0 ? (
        <div className={styles.groupStack}>
          {groupedResults.map((resultGroup) => (
            <section key={resultGroup.hierarchyLevel} className={styles.groupCard} aria-label={`${resultGroup.label} results`}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>{resultGroup.label}</h3>
                <span className={styles.infoBadge}>{resultGroup.results.length} issues</span>
              </div>

              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr className={styles.tableHeader}>
                      {TABLE_COLUMN_LABELS.map((columnLabel) => (
                        <th key={columnLabel}>{columnLabel}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultGroup.results.map((searchResult) => {
                      const isExpanded = expandedIssueKey === searchResult.key;
                      const detailPanelId = `simple-search-detail-${searchResult.key}`;
                      const issueDetail = simpleSearchState.detailByIssueKey[searchResult.key];
                      const detailError = simpleSearchState.detailErrorByIssueKey[searchResult.key];
                      const isLoadingDetail = simpleSearchState.loadingDetailKeys.includes(searchResult.key);

                      return (
                        <Fragment key={searchResult.key}>
                          <tr
                            className={`${styles.tableRow} ${isExpanded ? styles.tableRowExpanded : ''}`}
                          >
                            <td className={styles.cellMonospace}>
                              <button
                                aria-controls={detailPanelId}
                                aria-expanded={isExpanded}
                                aria-label={`Toggle details for ${searchResult.key}`}
                                className={styles.expandButton}
                                onClick={() => handleToggleDetails(searchResult.key)}
                                type="button"
                              >
                                <span className={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</span>
                                <span>{searchResult.key}</span>
                              </button>
                            </td>
                            <td className={styles.cellSummary} title={searchResult.summary}>
                              {searchResult.summary}
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.infoBadge}>
                                {formatMatchLocationLabel(searchResult.matchLocation)}
                              </span>
                            </td>
                            <td className={styles.tableCell}>{searchResult.issueType || NO_VALUE_LABEL}</td>
                            <td className={styles.tableCell}>{searchResult.status || NO_VALUE_LABEL}</td>
                            <td className={styles.tableCell}>{searchResult.assigneeName || NO_VALUE_LABEL}</td>
                            <td className={styles.tableCell}>{formatDateLabel(searchResult.updated)}</td>
                            <td className={styles.tableCell}>
                              <button
                                aria-label={`Send ${searchResult.key} to Stablization`}
                                className={styles.rowActionButton}
                                onClick={() => handleSendToStablization(searchResult)}
                                type="button"
                              >
                                {SEND_TO_STABLIZATION_BUTTON_LABEL}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={styles.detailRow}>
                              <td className={styles.detailCell} colSpan={TABLE_COLUMN_LABELS.length} id={detailPanelId}>
                                {isLoadingDetail && (
                                  <p className={styles.statusMessage} role="status">
                                    Loading issue detail…
                                  </p>
                                )}
                                {!isLoadingDetail && detailError && (
                                  <p className={styles.errorMessage} role="alert">
                                    ⚠ {detailError}
                                  </p>
                                )}
                                {!isLoadingDetail && !detailError && issueDetail && renderDetailPanel(
                                  issueDetail,
                                  simpleSearchState.detailByIssueKey,
                                  simpleSearchState.detailErrorByIssueKey,
                                  simpleSearchState.loadingDetailKeys,
                                  expandedRelationshipIssueKeys,
                                  handleToggleRelationshipDetail,
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <td className={styles.emptyState} colSpan={TABLE_COLUMN_LABELS.length}>
                  {simpleSearchState.hasSearched ? EMPTY_RESULT_MESSAGE : EMPTY_STATE_MESSAGE}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
