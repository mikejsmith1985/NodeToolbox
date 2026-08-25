// ConfluenceDocLinksPanel.tsx — Setting up and running the Confluence-to-Jira documentation link.
//
// The test scenarios live in a Confluence tree filed at Feature level; the work that runs them lives
// on SL stories. This panel crawls the tree, shows exactly what it WOULD link, and writes only when
// somebody presses the button that says so.
//
// Scan and apply are deliberately two actions. A scan writes nothing, so it can be run freely; the
// apply walks the plan the scan produced, which is what makes "what you approved is what happens"
// structural rather than a promise.

import { useEffect, useState } from 'react';

import { buildJiraBrowseUrl } from '../../../utils/jiraBrowseUrl.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import {
  createSlStoryFromDevStory,
  previewSlStorySummary,
  scanForDocLinks,
  writeDocLink,
} from './docLinkRunner.ts';
import type { DocLinkPlan, DocLinkPlanRow } from './docLinkPlan.ts';
import { readDocLinkSettings, saveDocLinkSettings, type DocLinkSettings } from './docLinkSettings.ts';
import styles from '../AdminHubView.module.css';

/** Plain-English names for each outcome, so a row explains itself without a legend. */
const OUTCOME_LABELS: Record<DocLinkPlanRow['route']['outcome'], string> = {
  'linked-directly': 'links to the issue in its title',
  'routed-to-sl-story': 'links to the Feature-s SL story',
  'no-sl-story': 'no SL story yet',
  'several-sl-stories': 'several SL stories — pick one',
  'feature-has-no-children': 'the Feature has no stories yet',
  'no-key-in-title': 'the title names no issue',
};

/** One editable setting, so the six of them read as one thing rather than six copies of a div. */
function SettingField({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (nextValue: string) => void;
}) {
  return (
    <label className={styles.fieldLabel}>
      {label}
      <input
        className={styles.inputField}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  );
}

/** The counts, said in words rather than left as a table to interpret. */
function PlanSummary({ plan }: { plan: DocLinkPlan }) {
  return (
    <>
      <p className={styles.panelStatusLine} role="status">
        {`${plan.rows.length} page(s) found. ${plan.linkableCount} would be linked, `
          + `${plan.needsDecisionCount} need a decision, ${plan.untaggedCount} name no issue.`}
      </p>
      {plan.isTruncated && (
        <p className={styles.panelStatusLine} role="status">
          The crawl hit its ceiling, so every count above is a floor — there are more pages than this.
        </p>
      )}
    </>
  );
}

export function ConfluenceDocLinksPanel() {
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? null);
  const [settings, setSettings] = useState<DocLinkSettings>(() => readDocLinkSettings());
  const [plan, setPlan] = useState<DocLinkPlan | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [createdStoryKeys, setCreatedStoryKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    saveDocLinkSettings(settings);
  }, [settings]);

  function updateSetting(fieldName: keyof DocLinkSettings, nextValue: string): void {
    setSettings((currentSettings) => ({ ...currentSettings, [fieldName]: nextValue }));
    // A stale plan beside changed settings would be read as the plan for those settings.
    setPlan(null);
  }

  async function runScan(): Promise<void> {
    setIsScanning(true);
    setFailureReason(null);
    setStatusLine(null);
    setPlan(null);
    try {
      const outcome = await scanForDocLinks({
        spaceKey: settings.spaceKey,
        rootPageTitle: settings.rootPageTitle,
        featureProjectKeys: settings.featureProjectKeys.split(',').map((key) => key.trim()).filter(Boolean),
        featureLinkFieldId: settings.featureLinkFieldName,
      });
      setPlan(outcome.plan);
      setFailureReason(outcome.failureReason);
    } catch (caughtError) {
      setFailureReason(caughtError instanceof Error ? caughtError.message : 'The scan failed.');
    } finally {
      setIsScanning(false);
    }
  }

  /** Writes every link the plan says it would. Nothing else — creates stay one click at a time. */
  async function applyLinks(): Promise<void> {
    if (plan === null) return;
    setIsApplying(true);
    const actionableRows = plan.rows.filter((row) => row.isActionable);
    let writtenCount = 0;
    const failures: string[] = [];

    for (const row of actionableRows) {
      try {
        await writeDocLink(row.route.targetIssueKey as string, row.pageTitle, row.pageUrl, row.pageId);
        writtenCount += 1;
      } catch (caughtError) {
        failures.push(`${row.route.targetIssueKey}: ${caughtError instanceof Error ? caughtError.message : 'failed'}`);
      }
    }

    setStatusLine(`Linked ${writtenCount} of ${actionableRows.length}.`
      + (failures.length > 0 ? ` Failed: ${failures.join('; ')}` : ''));
    setIsApplying(false);
  }

  /** Creates one SL story from the dev story a row named, one deliberate click at a time. */
  async function createSlStory(row: DocLinkPlanRow): Promise<void> {
    const devStoryKey = row.route.cloneSourceIssueKey;
    if (devStoryKey === null) return;
    try {
      const outcome = await createSlStoryFromDevStory({
        devStoryKey,
        devStorySummary: row.pageTitle,
        projectKey: settings.storyProjectKey,
        issueTypeId: settings.storyIssueTypeId,
        containmentLinkTypeName: settings.containmentLinkTypeName,
      });
      setCreatedStoryKeys((current) => ({ ...current, [row.pageId]: outcome.slStoryKey }));
      setStatusLine(outcome.linkError === null
        ? `Created ${outcome.slStoryKey}. Re-scan to link the page to it.`
        : `Created ${outcome.slStoryKey}, but the containment link failed: ${outcome.linkError}`);
    } catch (caughtError) {
      setStatusLine(caughtError instanceof Error ? caughtError.message : 'Could not create the story.');
    }
  }

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>Confluence test documentation → Jira</h3>
      <p className={styles.panelStatusLine}>
        Crawls a Confluence page tree and links each page to the issue it documents. Pages filed
        under a Feature are routed to that Feature&apos;s SL story, because that is the work that
        runs the scenarios. Scanning writes nothing.
      </p>

      <div className={styles.panelSection}>
        <SettingField
          label="Confluence space key"
          onChange={(nextValue) => updateSetting('spaceKey', nextValue)}
          placeholder="MAVertical"
          value={settings.spaceKey}
        />
        <SettingField
          label="Root page title"
          onChange={(nextValue) => updateSetting('rootPageTitle', nextValue)}
          placeholder="ENCUC: CleanUpCrew: SF Integration"
          value={settings.rootPageTitle}
        />
        <SettingField
          label="Feature project keys (comma separated)"
          onChange={(nextValue) => updateSetting('featureProjectKeys', nextValue)}
          placeholder="DENP"
          value={settings.featureProjectKeys}
        />
        <SettingField
          label="Feature Link field name"
          onChange={(nextValue) => updateSetting('featureLinkFieldName', nextValue)}
          placeholder="Feature Link"
          value={settings.featureLinkFieldName}
        />
        <SettingField
          label="Story project key (for created SL stories)"
          onChange={(nextValue) => updateSetting('storyProjectKey', nextValue)}
          placeholder="ENCUC"
          value={settings.storyProjectKey}
        />
        <SettingField
          label="Story issue type id"
          onChange={(nextValue) => updateSetting('storyIssueTypeId', nextValue)}
          placeholder="10001"
          value={settings.storyIssueTypeId}
        />
        <SettingField
          label="Containment link type name"
          onChange={(nextValue) => updateSetting('containmentLinkTypeName', nextValue)}
          placeholder="Container"
          value={settings.containmentLinkTypeName}
        />
      </div>

      <div className={styles.panelActions}>
        <button className={styles.actionButton} disabled={isScanning} onClick={() => void runScan()} type="button">
          {isScanning ? 'Scanning…' : '🔎 Scan (writes nothing)'}
        </button>
        {plan !== null && plan.linkableCount > 0 && (
          <button
            className={styles.actionButton}
            disabled={isApplying}
            onClick={() => void applyLinks()}
            type="button"
          >
            {isApplying ? 'Linking…' : `🔗 Link ${plan.linkableCount} page(s)`}
          </button>
        )}
      </div>

      {failureReason !== null && <p className={styles.panelStatusLine} role="alert">{failureReason}</p>}
      {statusLine !== null && <p className={styles.panelStatusLine} role="status">{statusLine}</p>}
      {plan !== null && <PlanSummary plan={plan} />}

      {plan !== null && plan.rows.length > 0 && (
        <table className={styles.installationsTable}>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">What happens</th>
              <th scope="col">Target</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr key={row.pageId}>
                <td>
                  <a href={row.pageUrl} rel="noreferrer" target="_blank">{row.pageTitle}</a>
                </td>
                <td title={row.route.reason}>{OUTCOME_LABELS[row.route.outcome]}</td>
                <td>
                  {row.route.targetIssueKey === null ? '—' : (
                    <a
                      href={buildJiraBrowseUrl(row.route.targetIssueKey, jiraBaseUrl ?? '')}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {row.route.targetIssueKey}
                    </a>
                  )}
                </td>
                <td>
                  {/* One click, one story. A scheduled bulk create is the thing that frightens
                      people, so creating stays deliberate and per row. */}
                  {row.route.outcome === 'no-sl-story' && row.route.cloneSourceIssueKey !== null && (
                    createdStoryKeys[row.pageId] !== undefined
                      ? <span>{`created ${createdStoryKeys[row.pageId]}`}</span>
                      : (
                        <button
                          className={styles.actionButton}
                          onClick={() => void createSlStory(row)}
                          title={`Clones ${row.route.cloneSourceIssueKey} as "${previewSlStorySummary(row.pageTitle)}"`}
                          type="button"
                        >
                          {`Create SL story from ${row.route.cloneSourceIssueKey}`}
                        </button>
                      )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
