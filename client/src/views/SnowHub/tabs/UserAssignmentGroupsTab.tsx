// UserAssignmentGroupsTab.tsx — Reverse lookup tab that finds every assignment group for a selected ServiceNow user.

import { useState } from 'react';

import { SnowLookupField } from '../components/SnowLookupField.tsx';
import { useUserAssignmentGroups } from '../hooks/useUserAssignmentGroups.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';
import styles from './UserAssignmentGroupsTab.module.css';

const TAB_TITLE = 'User Assignment Groups';
const TAB_SUBTITLE = 'Search for a user, then list every assignment group tied to that person in ServiceNow.';
const LOOKUP_SECTION_TITLE = 'User Lookup';
const RESULT_SECTION_TITLE = 'Assignment Group Results';
const LOOKUP_BUTTON_LABEL = 'Find Assignment Groups';
const EMPTY_RESULT_MESSAGE = 'No assignment groups were found for this user.';

const EMPTY_USER_REFERENCE: SnowReference = { sysId: '', displayName: '' };

/**
 * Renders a reverse-lookup workspace for discovering all ServiceNow assignment groups linked to one person.
 */
export default function UserAssignmentGroupsTab() {
  const [selectedUser, setSelectedUser] = useState<SnowReference>(EMPTY_USER_REFERENCE);
  const [hasAttemptedLookup, setHasAttemptedLookup] = useState<boolean>(false);
  const {
    assignmentGroupMemberships,
    isLoadingAssignmentGroups,
    lookupErrorMessage,
    lookupAssignmentGroupsForUser,
    clearAssignmentGroupResults,
  } = useUserAssignmentGroups();

  function handleSelectedUserChange(nextUserReference: SnowReference): void {
    setSelectedUser(nextUserReference);
    setHasAttemptedLookup(false);
    clearAssignmentGroupResults();
  }

  async function handleAssignmentGroupLookup(): Promise<void> {
    setHasAttemptedLookup(true);
    await lookupAssignmentGroupsForUser(selectedUser);
  }

  const isLookupDisabled = !selectedUser.sysId || isLoadingAssignmentGroups;
  const shouldShowEmptyState = hasAttemptedLookup
    && !isLoadingAssignmentGroups
    && !lookupErrorMessage
    && assignmentGroupMemberships.length === 0;

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <h2 className={styles.tabTitle}>{TAB_TITLE}</h2>
        <p className={styles.tabSubtitle}>{TAB_SUBTITLE}</p>
      </header>
      <section className={`${styles.section} ${styles.lookupSection}`}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>{LOOKUP_SECTION_TITLE}</h3>
        </div>
        <div className={styles.sectionBody}>
          <SnowLookupField
            isDisabled={isLoadingAssignmentGroups}
            label="User"
            onChange={handleSelectedUserChange}
            tableName="sys_user"
            value={selectedUser}
          />
          <div className={styles.buttonRow}>
            <button
              className={styles.primaryButton}
              disabled={isLookupDisabled}
              onClick={() => void handleAssignmentGroupLookup()}
              type="button"
            >
              {LOOKUP_BUTTON_LABEL}
            </button>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>{RESULT_SECTION_TITLE}</h3>
        </div>
        <div className={styles.sectionBody}>
          {isLoadingAssignmentGroups ? <p className={styles.loadingText}>Loading assignment groups...</p> : null}
          {lookupErrorMessage ? <p className={styles.errorText} role="alert">{lookupErrorMessage}</p> : null}
          {shouldShowEmptyState ? <p className={styles.mutedText}>{EMPTY_RESULT_MESSAGE}</p> : null}
          {assignmentGroupMemberships.length > 0 ? (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th scope="col">Assignment Group</th>
                  <th scope="col">Membership Sys ID</th>
                </tr>
              </thead>
              <tbody>
                {assignmentGroupMemberships.map((groupMembership) => (
                  <tr key={groupMembership.membershipSysId || groupMembership.groupSysId}>
                    <td>{groupMembership.groupDisplayName}</td>
                    <td>{groupMembership.membershipSysId || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>
    </div>
  );
}
