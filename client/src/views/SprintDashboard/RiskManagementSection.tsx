// RiskManagementSection.tsx — PI-scoped Risk Management panel for the PI Review tab.
// Fetches Risk-type Jira issues for the active PI, displays them in a summary table, and
// provides a hidden AI-assist workflow (Ctrl+Alt+Z passphrase gate) that builds an AI Assist
// prompt and writes refined risk descriptions back to Jira on paste-back.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import { setAiAssistUnlocked } from '../../store/aiAssistStore.ts';
import { useAiAssist } from '../SnowHub/hooks/useAiAssist.ts';
import { useAiAssistExchange } from '../SnowHub/hooks/useAiAssistExchange.ts';
import styles from './SprintDashboardView.module.css';

// ── Constants ──

// Full Jira browse URL prefix — must be absolute so links open in Jira, not inside NodeToolbox.
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
// The PI assignment field used project-wide to associate issues with a Program Increment.
const RISK_PI_CUSTOMFIELD_ID = 'customfield_10301';
const RISK_PI_CF_NUMBER = RISK_PI_CUSTOMFIELD_ID.replace('customfield_', '');

const RISK_MANAGEMENT_MAX_RESULTS = 100;
const HIDDEN_AI_ASSIST_SHORTCUT_KEY = 'z';

type RiskSaveProgress = 'idle' | 'saving' | 'saved' | 'error';

// ── Types ──

/** A single risk update returned by AI Assist after AI-assisted refinement. */
interface AiAssistRiskItem {
  key: string;
  description: string;
  riskResponse?: string;
  priority?: string;
}

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
- riskResponse: the ROAM disposition — one of: Resolve, Own, Accept, Mitigate
- priority: urgency level — one of: Highest, High, Medium, Low, Lowest

RISKS TO REFINE:

${riskSummaries}

Return ONLY a valid JSON array with no prose, no explanation, and no markdown code fences:
[
  {
    "key": "PROJ-123",
    "description": "There is a risk that: ...\\nProbability: H\\nImpact if Realized: ...\\nDue to: ...\\nMitigation Plan: ...\\nLeadership Ask: ...",
    "riskResponse": "Mitigate",
    "priority": "High"
  }
]`;
}

// ── Response parser ──

/** Extracts and validates the JSON array from AI Assist's response text. */
function parseAiAssistRiskResponse(
  responseText: string,
  validRiskKeys: ReadonlySet<string>,
): { items: AiAssistRiskItem[]; errorMessage: string | null } {
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { items: [], errorMessage: 'No JSON array found in the response. Paste the full AI Assist output.' };
  }

  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(jsonMatch[0]);
  } catch {
    return { items: [], errorMessage: 'Response contains invalid JSON. Check the pasted text.' };
  }

  if (!Array.isArray(parsedItems)) {
    return { items: [], errorMessage: 'Expected a JSON array at the top level.' };
  }

  const validItems: AiAssistRiskItem[] = [];
  for (const parsedItem of parsedItems) {
    if (typeof parsedItem !== 'object' || parsedItem === null) continue;
    const candidate = parsedItem as Record<string, unknown>;
    const issueKey = typeof candidate.key === 'string' ? candidate.key.trim().toUpperCase() : '';
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
    if (!issueKey || !validRiskKeys.has(issueKey) || !description) continue;

    validItems.push({
      key: issueKey,
      description,
      riskResponse: typeof candidate.riskResponse === 'string' ? candidate.riskResponse.trim() : undefined,
      priority: typeof candidate.priority === 'string' ? candidate.priority.trim() : undefined,
    });
  }

  if (validItems.length === 0) {
    return { items: [], errorMessage: 'No valid risk updates found. Check that the issue keys match this PI.' };
  }

  return { items: validItems, errorMessage: null };
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
  const { isUnlocked: isAiAssistUnlocked, verifyPassphrase } = useAiAssist();
  const passphraseInputRef = useRef<HTMLInputElement | null>(null);

  const [riskIssues, setRiskIssues] = useState<JiraIssue[]>([]);
  const [isLoadingRisks, setIsLoadingRisks] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saveProgressByKey, setSaveProgressByKey] = useState<Record<string, RiskSaveProgress>>({});
  const [saveErrorByKey, setSaveErrorByKey] = useState<Record<string, string>>({});

  const [isPassphraseModalVisible, setIsPassphraseModalVisible] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  const [isAiAssistModalVisible, setIsAiAssistModalVisible] = useState(false);
  const [generatedAiAssistPromptText, setGeneratedAiAssistPromptText] = useState('');
  const [aiAssistResponseInput, setAiAssistResponseInput] = useState('');
  const [aiAssistResponseParseError, setAiAssistResponseParseError] = useState<string | null>(null);

  // Automated exchange — removes the copy-paste by dispatching the prompt and
  // applying AI Assist's response directly.
  const { isRunning: isAiAssistRunning, runAiAssistExchange } = useAiAssistExchange();
  const [aiAssistAutoStatus, setAiAssistAutoStatus] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // ── Data loading ──

  useEffect(() => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const normalizedPiName = selectedPiName.trim();
    if (!normalizedProjectKey || !normalizedPiName) return;

    let isMounted = true;
    setIsLoadingRisks(true);
    setLoadError(null);
    setRiskIssues([]);

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
          setRiskIssues(response.issues ?? []);
        }
      })
      .catch((caughtError: unknown) => {
        if (isMounted) {
          setLoadError(caughtError instanceof Error ? caughtError.message : 'Failed to load risk issues');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingRisks(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectKey, selectedPiName, riskImpactDateFieldId, riskResponseFieldId]);

  // ── Ctrl+Alt+Z shortcut to reveal the passphrase gate ──

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      const isShortcutPressed =
        keyboardEvent.ctrlKey
        && keyboardEvent.altKey
        && keyboardEvent.key.toLowerCase() === HIDDEN_AI_ASSIST_SHORTCUT_KEY;
      if (!isShortcutPressed) return;
      if (isAiAssistUnlocked) {
        setAiAssistUnlocked(false); // toggle: re-hide all AI Assist features
        return;
      }
      setIsPassphraseModalVisible(true);
      setPassphraseInput('');
      setPassphraseError(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAiAssistUnlocked]);

  // ── Focus passphrase input when modal opens ──

  useEffect(() => {
    if (isPassphraseModalVisible) {
      passphraseInputRef.current?.focus();
    }
  }, [isPassphraseModalVisible]);

  // ── Passphrase handlers ──

  const handlePassphraseSubmit = useCallback(async () => {
    const isAccepted = await verifyPassphrase(passphraseInput);
    if (isAccepted) {
      // verifyPassphrase sets the shared aiAssistStore; no local flag to update.
      setIsPassphraseModalVisible(false);
      setPassphraseInput('');
      setPassphraseError(null);
      return;
    }
    setPassphraseError('Incorrect passphrase');
  }, [passphraseInput, verifyPassphrase]);

  const handlePassphraseKeyDown = useCallback(
    (keyboardEvent: ReactKeyboardEvent<HTMLInputElement>) => {
      if (keyboardEvent.key === 'Enter') {
        void handlePassphraseSubmit();
      }
    },
    [handlePassphraseSubmit],
  );

  // ── AI Assist modal handlers ──

  function handleOpenAiAssistModal() {
    setGeneratedAiAssistPromptText(
      buildRiskAiAssistPrompt(riskIssues, selectedPiName, riskImpactDateFieldId, riskResponseFieldId),
    );
    setAiAssistResponseInput('');
    setAiAssistResponseParseError(null);
    setIsCopied(false);
    setIsAiAssistModalVisible(true);
  }

  async function handleCopyAiAssistPrompt() {
    await navigator.clipboard.writeText(generatedAiAssistPromptText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }

  // Automated path: dispatch the prompt to AI Assist, then apply the returned JSON
  // directly — no manual paste.
  async function handleRunAiAssistAuto() {
    setAiAssistAutoStatus('Sending to AI Assist…');
    const exchange = await runAiAssistExchange(generatedAiAssistPromptText);
    if (!exchange.ok) {
      setAiAssistAutoStatus(exchange.message);
      return;
    }
    setAiAssistAutoStatus(null);
    await applyAiAssistResponse(exchange.response ?? '');
  }

  /** Parses AI Assist's JSON, writes all refined risk fields back to Jira, and tracks per-row save state. */
  async function applyAiAssistResponse(responseText: string) {
    const validRiskKeys = new Set(riskIssues.map((issue) => issue.key));
    const { items, errorMessage } = parseAiAssistRiskResponse(responseText, validRiskKeys);

    if (errorMessage) {
      setAiAssistResponseParseError(errorMessage);
      return;
    }

    setIsAiAssistModalVisible(false);
    setAiAssistResponseInput('');
    setAiAssistResponseParseError(null);

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

  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const normalizedPiName = selectedPiName.trim();
  const isContextReady = Boolean(normalizedProjectKey && normalizedPiName);
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

      {/* Passphrase gate — triggered by Ctrl+Alt+Z */}
      {isPassphraseModalVisible ? (
        <div aria-modal="true" className={styles.releasePromptOverlay} role="dialog">
          <div className={styles.releasePromptModal}>
            <h3 className={styles.releasePromptTitle}>Unlock protected tools</h3>
            <input
              aria-label="Protected tools passphrase"
              className={styles.releasePromptInput}
              onChange={(changeEvent) => setPassphraseInput(changeEvent.target.value)}
              onKeyDown={handlePassphraseKeyDown}
              placeholder="Enter passphrase"
              ref={passphraseInputRef}
              type="password"
              value={passphraseInput}
            />
            {passphraseError ? <p className={styles.errorMessage}>{passphraseError}</p> : null}
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => void handlePassphraseSubmit()}
                type="button"
              >
                Unlock
              </button>
              <button
                className={styles.textActionButton}
                onClick={() => setIsPassphraseModalVisible(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
              <textarea
                aria-label="AI Assist risk refinement prompt"
                className={styles.releasePromptTextArea}
                readOnly
                value={generatedAiAssistPromptText}
              />
              <div className={styles.releasePromptActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={isAiAssistRunning}
                  onClick={() => void handleRunAiAssistAuto()}
                  type="button"
                >
                  {isAiAssistRunning ? '⏳ Running via AI Assist…' : '⚡ Run via AI Assist (auto)'}
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => void handleCopyAiAssistPrompt()}
                  type="button"
                >
                  {isCopied ? '✓ Copied!' : '📋 Copy Prompt'}
                </button>
              </div>
              {aiAssistAutoStatus !== null ? (
                <p className={styles.releasePromptInstructions} role="status">{aiAssistAutoStatus}</p>
              ) : null}
            </section>

            <hr className={styles.ptAiAssistDivider} />

            <section className={styles.ptAiAssistSection}>
              <p className={styles.releasePromptInstructions}>
                <strong>Step 2</strong> — Paste AI Assist's JSON response below. Toolbox will write the
                refined descriptions and ROAM dispositions directly to each Jira Risk issue.
              </p>
              <textarea
                aria-label="AI Assist risk refinement response"
                className={styles.ptAiAssistResponseTextArea}
                onChange={(changeEvent) => {
                  setAiAssistResponseInput(changeEvent.target.value);
                  setAiAssistResponseParseError(null);
                }}
                placeholder={'[\n  { "key": "PROJ-123", "description": "...", "riskResponse": "Mitigate", "priority": "High" },\n  ...\n]'}
                value={aiAssistResponseInput}
              />
              {aiAssistResponseParseError ? (
                <p className={styles.errorMessage}>{aiAssistResponseParseError}</p>
              ) : null}
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
