// PiDeliveryPlanTab.tsx — The PI Delivery Planner tab (spec 032, US1). Drives the full propose-only pipeline:
// load committed Features → assemble the deterministic PI Planning Fact Sheet → generate ONE AI prompt →
// paste the reply → ingest (allowlist-rejecting unknown repos/keys) → build the delivery plan (repo→sub-task
// with parallel per-repo assignment and rule-derived dates) → flag bottlenecks → per-item accept writes.
// All dates/capacity/assignment/bottlenecks are engine-computed; nothing is trusted from the AI reply.

import { useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { getComponentKind } from '../AdminHub/lib/componentClassificationStore.ts';
import { useStandupRosterStore } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { buildDirectFeatureJql, readPiReviewPullSettings } from './piReviewPullFeatures.ts';
import { assembleFactSheet } from './piPlan/piPlanFactSheet.ts';
import { buildDeliveryPlanPrompt } from './piPlan/ai/deliveryPlanPrompt.ts';
import { parseDeliveryPlanReply } from './piPlan/ai/deliveryPlanIngest.ts';
import { buildDeliveryPlan, type AcceptedStory, type DeliveryPlan, type PlannedStory } from './piPlan/piDeliveryEngine.ts';
import { detectBottlenecks, attachMitigations } from './piPlan/piPlanBottlenecks.ts';
import { applyDeliveryStory, type DeliveryWriteContext } from './piPlan/piDeliveryJira.ts';
import { toFactSheetFeatureInputs, toFactSheetPersonInputs, deriveSprints } from './piPlan/piDeliveryTabData.ts';
import PiDeliveryMonitor from './PiDeliveryMonitor.tsx';
import type { Bottleneck, PiPlanningFactSheet } from './piPlan/piPlanTypes.ts';
import styles from './PiDeliveryPlanTab.module.css';

const DEFAULT_SIZE_FIELD_ID = 'customfield_10002';
const PI_SPRINT_COUNT = 5;
const WORKING_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] as string[] };
const FEATURE_FIELDS = ['summary', 'priority', 'components', 'fixVersions', 'issuelinks'];

interface PiDeliveryPlanTabProps {
  /** The PI selected in the ART header (source of the Feature query + sprint window). */
  piName: string;
}

/** Today as YYYY-MM-DD, for the injected planning clock (browser context — Date is available here). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Splits a Feature's size across the Stories the AI grouped for it, at least 1 point each. */
function sizePerStory(featureSize: number | null, storyCount: number): number {
  const base = featureSize && featureSize > 0 ? featureSize : storyCount;
  return Math.max(1, Math.round(base / Math.max(1, storyCount)));
}

/** The PI Delivery Planner: one place to generate, review, and commit a whole-PI delivery plan. */
export default function PiDeliveryPlanTab({ piName }: PiDeliveryPlanTabProps) {
  const isAiUnlocked = useAiAssistStore((store) => store.isAiAssistUnlocked);
  const rosterMembers = useStandupRosterStore((store) => store.rosterMembers);

  // ── Config the operator confirms before a pull (prefilled with safe defaults) ──
  const [poAssignee, setPoAssignee] = useState('');
  const [sizeFieldId, setSizeFieldId] = useState(DEFAULT_SIZE_FIELD_ID);
  const [piStartIso, setPiStartIso] = useState('');
  const [piEndIso, setPiEndIso] = useState('');

  // ── Pipeline state ──
  const [factSheet, setFactSheet] = useState<PiPlanningFactSheet | null>(null);
  const [componentIdByName, setComponentIdByName] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<string[]>([]);
  const [replyText, setReplyText] = useState('');
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // ── Optional write config (accept is disabled until the essentials are present) ──
  const [writeConfig, setWriteConfig] = useState({ projectKey: '', storyIssueTypeId: '', subTaskIssueTypeId: '', featureLink: '', targetStart: '', targetEnd: '' });
  const isWriteConfigured = writeConfig.projectKey !== '' && writeConfig.storyIssueTypeId !== '' && writeConfig.subTaskIssueTypeId !== '';

  const rosterDevNames = useMemo(
    () => rosterMembers.filter((member) => member.roleCapabilities?.canDevelop || member.roleCapabilities?.canInternalTest).map((member) => member.displayName),
    [rosterMembers],
  );

  async function handleLoadFeatures() {
    if (piName.trim() === '' || poAssignee.trim() === '') {
      setStatusMessage('Enter the Product Owner assignee (and select a PI) before loading Features.');
      return;
    }
    setIsBusy(true);
    setStatusMessage('');
    try {
      const jql = buildDirectFeatureJql(piName, [poAssignee], readPiReviewPullSettings().piFieldId);
      if (jql === null) {
        setStatusMessage('Could not build a Feature query — check the PI and Product Owner.');
        return;
      }
      const fields = [...FEATURE_FIELDS, sizeFieldId].join(',');
      const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=200`;
      const response = await jiraGet<{ issues?: JiraIssue[] }>(path);
      const issues = response.issues ?? [];
      // Capture component name→id from the fetched Features so coding sub-tasks can carry a real component id.
      const idByName: Record<string, string> = {};
      issues.forEach((issue) => {
        const rawComponents = (issue.fields as unknown as { components?: unknown }).components;
        (Array.isArray(rawComponents) ? rawComponents : []).forEach((component) => {
          const named = component as { id?: string; name?: string };
          if (named.name && named.id) idByName[named.name] = named.id;
        });
      });
      setComponentIdByName(idByName);

      const start = piStartIso.trim() || todayIso();
      const end = piEndIso.trim() || start;
      const sprints = deriveSprints(start, end, PI_SPRINT_COUNT, piName);
      const sheet = assembleFactSheet({
        piName, piStartIso: start, sprints,
        features: toFactSheetFeatureInputs(issues, sizeFieldId),
        people: toFactSheetPersonInputs(rosterMembers),
        releaseSchedule: { entries: [] },
        fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] },
        classifyComponent: (name) => getComponentKind(name) ?? 'unclassified',
      });
      setFactSheet(sheet);
      setPlan(null);
      setBottlenecks([]);
      setPrompts([]);
      setStatusMessage(`Loaded ${issues.length} Feature(s); fact sheet assembled with ${sheet.repoAllowlist.length} repo(s).`);
    } catch (loadError) {
      setStatusMessage(loadError instanceof Error ? loadError.message : 'Failed to load Features.');
    } finally {
      setIsBusy(false);
    }
  }

  function handleGeneratePrompt() {
    if (factSheet === null) return;
    const built = buildDeliveryPlanPrompt(factSheet, bottlenecks);
    setPrompts(built.prompts);
    setStatusMessage(`Prompt generated (${built.featureCount} Features${built.chunkCount > 1 ? `, ${built.chunkCount} chunks` : ''}). Copy it into your AI, then paste the reply below.`);
  }

  function handleIngest() {
    if (factSheet === null) return;
    const parsed = parseDeliveryPlanReply(replyText, factSheet, bottlenecks);
    if (parsed.error) {
      setStatusMessage(parsed.error);
      return;
    }
    // Split each Feature's size across the Stories the AI grouped for it.
    const storyCountByFeature: Record<string, number> = {};
    parsed.stories.forEach((story) => { storyCountByFeature[story.featureKey] = (storyCountByFeature[story.featureKey] ?? 0) + 1; });
    const sizeByFeature = new Map(factSheet.features.map((feature) => [feature.key, feature.sizePoints]));
    const acceptedStories: AcceptedStory[] = parsed.stories.map((story) => ({
      featureKey: story.featureKey, summary: story.summary, repoNames: story.repos,
      sizePoints: sizePerStory(sizeByFeature.get(story.featureKey) ?? null, storyCountByFeature[story.featureKey]),
    }));

    const builtPlan = buildDeliveryPlan({
      factSheet, stories: acceptedStories,
      resolveComponentId: (repoName) => componentIdByName[repoName] ?? null,
      workingCalendar: WORKING_CALENDAR, piEndIso: piEndIso.trim() || factSheet.deliveryDeadlineIso, todayIso: todayIso(),
    });
    const detected = attachMitigations(
      detectBottlenecks(builtPlan.planResult, factSheet, builtPlan.stories, piEndIso.trim() || factSheet.deliveryDeadlineIso),
      parsed.mitigationsById,
    );
    setPlan(builtPlan);
    setBottlenecks(detected);
    const rejectedNote = parsed.rejected.length > 0 ? ` (${parsed.rejected.length} item(s) rejected)` : '';
    setStatusMessage(`Ingested ${builtPlan.stories.length} Story(ies); ${detected.length} bottleneck(s) flagged${rejectedNote}.`);
  }

  /** Applies the operator's assignee override to a coding sub-task before writing. */
  function withOverrides(story: PlannedStory): PlannedStory {
    return {
      ...story,
      codingSubtasks: story.codingSubtasks.map((coding) => {
        const override = assigneeOverrides[`${story.tempId}:${coding.repoName}`];
        return override ? { ...coding, assignee: override } : coding;
      }),
    };
  }

  async function handleAccept(story: PlannedStory) {
    if (!isWriteConfigured) {
      setStatusMessage('Set the project key and Story/Sub-task issue-type ids in Write settings before accepting.');
      return;
    }
    setIsBusy(true);
    try {
      const context: DeliveryWriteContext = {
        projectKey: writeConfig.projectKey, storyIssueTypeId: writeConfig.storyIssueTypeId,
        subTaskIssueTypeId: writeConfig.subTaskIssueTypeId,
        fieldIds: { featureLink: writeConfig.featureLink, targetStart: writeConfig.targetStart, targetEnd: writeConfig.targetEnd },
      };
      const result = await applyDeliveryStory(withOverrides(story), context);
      setStatusMessage(`Wrote Story ${result.storyKey} with ${story.codingSubtasks.length} coding sub-task(s) + SL + deploys.`);
    } catch (writeError) {
      setStatusMessage(writeError instanceof Error ? writeError.message : 'Write failed.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className={styles.deliveryTab}>
      {/* ── Load ── */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>1 · Load committed Features & build the fact sheet</h3>
        <p className={styles.statusLine}>PI: <strong>{piName || '(none selected)'}</strong>. The fact sheet is the anti-hallucination spine — everything the AI sees comes from it.</p>
        <div className={styles.controlRow}>
          <label className={styles.field}>Product Owner assignee (accountId or username)
            <input className={styles.fieldInput} value={poAssignee} onChange={(event) => setPoAssignee(event.target.value)} placeholder="e.g. jsmith" />
          </label>
          <label className={styles.field}>Size field id
            <input className={styles.fieldInput} value={sizeFieldId} onChange={(event) => setSizeFieldId(event.target.value)} />
          </label>
          <label className={styles.field}>PI start (YYYY-MM-DD)
            <input className={styles.fieldInput} value={piStartIso} onChange={(event) => setPiStartIso(event.target.value)} placeholder="2026-07-30" />
          </label>
          <label className={styles.field}>PI end (YYYY-MM-DD)
            <input className={styles.fieldInput} value={piEndIso} onChange={(event) => setPiEndIso(event.target.value)} placeholder="2026-10-07" />
          </label>
          <button className={`${styles.actionButton} ${styles.primaryButton}`} disabled={isBusy} onClick={() => void handleLoadFeatures()} type="button">
            {isBusy ? 'Loading…' : 'Load Features'}
          </button>
        </div>
        {factSheet && (
          <>
            <p className={styles.statusLine}>{factSheet.features.length} Feature(s) · {factSheet.people.length} roster member(s) · {factSheet.repoAllowlist.length} repo(s) · delivery deadline {factSheet.deliveryDeadlineIso}</p>
            {factSheet.notes.length > 0 && <ul className={styles.notes}>{factSheet.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
          </>
        )}
      </section>

      {/* ── Generate & ingest (AI-gated) ── */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>2 · Generate the plan prompt & paste the reply</h3>
        {!isAiUnlocked ? (
          <p className={styles.statusLine}>Unlock AI Assist (Ctrl+Alt+Z) to generate the delivery-plan prompt.</p>
        ) : (
          <>
            <button className={styles.actionButton} disabled={factSheet === null} onClick={handleGeneratePrompt} type="button">Generate delivery-plan prompt</button>
            {prompts.length > 0 && <textarea className={styles.promptArea} readOnly value={prompts.join('\n\n=== NEXT CHUNK ===\n\n')} onFocus={(event) => event.currentTarget.select()} />}
            <label className={styles.field} style={{ marginTop: '0.5rem' }}>Paste the AI&apos;s JSON reply
              <textarea className={styles.replyArea} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder='{"kind":"piDeliveryPlan","stories":[ ... ]}' />
            </label>
            <button className={`${styles.actionButton} ${styles.primaryButton}`} disabled={factSheet === null || replyText.trim() === ''} onClick={handleIngest} type="button">Ingest & build plan</button>
          </>
        )}
      </section>

      {statusMessage && <p className={styles.statusLine}>{statusMessage}</p>}

      {/* ── Bottlenecks ── */}
      {bottlenecks.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Bottlenecks (deterministic)</h3>
          {bottlenecks.map((bottleneck) => (
            <div key={bottleneck.id} className={styles.bottleneck}>
              <strong>{bottleneck.kind}</strong> — {bottleneck.statement}
              {bottleneck.mitigation && <div className={styles.bottleneckMitigation}>Mitigation: {bottleneck.mitigation}</div>}
            </div>
          ))}
        </section>
      )}

      {/* ── Plan review + per-item accept ── */}
      {plan && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>3 · Review & commit the plan ({plan.stories.length} Stories)</h3>
          {plan.honestStates.length > 0 && <ul className={styles.notes}>{plan.honestStates.map((state, index) => <li key={index}>{state}</li>)}</ul>}
          {!isWriteConfigured && <p className={styles.statusLine}>Set Write settings below to enable “Accept & write”.</p>}
          {plan.stories.map((story) => (
            <div key={story.tempId} className={styles.storyRow}>
              <div className={styles.storyHead}>
                <span className={styles.storyTitle}>{story.summary}</span>
                <span className={styles.statusLine}>{story.featureKey} · {story.sprintName} · Target End {story.dates.targetEndIso} · Due {story.dates.dueIso ?? '—'}</span>
                <button className={styles.actionButton} disabled={isBusy || !isWriteConfigured} onClick={() => void handleAccept(story)} type="button">Accept &amp; write</button>
              </div>
              <ul className={styles.subtaskList}>
                {story.codingSubtasks.map((coding) => (
                  <li key={coding.repoName} className={styles.subtaskItem}>
                    <span className={styles.repoTag}>{coding.repoName}</span>
                    <span>{coding.devPoints} pts</span>
                    <select className={styles.assigneeSelect} value={assigneeOverrides[`${story.tempId}:${coding.repoName}`] ?? coding.assignee ?? ''} onChange={(event) => setAssigneeOverrides((previous) => ({ ...previous, [`${story.tempId}:${coding.repoName}`]: event.target.value }))}>
                      <option value="">(unassigned)</option>
                      {rosterDevNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </li>
                ))}
                <li className={styles.subtaskItem}><span className={styles.repoTag}>SL test</span><span>{story.slAssignee ?? '(unassigned)'}</span></li>
                <li className={styles.subtaskItem}>Deploys: INT {story.dates.deployIntIso} · REL {story.dates.deployRelIso} · PROD {story.dates.deployProdIso ?? '—'}</li>
              </ul>
              {story.warnings.map((warning, index) => <p key={index} className={styles.warning}>⚠ {warning}</p>)}
            </div>
          ))}
        </section>
      )}

      {/* ── Write settings ── */}
      {plan && (
        <section className={styles.card}>
          <h3 className={styles.sectionTitle}>Write settings (required before accept)</h3>
          <div className={styles.controlRow}>
            {([
              ['projectKey', 'Project key'], ['storyIssueTypeId', 'Story issue-type id'], ['subTaskIssueTypeId', 'Sub-task issue-type id'],
              ['featureLink', 'Feature-link field id'], ['targetStart', 'Target Start field id'], ['targetEnd', 'Target End field id'],
            ] as [keyof typeof writeConfig, string][]).map(([key, label]) => (
              <label key={key} className={styles.field}>{label}
                <input className={styles.fieldInput} value={writeConfig[key]} onChange={(event) => setWriteConfig((previous) => ({ ...previous, [key]: event.target.value }))} />
              </label>
            ))}
          </div>
        </section>
      )}

      {/* ── Monitor ── */}
      {plan && factSheet && (
        <PiDeliveryMonitor plan={plan} factSheet={factSheet} featureLinkFieldId={writeConfig.featureLink} />
      )}
    </div>
  );
}
