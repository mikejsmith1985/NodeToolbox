// EpicChecklistTab.tsx — Checks an Epic against its own Definition of Ready / Definition of Done checklist and
// ticks the items it already satisfies.
//
// The shape of the screen follows what it is safe to do: read the Epic's checklist, have every open item judged
// with quoted evidence, show the PO exactly which ticks are proposed and on what grounds, and write only when
// they say so — in ONE save that rewrites the field with every other line untouched.
//
// Nothing here touches the shared checklist template the Epic was created from. Ticking an item on one Epic must
// never tick it for every Epic that shares the template.

import { useState } from 'react';

import PoAiPanel from '../ai/PoAiPanel.tsx';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import { jiraGet } from '../../../services/jiraApi.ts';
import {
  buildChecklistPrompt,
  listSatisfiedItemIds,
  parseChecklistIngest,
  type ChecklistVerdict,
} from './checklistAiAssist.ts';
import {
  fetchEpicChecklistSource,
  loadChecklistField,
  saveEpicChecklist,
  type EpicChecklistSource,
} from './checklistField.ts';
import {
  applyChecklistCompletions,
  countCompletedItems,
  listOpenItems,
  parseSmartChecklist,
  type ChecklistItem,
  type ParsedChecklist,
} from './smartChecklist.ts';
import styles from './EpicChecklistTab.module.css';

/** How many children to list as evidence. A long Epic's tail says nothing the first thirty do not. */
const MAX_CHILDREN_LISTED = 30;

/** What the screen is showing right now. */
interface LoadedEpic {
  source: EpicChecklistSource;
  checklist: ParsedChecklist;
  checklistFieldId: string;
  checklistFieldName: string;
  childSummaryLines: string[];
}

/** Reads the Epic's children as evidence lines, and says nothing rather than failing when it cannot. */
async function fetchChildSummaryLines(issueKey: string): Promise<string[]> {
  try {
    const searchResult = await jiraGet<{ issues?: Array<{ key: string; fields: Record<string, unknown> }> }>(
      `/rest/api/2/search?jql=${encodeURIComponent(`parent = ${issueKey} ORDER BY key ASC`)}`
        + `&fields=summary,status&maxResults=${MAX_CHILDREN_LISTED}`,
    );
    return (searchResult.issues ?? []).map((childIssue) => {
      const status = (childIssue.fields.status as { name?: string } | undefined)?.name ?? 'unknown';
      return `  ${childIssue.key} — ${status} — ${String(childIssue.fields.summary ?? '')}`;
    });
  } catch {
    // An instance that will not answer this query is not a reason to refuse the whole review.
    return [];
  }
}

/** The Product Owner's check of one Epic against the team's Definition of Ready and Done. */
export default function EpicChecklistTab() {
  const [issueKeyInput, setIssueKeyInput] = useState('');
  const [loadedEpic, setLoadedEpic] = useState<LoadedEpic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [verdictsByItemId, setVerdictsByItemId] = useState<Record<string, ChecklistVerdict>>({});
  const [itemIdsToTick, setItemIdsToTick] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const openItems = loadedEpic ? listOpenItems(loadedEpic.checklist) : [];
  const progress = loadedEpic ? countCompletedItems(loadedEpic.checklist) : { doneCount: 0, totalCount: 0 };

  /** Loads the Epic, its checklist field, and its children. */
  async function handleLoadEpic(): Promise<void> {
    const normalizedIssueKey = issueKeyInput.trim().toUpperCase();
    if (normalizedIssueKey === '') {
      setLoadError('Enter an Epic key, for example DENP-905.');
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setSaveMessage(null);
    setVerdictsByItemId({});
    setItemIdsToTick([]);

    try {
      const checklistField = await loadChecklistField();
      if (!checklistField.fieldId) {
        setLoadedEpic(null);
        setLoadError(
          'This Jira has no checklist field Toolbox can read, so there is nothing to check. '
          + 'Expected a field named Smart Checklist, Checklist Text, or Checklist.',
        );
        return;
      }

      const hygieneFieldConfig = await loadHygieneFieldConfig();
      const [acceptanceCriteriaFieldId] = hygieneFieldConfig.acceptanceCriteriaFieldIds;
      const source = await fetchEpicChecklistSource(
        normalizedIssueKey,
        checklistField.fieldId,
        acceptanceCriteriaFieldId ?? null,
      );

      setLoadedEpic({
        source,
        checklist: parseSmartChecklist(source.checklistText),
        checklistFieldId: checklistField.fieldId,
        checklistFieldName: checklistField.fieldName ?? checklistField.fieldId,
        childSummaryLines: await fetchChildSummaryLines(normalizedIssueKey),
      });
    } catch (unknownError) {
      setLoadedEpic(null);
      setLoadError(unknownError instanceof Error ? unknownError.message : `Could not load ${normalizedIssueKey}.`);
    } finally {
      setIsLoading(false);
    }
  }

  /** Takes the reviewed answer and pre-selects the items it says are satisfied. */
  function handleIngest(responseText: string): { acceptedCount: number; errors: string[] } {
    if (!loadedEpic) {
      return { acceptedCount: 0, errors: ['Load an Epic first.'] };
    }
    const { verdicts, errors } = parseChecklistIngest(responseText, openItems.map((item) => item.id));

    setVerdictsByItemId(Object.fromEntries(verdicts.map((verdict) => [verdict.itemId, verdict])));
    setItemIdsToTick(listSatisfiedItemIds(verdicts));
    setSaveMessage(null);

    return { acceptedCount: verdicts.length, errors };
  }

  /** Includes or excludes one proposed tick. The PO's judgement outranks the review. */
  function handleToggleItem(itemId: string): void {
    setItemIdsToTick((previousIds) => (
      previousIds.includes(itemId)
        ? previousIds.filter((selectedId) => selectedId !== itemId)
        : [...previousIds, itemId]
    ));
  }

  /** Writes the ticked checklist back in one save, then re-reads what Jira now holds. */
  async function handleApplyTicks(): Promise<void> {
    if (!loadedEpic || itemIdsToTick.length === 0) {
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const updatedChecklistText = applyChecklistCompletions(loadedEpic.checklist, itemIdsToTick);
      await saveEpicChecklist(loadedEpic.source.issueKey, loadedEpic.checklistFieldId, updatedChecklistText);

      const tickedCount = itemIdsToTick.length;
      setLoadedEpic({
        ...loadedEpic,
        source: { ...loadedEpic.source, checklistText: updatedChecklistText },
        checklist: parseSmartChecklist(updatedChecklistText),
      });
      setVerdictsByItemId({});
      setItemIdsToTick([]);
      setSaveMessage(`${tickedCount} item(s) ticked on ${loadedEpic.source.issueKey}.`);
    } catch (unknownError) {
      setSaveMessage(
        unknownError instanceof Error
          ? `Nothing was saved: ${unknownError.message}`
          : 'Nothing was saved. Jira refused the change.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  /** One checklist item as the review lists it: its words, what was found, and whether it will be ticked. */
  function renderReviewRow(item: ChecklistItem) {
    const verdict = verdictsByItemId[item.id];
    const isSelected = itemIdsToTick.includes(item.id);

    return (
      <li className={styles.reviewRow} key={item.id}>
        <label className={styles.reviewRowHeader}>
          <input
            aria-label={`Tick ${item.text}`}
            checked={isSelected}
            disabled={!verdict}
            onChange={() => handleToggleItem(item.id)}
            type="checkbox"
          />
          <span>{item.text}</span>
        </label>
        <p className={styles.reviewRowMeta}>
          {item.section === '' ? '' : `${item.section} · `}
          {verdict
            ? `${verdict.isSatisfied ? 'Satisfied' : 'Not yet'} — ${verdict.evidence}`
            : 'Not reviewed yet.'}
        </p>
      </li>
    );
  }

  return (
    <section className={styles.checklistTab}>
      <h3 className={styles.panelTitle}>Epic Checklist</h3>
      <p className={styles.panelHint}>
        Check an Epic against its own Definition of Ready and Definition of Done, then tick the items it already
        satisfies. Only this Epic&apos;s checklist is changed — the shared template it came from is never touched.
      </p>

      <div className={styles.loadBar}>
        <label className={styles.loadField}>
          <span className={styles.fieldLabel}>Epic key</span>
          <input
            aria-label="Epic key"
            className={styles.textInput}
            disabled={isLoading}
            onChange={(event) => setIssueKeyInput(event.target.value.toUpperCase())}
            placeholder="DENP-905"
            value={issueKeyInput}
          />
        </label>
        <button className={styles.primaryButton} disabled={isLoading} onClick={() => void handleLoadEpic()} type="button">
          {isLoading ? 'Loading…' : 'Load Epic'}
        </button>
      </div>

      {loadError ? <p className={styles.errorBanner} role="alert">{loadError}</p> : null}

      {loadedEpic ? (
        <>
          <div className={styles.epicSummary}>
            <strong>{`${loadedEpic.source.issueKey} — ${loadedEpic.source.summary}`}</strong>
            <span>{`${progress.doneCount} of ${progress.totalCount} checklist items done`}</span>
            <span>{`Read from “${loadedEpic.checklistFieldName}”`}</span>
          </div>

          {progress.totalCount === 0 ? (
            <p className={styles.panelHint}>
              This Epic has no checklist items yet. Apply your Definition of Ready or Done template to it in Jira
              first, then load it again.
            </p>
          ) : null}

          {openItems.length > 0 ? (
            <PoAiPanel
              buildPrompt={() => buildChecklistPrompt(loadedEpic.source, openItems, loadedEpic.childSummaryLines)}
              helpText={
                'Each item comes back with the words in the Epic that satisfy it. Nothing is written to Jira until '
                + 'you choose to tick the items below.'
              }
              onIngest={handleIngest}
              title="Check this Epic against its checklist"
            />
          ) : (
            <p className={styles.panelHint}>Every checklist item on this Epic is already ticked.</p>
          )}

          {openItems.length > 0 ? (
            <>
              <h4 className={styles.panelTitle}>{`Open items (${openItems.length})`}</h4>
              <ul className={styles.reviewList}>{openItems.map(renderReviewRow)}</ul>
              <div className={styles.applyRow}>
                <button
                  className={styles.primaryButton}
                  disabled={itemIdsToTick.length === 0 || isSaving}
                  onClick={() => void handleApplyTicks()}
                  type="button"
                >
                  {isSaving ? 'Saving…' : `Tick ${itemIdsToTick.length} item(s) on ${loadedEpic.source.issueKey}`}
                </button>
              </div>
            </>
          ) : null}

          {saveMessage ? <p className={styles.infoBanner} role="status">{saveMessage}</p> : null}
        </>
      ) : null}
    </section>
  );
}
