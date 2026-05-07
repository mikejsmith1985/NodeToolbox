// ImpactAnalysisView.tsx — Standalone Jira blast-radius view for issue links and Epic children.
//
// This ports the legacy ToolBox impact concept into a focused React workflow: users enter
// one issue key, then review linked work and child issues that could be affected by change.

import { type KeyboardEvent } from 'react';

import { useImpactAnalysisState, type RootIssue, type UseImpactAnalysisState } from './hooks/useImpactAnalysisState.ts';
import type { BlastChild, BlastLink } from './utils/blastRadius.ts';
import styles from './ImpactAnalysisView.module.css';

const VIEW_TITLE = 'Impact Analysis';
const VIEW_SUBTITLE = 'Inspect a Jira issue blast radius across links, blockers, and Epic children.';
const ISSUE_KEY_PLACEHOLDER = 'PROJ-123';
const EMPTY_STATE_MESSAGE = 'Enter an issue key to analyze its blast radius.';
const LOADING_MESSAGE = 'Loading Impact Analysis…';
const NO_ASSIGNEE_LABEL = 'Unassigned';
const NO_LINKS_MESSAGE = 'No links found.';
const NO_CHILDREN_MESSAGE = 'No Epic children found.';
const ENTER_KEY = 'Enter';

/** Renders the Impact Analysis view and delegates Jira state to `useImpactAnalysisState`. */
export default function ImpactAnalysisView() {
  const impactState = useImpactAnalysisState();
  const hasRootIssue = impactState.root !== null;
  const shouldShowEmptyState = !impactState.isLoading && !hasRootIssue && impactState.errorMessage === null;

  function handleSearch(): void {
    void impactState.search();
  }

  function handleInputKeyDown(keyboardEvent: KeyboardEvent<HTMLInputElement>): void {
    if (keyboardEvent.key === ENTER_KEY) handleSearch();
  }

  return (
    <section className={styles.impactAnalysisView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsPanel}>
        <label className={styles.fieldLabel}>
          Issue key
          <input
            className={styles.textInput}
            aria-label="Issue key"
            placeholder={ISSUE_KEY_PLACEHOLDER}
            value={impactState.issueKey}
            onChange={(changeEvent) => impactState.setIssueKey(changeEvent.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </label>
        <button type="button" className={styles.buttonPrimary} disabled={impactState.isLoading} onClick={handleSearch}>
          {impactState.isLoading ? 'Loading…' : 'Search'}
        </button>
      </div>

      {impactState.errorMessage && <p className={styles.errorMessage} role="alert">⚠ {impactState.errorMessage}</p>}
      {impactState.isLoading && <div className={styles.emptyState}>{LOADING_MESSAGE}</div>}
      {shouldShowEmptyState && <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>}

      {!impactState.isLoading && hasRootIssue && renderResults(impactState.root, impactState)}
    </section>
  );
}

function renderResults(rootIssue: RootIssue | null, impactState: UseImpactAnalysisState) {
  if (rootIssue === null) return null;

  return (
    <div className={styles.resultsStack}>
      {renderRootCard(rootIssue)}
      {renderLinkGroup('Outward links', impactState.outward)}
      {renderLinkGroup('Inward links', impactState.inward)}
      {rootIssue.isEpic && renderChildrenGroup(impactState.children)}
      <footer className={styles.statsFooter} aria-label="Impact stats">
        {renderStat('Total related', impactState.stats.totalRelated)}
        {renderStat('Blockers', impactState.stats.blockerCount)}
        {renderStat('Open', impactState.stats.openCount)}
        {renderStat('Done', impactState.stats.doneCount)}
      </footer>
    </div>
  );
}

function renderRootCard(rootIssue: RootIssue) {
  return (
    <article className={styles.rootCard} aria-label="Root issue">
      <div className={styles.rootHeader}>
        <span className={styles.issueKey}>{rootIssue.key}</span>
        <span className={styles.statusPill}>{rootIssue.statusName}</span>
      </div>
      <h2 className={styles.issueSummary}>{rootIssue.summary}</h2>
      <dl className={styles.metaGrid}>
        {renderMetaItem('Type', rootIssue.typeName)}
        {renderMetaItem('Priority', rootIssue.priorityName)}
        {renderMetaItem('Assignee', rootIssue.assigneeName ?? NO_ASSIGNEE_LABEL)}
      </dl>
    </article>
  );
}

function renderLinkGroup(title: string, links: BlastLink[]) {
  return (
    <section className={styles.groupCard} aria-label={title}>
      <h2 className={styles.groupTitle}>{title}</h2>
      {links.length === 0 ? <p className={styles.mutedText}>{NO_LINKS_MESSAGE}</p> : <ul className={styles.relatedList}>{links.map(renderLinkItem)}</ul>}
    </section>
  );
}

function renderLinkItem(link: BlastLink) {
  return (
    <li key={`${link.direction}-${link.linkType}-${link.related.key}`} className={styles.relatedItem}>
      <span>{link.linkType}: {link.related.key} - {link.related.summary} </span>
      <span className={styles.statusPill}>[{link.related.statusName}]</span>
    </li>
  );
}

function renderChildrenGroup(children: BlastChild[]) {
  return (
    <section className={styles.groupCard} aria-label="Children">
      <h2 className={styles.groupTitle}>Children</h2>
      {children.length === 0 ? <p className={styles.mutedText}>{NO_CHILDREN_MESSAGE}</p> : <ul className={styles.relatedList}>{children.map(renderChildItem)}</ul>}
    </section>
  );
}

function renderChildItem(childIssue: BlastChild) {
  return (
    <li key={childIssue.key} className={styles.relatedItem}>
      <span>{childIssue.key} - {childIssue.summary}</span>
      <span className={styles.statusPill}>{childIssue.statusName}</span>
    </li>
  );
}

function renderStat(label: string, value: number) {
  return (
    <div className={styles.statTile}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function renderMetaItem(label: string, value: string) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
