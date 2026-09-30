// ReleaseNotesConfluencePublisher.tsx — The "Post to Confluence" control beneath a release's rendered notes.

import { useCallback, useState } from 'react';

import styles from '../SprintDashboardView.module.css';
import {
  publishReleaseNotesToConfluence,
  readReleaseNotesParentPageReference,
  writeReleaseNotesParentPageReference,
  type ReleaseNotesPublishOutcome,
} from '../hooks/releaseNotesConfluence.ts';

const POST_BUTTON_LABEL = '📤 Post to Confluence';
const POSTING_BUTTON_LABEL = 'Posting…';
const CREATED_MESSAGE = 'Created the release notes page in Confluence.';
const UPDATED_MESSAGE = 'Updated this release’s existing Confluence page.';

interface ReleaseNotesConfluencePublisherProps {
  /** Whose remembered parent page to use — each team posts under its own. */
  projectKey: string;
  /** The child page's title, matching the heading shown above the notes. */
  pageTitle: string;
  /** The notes already rendered as a Confluence storage-format body. */
  storageValue: string;
}

/**
 * Lets the person post the rendered release notes as a child page of a Confluence page they choose.
 *
 * The parent is remembered per project, so the monthly run is paste-once, then one click. Posting the
 * same release again replaces its page rather than creating a second one.
 */
export function ReleaseNotesConfluencePublisher({
  projectKey,
  pageTitle,
  storageValue,
}: ReleaseNotesConfluencePublisherProps): React.JSX.Element {
  const [parentPageReference, setParentPageReference] = useState(() => readReleaseNotesParentPageReference(projectKey));
  const [isPosting, setIsPosting] = useState(false);
  const [publishOutcome, setPublishOutcome] = useState<ReleaseNotesPublishOutcome | null>(null);
  const [publishError, setPublishError] = useState('');

  const [loadedProjectKey, setLoadedProjectKey] = useState(projectKey);

  // Switching team swaps in that team's remembered parent page (React's "adjust state on prop change").
  if (loadedProjectKey !== projectKey) {
    setLoadedProjectKey(projectKey);
    setParentPageReference(readReleaseNotesParentPageReference(projectKey));
  }

  const handlePost = useCallback(async () => {
    setIsPosting(true);
    setPublishOutcome(null);
    setPublishError('');
    // Remembered before posting, so a failed post (VPN, permissions) does not lose what was pasted.
    writeReleaseNotesParentPageReference(projectKey, parentPageReference);
    try {
      setPublishOutcome(await publishReleaseNotesToConfluence({ parentPageReference, pageTitle, storageValue }));
    } catch (caughtError) {
      setPublishError(caughtError instanceof Error ? caughtError.message : 'Unable to post the release notes.');
    } finally {
      setIsPosting(false);
    }
  }, [pageTitle, parentPageReference, projectKey, storageValue]);

  const canPost = parentPageReference.trim() !== '' && !isPosting;

  return (
    <div data-export-exclude="true">
      <div className={styles.releaseNotesConfluenceRow}>
        <input
          aria-label="Confluence parent page"
          className={styles.settingsInput}
          onChange={(changeEvent) => setParentPageReference(changeEvent.target.value)}
          placeholder="Confluence parent page URL — each release is posted as a page beneath it"
          type="text"
          value={parentPageReference}
        />
        <button
          className={styles.releaseNotesExportButton}
          disabled={!canPost}
          onClick={() => void handlePost()}
          type="button"
        >
          {isPosting ? POSTING_BUTTON_LABEL : POST_BUTTON_LABEL}
        </button>
      </div>
      {publishError ? <p className={styles.errorMessage}>{publishError}</p> : null}
      {publishOutcome ? (
        <p className={styles.releaseNotesCopyConfirmation}>
          {publishOutcome.wasCreated ? CREATED_MESSAGE : UPDATED_MESSAGE}{' '}
          <a href={publishOutcome.pageUrl} rel="noreferrer" target="_blank">Open page ↗</a>
        </p>
      ) : null}
    </div>
  );
}
