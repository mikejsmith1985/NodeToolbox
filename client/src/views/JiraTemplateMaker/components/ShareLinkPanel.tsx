// ShareLinkPanel.tsx — Shows the shareable Jira prefill link for a template and a Copy button.
// Non-Toolbox users open this link to create the issue under their own Jira session.

import { useState } from 'react';

import styles from '../JiraTemplateMaker.module.css';

interface ShareLinkPanelProps {
  url: string;
  /** Explanation shown when the link can't be built yet (e.g. project id not resolved). */
  unavailableReason?: string;
}

/** Read-only display of the prefill URL with a one-click copy. */
export default function ShareLinkPanel({ url, unavailableReason }: ShareLinkPanelProps) {
  const [hasCopied, setHasCopied] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setHasCopied(true);
      window.setTimeout(() => setHasCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the user can still select the text.
    }
  }

  if (!url) {
    return <p className={styles.unsupportedTag}>{unavailableReason ?? 'Shareable link not available yet.'}</p>;
  }

  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor="tmpl-share-link">
        Shareable create link (for non-Toolbox users)
      </label>
      <textarea className={styles.textarea} id="tmpl-share-link" readOnly rows={3} value={url} />
      <div>
        <button className={styles.primaryButton} onClick={() => void copyLink()} type="button">
          {hasCopied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <span className={styles.unsupportedTag}>
        Anyone with Jira access can open this link to create the issue, pre-filled — no NodeToolbox required.
      </span>
    </div>
  );
}
