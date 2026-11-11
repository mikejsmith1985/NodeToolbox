// RiskManagementSection.tsx — PI-scoped Risk Management panel for the PI Review tab.
// Fetches Risk-type Jira issues for the active PI, displays them in a summary table, and
// provides a hidden AI-assist workflow that builds an AI Assist prompt and writes refined risk
// descriptions back to Jira on paste-back. The unlock itself belongs to the app-level
// AiAssistUnlockGate; this panel only reads the shared unlock state.
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores a JSON reply format, so the prompt ends with a
// pre-filled table (one column per template part) and aiReply/riskAiAssistReply.ts reads it back. A reply that is
// unreadable or leaves risks out gets a follow-up for the same AI chat; nothing missing is ever written.

import { useEffect, useState } from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import { useAiAssist } from '../SnowHub/hooks/useAiAssist.ts';
import { AiFollowUpPrompt } from '../../components/AiFollowUpPrompt/index.tsx';
import { AiPromptFile } from '../../components/AiPromptFile/index.tsx';
import { buildRiskReplyFormLines, parseRiskAiReply } from './aiReply/riskAiAssistReply.ts';
import styles from './SprintDashboardView.module.css';

// ── Constants ──

// Full Jira browse URL prefix — must be absolute so links open in Jira, not inside NodeToolbox.
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
// The PI assignment field used project-wide to associate issues with a Program Increment.
const RISK_PI_CUSTOMFIELD_ID = 'customfield_10301';
const RISK_PI_CF_NUMBER = RISK_PI_CUSTOMFIELD_ID.replace('customfield_', '');

const RISK_MANAGEMENT_MAX_RESULTS = 100;

/**
 * The risks from one load, stamped with the request that produced them.
 *
 * The stamp is what lets "still loading" be worked out during render rather than switched on by hand
 * when a load starts: risks stamped with an older request than the current PI context calls for are
 * by definition superseded, so they are not shown as that PI's answer. Keeping the risks and their
 * error in one value also removes the window where one had been replaced but the other had not.
 */
interface RiskLoadResult {
  /** The riskRequestKey of the load that produced this data; never matches an unloaded section. */
  requestKey: string;
  issues: JiraIssue[];
  errorMessage: string | null;
}

/** Shared empty list so renders without risks keep a stable identity for the memos that read it. */
const NO_RISK_ISSUES: JiraIssue[] = [];

/** Starting point: a request key no real load can produce, so the section reads as not-yet-loaded. */
const NO_RISK_LOAD_RESULT: RiskLoadResult = { requestKey: '', issues: NO_RISK_ISSUES, errorMessage: null };

type RiskSaveProgress = 'idle' | 'saving' | 'saved' | 'error';

// ── Types ──

export interface RiskManagementSectionProps {
  projectKey: string;
  selectedPiName: string;
  /** Jira customfield ID for Risk Impact Date. Empty string = not configured. */
  riskImpactDateFieldId: string;
  /** Jira customfield ID for the Risk Response / ROAM disposition field. Empty string = not configured. */
  riskResponseFieldId: string;
}


// ── Prompt builder ──

/** Builds the AI Assist prompt asking AI to refine all risk descriptions to the enterprise template. */
function buildRiskAiAssistPrompt(
  risks: JiraIssue[],
  selectedPiName: string,
  riskImpactDateFieldId: string,
  riskResponseFieldId: string,
): string {
  const piLabel = selectedPiName.trim() || 'the current PI';

  const riskSummaries = risks
    .map((risk) => {
      const fields = risk.fields as Record<string, unknown>;
      const rawDescription = fields.description;
      const descriptionText = typeof rawDescription === 'string'
        ? rawDescription.trim()
        : '';
      const priorityName = (fields.priority as { name?: string } | null)?.name ?? 'Unknown';
      const assigneeName = (fields.assignee as { displayName?: string } | null)?.displayName ?? 'Unassigned';
      const dueDate = typeof fields.duedate === 'string' ? fields.duedate : 'Not set';
      const riskImpactDate = riskImpactDateFieldId && typeof fields[riskImpactDateFieldId] === 'string'
        ? String(fields[riskImpactDateFieldId])
        : 'Not set';
      const riskResponseValue = readRawRiskResponseText(fields, riskResponseFieldId);

      return [
        `Issue: ${risk.key}`,
        `Summary: ${risk.fields.summary ?? '(No summary)'}`,
        `Priority: ${priorityName}`,
        `Assignee: ${assigneeName}`,
        `Due Date: ${dueDate}`,
        `Risk Impact Date: ${riskImpactDate}`,
        `Risk Response (ROAM): ${riskResponseValue}`,
        `Current Description:\n${descriptionText || '(No description)'}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return `You are a Risk Management assistant supporting enterprise PI planning.

PI: ${piLabel}
Total risks: ${risks.length}

Your task is to evaluate each risk and produce a refined description following the enterprise standard template. Fill every section based on the existing description and summary — infer reasonable content where details are thin.

REQUIRED DESCRIPTION TEMPLATE — every section must be present:
"There is a risk that: <what might not happen or what threat exists>
Probability: <H, M, or L — the likelihood of occurrence>
Impact if Realized: <identify the business or delivery impact(s)>
Due to: <describe the root cause or symptoms that created this situation>
Mitigation Plan: <summary of the strategy to reduce or eliminate the risk and targeted completion date>
Leadership Ask: <describe what leadership support is needed to accomplish the above>"

Also provide:
- ROAM response: the ROAM disposition — one of: Resolve, Own, Accept, Mitigate
- Priority: urgency level — one of: Highest, High, Medium, Low, Lowest

RISKS TO REFINE:

${riskSummaries}

Give each template section its own column in the table below — Toolbox joins them into the description.

${buildRiskReplyFormLines(risks.map((risk) => risk.key))}`;
}

// ── Field readers ──

function readRawRiskResponseText(fields: Record<string, unknown>, riskResponseFieldId: string): string {
  if (!riskResponseFieldId) return 'Not set';
  const responseField = fields[riskResponseFieldId];
  if (!responseField) return 'Not set';
  if (typeof responseField === 'object' && 'value' in (responseField as Record<string, unknown>)) {
    return String((responseField as { value: unknown }).value);
  }
  return typeof responseField === 'string' ? responseField : 'Not set';
}

function readRiskResponseLabel(issue: JiraIssue, riskResponseFieldId: string): string {
  return readRawRiskResponseText(issue.fields as Record<string, unknown>, riskResponseFieldId);
}

function readRiskImpactDate(issue: JiraIssue, riskImpactDateFieldId: string): string {
  if (!riskImpactDateFieldId) return '—';
  const fields = issue.fields as Record<string, unknown>;
  return typeof fields[riskImpactDateFieldId] === 'string' ? String(fields[riskImpactDateFieldId]) : '—';
}

function readPriorityLabel(issue: JiraIssue): string {
  return (issue.fields.priority as { name?: string } | null)?.name ?? '—';
}

function readAssigneeLabel(issue: JiraIssue): string {
  return (issue.fields.assignee as { displayName?: string } | null)?.displayName ?? 'Unassigned';
}

function readStatusLabel(issue: JiraIssue): string {
  return (issue.fields.status as { name?: string } | null)?.name ?? '—';
}

// ── Component ──

/** Risk Management panel — fetches Risk issues for the active PI and provides AI-assisted description refinement. */
export default function RiskManagementSection({
  projectKey,
  selectedPiName,
  riskImpactDateFieldId,
  riskResponseFieldId,
}: RiskManagementSectionProps) {
  // Unlock state comes from the shared aiAssistStore (via useAiAssist) so one
  // passphrase entry unlocks every AI Assist surface, including the Admin Hub config.
  const { isUnlocked: isAiAssistUnlocked } = useAiAssist();

  const [riskLoadResult, setRiskLoadResult] = useState<RiskLoadResult>(NO_RISK_LOAD_RESULT);

  const [saveProgressByKey, setSaveProgressByKey] = useState<Record<string, RiskSaveProgress>>({});
  const [saveErrorByKey, setSaveErrorByKey] = useState<Record<string, string>>({});


  const [isAiAssistModalVisible, setIsAiAssistModalVisible] = useState(false);
  const [generatedAiAssistPromptText, setGeneratedAiAssistPromptText] = useState('');
  const [aiAssistResponseInput, setAiAssistResponseInput] = useState('');
  const [aiAssistResponseParseError, setAiAssistResponseParseError] = useState<string | null>(null);
  // A follow-up for the same AI chat, and the risks still awaiting an answer — so a follow-up's reply,
  // pasted on its own, is checked only against the risks it was asked about (GH #499).
  const [riskFollowUpPrompt, setRiskFollowUpPrompt] = useState('');
  const [pendingRiskKeys, setPendingRiskKeys] = useState<string[]>([]);

  const [isCopied, setIsCopied] = useState(false);

  // ── Data loading ──

  // The risk query and the render below read the same normalized context, so it is worked out once.
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const normalizedPiName = selectedPiName.trim();
  const isContextReady = Boolean(normalizedProjectKey && normalizedPiName);

  // Names the exact fetch the current props call for, or null while there is no PI context to load.
  // Every input to the query is in the key, so switching PI or changing a field id marks the risks on
  // hand as belonging to an older request in the same render — which is what the states below read.
  const riskRequestKey = isContextReady
    ? `${normalizedProjectKey}|${normalizedPiName}|${riskImpactDateFieldId}|${riskResponseFieldId}`
    : null;

  const hasRisksForCurrentRequest = riskRequestKey !== null && riskLoadResult.requestKey === riskRequestKey;
  const riskIssues = hasRisksForCurrentRequest ? riskLoadResult.issues : NO_RISK_ISSUES;
  const loadError = hasRisksForCurrentRequest ? riskLoadResult.errorMessage : null;
  const isLoadingRisks = riskRequestKey !== null && !hasRisksForCurrentRequest;

  useEffect(() => {
    if (riskRequestKey === null) return;

    let isMounted = true;
    const extraFieldIds = [riskImpactDateFieldId, riskResponseFieldId].filter(Boolean);
    const baseFields = `summary,status,assignee,priority,description,duedate,${RISK_PI_CUSTOMFIELD_ID}`;
    const allFields = extraFieldIds.length > 0 ? `${baseFields},${extraFieldIds.join(',')}` : baseFields;

    const jql = `issuetype = Risk AND project = "${normalizedProjectKey}" AND cf[${RISK_PI_CF_NUMBER}] = "${normalizedPiName}" ORDER BY priority ASC`;
    const encodedJql = encodeURIComponent(jql);

    jiraGet<{ issues?: JiraIssue[] }>(
      `/rest/api/2/search?jql=${encodedJql}&maxResults=${RISK_MANAGEMENT_MAX_RESULTS}&fields=${allFields}`,
    )
      .then((response) => {
        if (isMounted) {
          setRiskLoadResult({ requestKey: riskRequestKey, issues: response.issues ?? [], errorMessage: null });
        }
      })
      .catch((caughtError: unknown) => {
        if (isMounted) {
          setRiskLoadResult({
            requestKey: riskRequestKey,
            issues: [],
            errorMessage: caughtError instanceof Error ? caughtError.message : 'Failed to load risk issues',
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [riskRequestKey, normalizedProjectKey, normalizedPiName, riskImpactDateFieldId, riskResponseFieldId]);

  // ── Ctrl+Alt+Z shortcut to reveal the passphrase gate ──

  // ── AI Assist modal handlers ──

  function handleOpenAiAssistModal() {
    setGeneratedAiAssistPromptText(
      buildRiskAiAssistPrompt(riskIssues, selectedPiName, riskImpactDateFieldId, riskResponseFieldId),
    );
    setAiAssistResponseInput('');
    setAiAssistResponseParseError(null);
    setRiskFollowUpPrompt('');
    setPendingRiskKeys(riskIssues.map((issue) => issue.key));
    setIsCopied(false);
    setIsAiAssistModalVisible(true);
  }

  async function handleCopyAiAssistPrompt() {
    await navigator.clipboard.writeText(generatedAiAssistPromptText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }

  /** Reads AI Assist's reply, writes every complete refined risk back to Jira, and tracks per-row save state. */
  async function applyAiAssistResponse(responseText: string) {
    const validRiskKeys = new Set(riskIssues.map((issue) => issue.key.toUpperCase()));
    const { items, errorMessage, followUpPrompt } = parseRiskAiReply(responseText, validRiskKeys, pendingRiskKeys);
    setRiskFollowUpPrompt(followUpPrompt);

    if (errorMessage) {
      setAiAssistResponseParseError(errorMessage);
      return;
    }

    // Risks the reply left out stay open: the modal keeps their follow-up on screen; the complete ones are written.
    const writtenKeys = new Set(items.map((item) => item.key));
    setPendingRiskKeys((previousKeys) => previousKeys.filter((riskKey) => !writtenKeys.has(riskKey.toUpperCase())));
    if (followUpPrompt === '') {
      setIsAiAssistModalVisible(false);
      setAiAssistResponseInput('');
      setAiAssistResponseParseError(null);
    } else {
      setAiAssistResponseParseError(`Writing ${items.length} refined risk(s). Some risks were left out or incomplete — copy the follow-up below into the same AI chat, then paste its reply here.`);
    }

    await Promise.allSettled(
      items.map(async (item) => {
        setSaveProgressByKey((prev) => ({ ...prev, [item.key]: 'saving' }));
        setSaveErrorByKey((prev) => { const next = { ...prev }; delete next[item.key]; return next; });

        try {
          const updateFields: Record<string, unknown> = { description: item.description };
          // Risk Response is a Select (dropdown) field in Jira — must use the {value: "..."} object format.
          if (riskResponseFieldId && item.riskResponse) {
            updateFields[riskResponseFieldId] = { value: item.riskResponse };
          }
          if (item.priority) {
            updateFields.priority = { name: item.priority };
          }
          await jiraPut(`/rest/api/2/issue/${item.key}`, { fields: updateFields });
          setSaveProgressByKey((prev) => ({ ...prev, [item.key]: 'saved' }));
        } catch (caughtError) {
          const rawMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
          // Strip the verbose "Jira PUT /path failed: " prefix that jiraPut prepends.
          const displayMessage = rawMessage.includes(' failed: ')
            ? rawMessage.split(' failed: ').slice(1).join(' failed: ')
            : rawMessage;
          setSaveProgressByKey((prev) => ({ ...prev, [item.key]: 'error' }));
          setSaveErrorByKey((prev) => ({ ...prev, [item.key]: displayMessage }));
        }
      }),
    );
  }

  // ── Save status cell renderer ──

  function renderSaveStatus(issueKey: string) {
    const progress = saveProgressByKey[issueKey] ?? 'idle';
    if (progress === 'saving') return <span className={styles.riskSaveStatus}>Saving…</span>;
    if (progress === 'saved') return <span className={styles.riskSaveStatusSaved}>✓ Saved</span>;
    if (progress === 'error') {
      return (
        <span className={styles.riskSaveStatusError} title={saveErrorByKey[issueKey]}>
          ⚠️ Error
        </span>
      );
    }
    return null;
  }

  // ── Derived state ──
  // normalizedProjectKey / normalizedPiName / isContextReady are worked out with the risk load above.

  const hasSaveActivity = Object.keys(saveProgressByKey).length > 0;

  return (
    <section className={styles.riskManagementSection}>
      <div className={styles.riskManagementHeader}>
        <div>
          <h2 className={styles.settingsSectionTitle}>Risk Management</h2>
          <p className={styles.riskManagementSubtext}>
            Risk issues for {normalizedPiName || 'the selected PI'}.
          </p>
        </div>
        {isAiAssistUnlocked && isContextReady && riskIssues.length > 0 && (
          <button
            className={styles.riskEnhanceButton}
            onClick={handleOpenAiAssistModal}
            type="button"
          >
            ✦ Enhance with AI
          </button>
        )}
      </div>

      {!isContextReady && (
        <p className={styles.riskManagementSubtext}>Select a project and PI to load risk issues.</p>
      )}
      {isContextReady && isLoadingRisks && (
        <p className={styles.riskManagementSubtext}>Loading risks…</p>
      )}
      {isContextReady && !isLoadingRisks && loadError && (
        <p className={styles.errorMessage}>{loadError}</p>
      )}
      {isContextReady && !isLoadingRisks && !loadError && riskIssues.length === 0 && (
        <p className={styles.riskManagementSubtext}>No Risk issues found for this PI.</p>
      )}

      {isContextReady && !isLoadingRisks && riskIssues.length > 0 && (
        <div className={styles.riskTableWrapper}>
          <table className={styles.riskTable}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Priority</th>
                <th>Due Date</th>
                {riskImpactDateFieldId ? <th>Impact Date</th> : null}
                {riskResponseFieldId ? <th>ROAM</th> : null}
                <th>Assignee</th>
                <th>Status</th>
                {hasSaveActivity ? <th>Save</th> : null}
              </tr>
            </thead>
            <tbody>
              {riskIssues.map((risk) => (
                <tr className={styles.riskTableRow} key={risk.key}>
                  <td>
                    <a
                      className={styles.issueKeyLink}
                      href={`${JIRA_BROWSE_URL_PREFIX}${risk.key}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {risk.key}
                    </a>
                  </td>
                  <td className={styles.riskSummaryCell}>{risk.fields.summary}</td>
                  <td>{readPriorityLabel(risk)}</td>
                  <td>{String((risk.fields as Record<string, unknown>).duedate ?? '—')}</td>
                  {riskImpactDateFieldId ? <td>{readRiskImpactDate(risk, riskImpactDateFieldId)}</td> : null}
                  {riskResponseFieldId ? <td>{readRiskResponseLabel(risk, riskResponseFieldId)}</td> : null}
                  <td>{readAssigneeLabel(risk)}</td>
                  <td>{readStatusLabel(risk)}</td>
                  {hasSaveActivity ? <td>{renderSaveStatus(risk.key)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Assist modal — two-step: copy prompt / paste response */}
      {isAiAssistModalVisible ? (
        <div aria-modal="true" className={styles.releasePromptOverlay} role="dialog">
          <div className={styles.ptAiAssistModal}>
            <h3 className={styles.releasePromptTitle}>✦ AI-Assisted Risk Refinement</h3>

            <section className={styles.ptAiAssistSection}>
              <p className={styles.releasePromptInstructions}>
                <strong>Step 1</strong> — Copy this prompt into AI Assist. It includes all{' '}
                {riskIssues.length} risk{riskIssues.length === 1 ? '' : 's'} for {normalizedPiName}.
              </p>
              {/* AI Mode drops whatever is pasted past 2,048 characters, so a long prompt is also offered as a file (GH #499). */}
              <AiPromptFile promptText={generatedAiAssistPromptText} fileBaseName="risk-refinement-prompt" />
              <textarea
                aria-label="AI Assist risk refinement prompt"
                className={styles.releasePromptTextArea}
                readOnly
                value={generatedAiAssistPromptText}
              />
              <div className={styles.releasePromptActions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => void handleCopyAiAssistPrompt()}
                  type="button"
                >
                  {isCopied ? '✓ Copied!' : '📋 Copy Prompt'}
                </button>
              </div>
            </section>

            <hr className={styles.ptAiAssistDivider} />

            <section className={styles.ptAiAssistSection}>
              <p className={styles.releasePromptInstructions}>
                <strong>Step 2</strong> — Paste AI Assist's reply (its filled-in table) below. Toolbox will write the
                refined descriptions and ROAM dispositions directly to each Jira Risk issue.
              </p>
              <textarea
                aria-label="AI Assist risk refinement response"
                className={styles.ptAiAssistResponseTextArea}
                onChange={(changeEvent) => {
                  setAiAssistResponseInput(changeEvent.target.value);
                  setAiAssistResponseParseError(null);
                }}
                placeholder={'Issue key | There is a risk that | Probability | …\nPROJ-123 | … | H | …'}
                value={aiAssistResponseInput}
              />
              {aiAssistResponseParseError ? (
                <p className={styles.errorMessage}>{aiAssistResponseParseError}</p>
              ) : null}
              <AiFollowUpPrompt fieldId="risk-ai-follow-up" followUpPrompt={riskFollowUpPrompt} />
              <div className={styles.releasePromptActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={aiAssistResponseInput.trim() === ''}
                  onClick={() => void applyAiAssistResponse(aiAssistResponseInput)}
                  type="button"
                >
                  Apply & Save to Jira
                </button>
                <button
                  className={styles.textActionButton}
                  onClick={() => setIsAiAssistModalVisible(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
