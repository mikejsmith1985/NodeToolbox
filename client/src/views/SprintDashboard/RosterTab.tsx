// RosterTab.tsx — Team Dashboard roster editor used by Sprint and Roster standup workflows.

import { useMemo, useState } from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import type { StandupRosterMember, StandupRosterMemberDraft } from './hooks/useStandupRosterStore.ts';
import { parseRosterMembersFromPasteText } from './hooks/rosterImport.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import styles from './SprintDashboardView.module.css';

interface RosterTabProps {
  issues: JiraIssue[];
}

interface RosterSuggestion {
  displayName: string;
  assigneeQueryValue: string;
}

function buildRosterSuggestions(issues: JiraIssue[], rosterAssigneeValues: Set<string>): RosterSuggestion[] {
  const suggestionsByValue = new Map<string, RosterSuggestion>();
  for (const issue of issues) {
    const displayName = issue.fields.assignee?.displayName?.trim();
    if (!displayName) {
      continue;
    }

    const normalizedAssigneeValue = displayName.toLowerCase();
    if (rosterAssigneeValues.has(normalizedAssigneeValue) || suggestionsByValue.has(normalizedAssigneeValue)) {
      continue;
    }

    suggestionsByValue.set(normalizedAssigneeValue, {
      displayName,
      assigneeQueryValue: displayName,
    });
  }

  return [...suggestionsByValue.values()].sort((firstSuggestion, secondSuggestion) =>
    firstSuggestion.displayName.localeCompare(secondSuggestion.displayName),
  );
}

/** Renders the Team Dashboard roster editor so standup can cover sprint and non-sprint work. */
export default function RosterTab({ issues }: RosterTabProps) {
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const addRosterMember = useStandupRosterStore((state) => state.addRosterMember);
  const replaceRosterMembers = useStandupRosterStore((state) => state.replaceRosterMembers);
  const removeRosterMember = useStandupRosterStore((state) => state.removeRosterMember);
  const upsertRosterMembers = useStandupRosterStore((state) => state.upsertRosterMembers);
  const [displayName, setDisplayName] = useState('');
  const [assigneeQueryValue, setAssigneeQueryValue] = useState('');
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);
  const [parsedRosterMembers, setParsedRosterMembers] = useState<StandupRosterMemberDraft[]>([]);
  const [pastedRosterText, setPastedRosterText] = useState('');
  const rosterAssigneeValues = useMemo(
    () => new Set(rosterMembers.map((rosterMember) => rosterMember.assigneeQueryValue.trim().toLowerCase())),
    [rosterMembers],
  );
  const rosterSuggestions = useMemo(
    () => buildRosterSuggestions(issues, rosterAssigneeValues),
    [issues, rosterAssigneeValues],
  );

  function handleAddManualMember() {
    addRosterMember({ displayName, assigneeQueryValue });
    setDisplayName('');
    setAssigneeQueryValue('');
  }

  function handlePreviewImport() {
    try {
      const nextParsedRosterMembers = parseRosterMembersFromPasteText(pastedRosterText);
      setParsedRosterMembers(nextParsedRosterMembers);
      setImportErrorMessage(null);
      setImportStatusMessage(`Parsed ${nextParsedRosterMembers.length} roster members ready to import.`);
    } catch (caughtError) {
      setParsedRosterMembers([]);
      setImportStatusMessage(null);
      setImportErrorMessage(
        caughtError instanceof Error ? caughtError.message : 'Failed to parse the pasted roster.',
      );
    }
  }

  function handleMergeImportedMembers() {
    upsertRosterMembers(parsedRosterMembers);
    setParsedRosterMembers([]);
    setPastedRosterText('');
    setImportErrorMessage(null);
    setImportStatusMessage(`Merged ${parsedRosterMembers.length} roster members.`);
  }

  function handleReplaceImportedMembers() {
    replaceRosterMembers(parsedRosterMembers);
    setParsedRosterMembers([]);
    setPastedRosterText('');
    setImportErrorMessage(null);
    setImportStatusMessage(`Replaced the roster with ${parsedRosterMembers.length} imported members.`);
  }

  function handleRosterPasteChange(nextValue: string) {
    setPastedRosterText(nextValue);
    setParsedRosterMembers([]);
    setImportErrorMessage(null);
    setImportStatusMessage(null);
  }

  function renderRosterMetadata(
    rosterMember: Pick<
      StandupRosterMember | StandupRosterMemberDraft,
      | 'assigneeQueryValue'
      | 'teamName'
      | 'roleName'
      | 'emailAddress'
      | 'locationTimeZone'
      | 'lanId'
      | 'workingHours'
    >,
  ) {
    return (
      <>
        <p className={styles.personWalkMeta}>Jira match: {rosterMember.assigneeQueryValue}</p>
        {rosterMember.teamName && <p className={styles.personWalkMeta}>Team: {rosterMember.teamName}</p>}
        {rosterMember.roleName && <p className={styles.personWalkMeta}>Role: {rosterMember.roleName}</p>}
        {rosterMember.emailAddress && <p className={styles.personWalkMeta}>Email: {rosterMember.emailAddress}</p>}
        {rosterMember.locationTimeZone && (
          <p className={styles.personWalkMeta}>Location / Time Zone: {rosterMember.locationTimeZone}</p>
        )}
        {rosterMember.lanId && <p className={styles.personWalkMeta}>Lan ID: {rosterMember.lanId}</p>}
        {rosterMember.workingHours && (
          <p className={styles.personWalkMeta}>Working Hours: {rosterMember.workingHours}</p>
        )}
      </>
    );
  }

  return (
    <div className={styles.rosterShell}>
      <section className={styles.rosterSection}>
        <div className={styles.dashboardTabHeader}>
          <div className={styles.dashboardTabCopy}>
            <h2 className={styles.blockersSectionTitle}>Roster</h2>
            <p className={styles.dashboardTabSubtitle}>
              Build the people list used by Roster standup scope and the DSU board roster sections.
            </p>
          </div>
        </div>
        <div className={styles.rosterInputGrid}>
          <label className={styles.rosterFieldLabel}>
            <span>Display name</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </label>
          <label className={styles.rosterFieldLabel}>
            <span>Jira assignee value</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(event) => setAssigneeQueryValue(event.target.value)}
              value={assigneeQueryValue}
            />
          </label>
          <button className={styles.secondaryButton} onClick={handleAddManualMember} type="button">
            Add to roster
          </button>
        </div>
      </section>

      <section className={styles.rosterSection}>
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Paste importer</h3>
        </div>
        <label className={styles.rosterFieldLabel}>
          <span>Paste team roster</span>
          <textarea
            className={styles.rosterImportTextArea}
            onChange={(event) => handleRosterPasteChange(event.target.value)}
            value={pastedRosterText}
          />
        </label>
        <div className={styles.rosterImportActionRow}>
          <button className={styles.secondaryButton} onClick={handlePreviewImport} type="button">
            Preview import
          </button>
          <button
            className={styles.secondaryButton}
            disabled={parsedRosterMembers.length === 0}
            onClick={handleMergeImportedMembers}
            type="button"
          >
            Merge imported members
          </button>
          <button
            className={styles.secondaryButton}
            disabled={parsedRosterMembers.length === 0}
            onClick={handleReplaceImportedMembers}
            type="button"
          >
            Replace current roster
          </button>
        </div>
        {importStatusMessage && <p className={styles.personWalkMeta}>{importStatusMessage}</p>}
        {importErrorMessage && <p className={styles.errorMessage}>{importErrorMessage}</p>}
        {parsedRosterMembers.length > 0 && (
          <div className={styles.rosterImportPreviewGrid}>
            {parsedRosterMembers.map((parsedRosterMember) => (
              <div
                className={styles.rosterMemberCard}
                key={`${parsedRosterMember.assigneeQueryValue}-${parsedRosterMember.displayName}`}
              >
                <div>
                  <p className={styles.rosterMemberName}>{parsedRosterMember.displayName}</p>
                  {renderRosterMetadata(parsedRosterMember)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.rosterSection}>
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Quick add from current sprint</h3>
        </div>
        {rosterSuggestions.length === 0 ? (
          <p className={styles.personWalkMeta}>No extra sprint assignees are available to add right now.</p>
        ) : (
          <div className={styles.rosterQuickPickGrid}>
            {rosterSuggestions.map((rosterSuggestion) => (
              <button
                className={styles.standupToggleButton}
                key={rosterSuggestion.assigneeQueryValue}
                onClick={() => addRosterMember(rosterSuggestion)}
                type="button"
              >
                Add {rosterSuggestion.displayName}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.rosterSection}>
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Current roster</h3>
          <span className={styles.columnCountBadge}>{rosterMembers.length}</span>
        </div>
        {rosterMembers.length === 0 ? (
          <p className={styles.personWalkMeta}>Add team members here to run standup outside the sprint.</p>
        ) : (
          <div className={styles.rosterMemberList}>
            {rosterMembers.map((rosterMember) => (
              <div className={styles.rosterMemberCard} key={rosterMember.id}>
                <div>
                  <p className={styles.rosterMemberName}>{rosterMember.displayName}</p>
                  {renderRosterMetadata(rosterMember)}
                </div>
                <button
                  aria-label={`Remove ${rosterMember.displayName}`}
                  className={styles.textActionButton}
                  onClick={() => removeRosterMember(rosterMember.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
