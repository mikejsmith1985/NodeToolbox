// RosterTab.tsx — Team Dashboard roster settings used by roster-scoped standup workflows.

import { useMemo, useState } from 'react';

import { useSettingsStore } from '../../store/settingsStore.ts';
import type { JiraIssue } from '../../types/jira.ts';
import {
  filterRosterMembersByActiveTeam,
  readAvailableRosterTeamNames,
  resolveActiveRosterTeamName,
  type StandupRosterMember,
  type StandupRosterMemberDraft,
  useStandupRosterStore,
} from './hooks/useStandupRosterStore.ts';
import { parseRosterMembersFromPasteText } from './hooks/rosterImport.ts';
import styles from './SprintDashboardView.module.css';

interface RosterTabProps {
  issues: JiraIssue[];
}

interface RosterSuggestion {
  displayName: string;
  assigneeQueryValue: string;
}

interface RosterCardProps {
  rosterMember: Pick<
    StandupRosterMember | StandupRosterMemberDraft,
    | 'assigneeQueryValue'
    | 'displayName'
    | 'emailAddress'
    | 'lanId'
    | 'locationTimeZone'
    | 'roleName'
    | 'teamName'
    | 'workingHours'
  >;
  onRemove?: () => void;
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

function buildRosterCardMetaLine(...metaParts: Array<string | undefined>): string | null {
  const populatedMetaParts = metaParts.filter(Boolean);
  return populatedMetaParts.length > 0 ? populatedMetaParts.join(' · ') : null;
}

function RosterCard({ rosterMember, onRemove }: RosterCardProps) {
  const primaryMetaLine = buildRosterCardMetaLine(
    rosterMember.roleName,
    rosterMember.emailAddress,
    `Jira: ${rosterMember.assigneeQueryValue}`,
  );
  const secondaryMetaLine = buildRosterCardMetaLine(
    rosterMember.locationTimeZone,
    rosterMember.workingHours,
    rosterMember.lanId ? `LAN: ${rosterMember.lanId}` : undefined,
  );

  return (
    <article className={styles.rosterMemberCard}>
      <div className={styles.rosterMemberCardHeader}>
        <div className={styles.rosterMemberHeaderText}>
          <p className={styles.rosterMemberName}>{rosterMember.displayName}</p>
          <div className={styles.rosterChipRow}>
            {rosterMember.teamName ? (
              <span className={styles.rosterTeamBadge}>{rosterMember.teamName}</span>
            ) : (
              <span className={styles.rosterDetailChip}>Needs team</span>
            )}
            {rosterMember.roleName ? <span className={styles.rosterDetailChip}>{rosterMember.roleName}</span> : null}
          </div>
        </div>
        {onRemove ? (
          <button
            aria-label={`Remove ${rosterMember.displayName}`}
            className={styles.textActionButton}
            onClick={onRemove}
            type="button"
          >
            Remove
          </button>
        ) : null}
      </div>
      {primaryMetaLine ? <p className={styles.rosterMemberPrimaryMeta}>{primaryMetaLine}</p> : null}
      {secondaryMetaLine ? <p className={styles.rosterMemberSecondaryMeta}>{secondaryMetaLine}</p> : null}
    </article>
  );
}

/** Renders the Team Dashboard roster editor so roster-scoped standup can be filtered by active team. */
export default function RosterTab({ issues }: RosterTabProps) {
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const addRosterMember = useStandupRosterStore((state) => state.addRosterMember);
  const replaceRosterMembers = useStandupRosterStore((state) => state.replaceRosterMembers);
  const removeRosterMember = useStandupRosterStore((state) => state.removeRosterMember);
  const upsertRosterMembers = useStandupRosterStore((state) => state.upsertRosterMembers);
  const storedActiveTeamName = useSettingsStore((state) => state.sprintDashboardActiveTeam);
  const setActiveTeamName = useSettingsStore((state) => state.setSprintDashboardActiveTeam);
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
  const availableRosterTeamNames = useMemo(
    () => readAvailableRosterTeamNames(rosterMembers),
    [rosterMembers],
  );
  const activeRosterTeamName = useMemo(
    () => resolveActiveRosterTeamName(storedActiveTeamName, rosterMembers),
    [rosterMembers, storedActiveTeamName],
  );
  const visibleRosterMembers = useMemo(
    () => filterRosterMembersByActiveTeam(rosterMembers, activeRosterTeamName, { includeTeamlessMembers: true }),
    [activeRosterTeamName, rosterMembers],
  );

  function handleAddManualMember() {
    addRosterMember({
      displayName,
      assigneeQueryValue,
      teamName: activeRosterTeamName || undefined,
    });
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

  return (
    <div className={styles.rosterShell}>
      <section className={styles.rosterSection}>
        <div className={styles.dashboardTabHeader}>
          <div className={styles.dashboardTabCopy}>
            <h2 className={styles.blockersSectionTitle}>Roster Settings</h2>
            <p className={styles.dashboardTabSubtitle}>
              Manage the people list used by roster-scoped standup. The active team controls who appears when roster scope is selected.
            </p>
          </div>
        </div>
        {availableRosterTeamNames.length > 0 ? (
          <label className={styles.rosterFieldLabel}>
            <span>Active team</span>
            <select
              className={styles.settingsInput}
              onChange={(changeEvent) => setActiveTeamName(changeEvent.target.value)}
              value={activeRosterTeamName}
            >
              {availableRosterTeamNames.map((teamName) => (
                <option key={teamName} value={teamName}>
                  {teamName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.personWalkMeta}>
            Import or add roster members with team names to enable active-team filtering.
          </p>
        )}
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
        {activeRosterTeamName ? (
          <p className={styles.personWalkMeta}>
            New manual entries and quick adds are assigned to <strong>{activeRosterTeamName}</strong>.
          </p>
        ) : null}
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
        {importStatusMessage ? <p className={styles.personWalkMeta}>{importStatusMessage}</p> : null}
        {importErrorMessage ? <p className={styles.errorMessage}>{importErrorMessage}</p> : null}
        {parsedRosterMembers.length > 0 ? (
          <div className={styles.rosterImportPreviewGrid}>
            {parsedRosterMembers.map((parsedRosterMember) => (
              <RosterCard
                key={`${parsedRosterMember.assigneeQueryValue}-${parsedRosterMember.displayName}`}
                rosterMember={parsedRosterMember}
              />
            ))}
          </div>
        ) : null}
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
                onClick={() =>
                  addRosterMember({
                    ...rosterSuggestion,
                    teamName: activeRosterTeamName || undefined,
                  })}
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
          <span className={styles.columnCountBadge}>{visibleRosterMembers.length}</span>
        </div>
        {activeRosterTeamName ? (
          <p className={styles.personWalkMeta}>
            Showing {visibleRosterMembers.length} of {rosterMembers.length} roster members for <strong>{activeRosterTeamName}</strong>.
          </p>
        ) : null}
        {rosterMembers.length === 0 ? (
          <p className={styles.personWalkMeta}>Add team members here to run standup outside the sprint.</p>
        ) : visibleRosterMembers.length === 0 ? (
          <p className={styles.personWalkMeta}>No roster members are assigned to the active team yet.</p>
        ) : (
          <div className={styles.rosterMemberList}>
            {visibleRosterMembers.map((rosterMember) => (
              <RosterCard
                key={rosterMember.id}
                onRemove={() => removeRosterMember(rosterMember.id)}
                rosterMember={rosterMember}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
