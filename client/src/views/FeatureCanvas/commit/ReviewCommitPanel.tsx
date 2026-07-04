// ReviewCommitPanel.tsx — The Review & Commit surface that turns the overlay into Jira writes.
//
// This is where the sandbox ends: it shows an itemized, per-item-toggleable diff of every
// proposed Jira change (with provisional-container creation ordered first), and only writes the
// items the user leaves selected. Nothing is written until the user presses Commit.

import { useMemo, useState } from 'react';

import { buildCommitDiff } from '../logic/commitDiff.ts';
import type { CommitDiffItem } from '../logic/canvasTypes.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import { commitToJira, type CommitResult } from './commitJira.ts';
import controlStyles from '../canvas/canvasControls.module.css';

/** Props the commit panel needs to build the diff and execute it. */
export interface ReviewCommitPanelProps {
  canvasNodes: readonly CanvasNode[];
  containers: readonly CanvasContainer[];
  sizeMapping: Record<'S' | 'M' | 'L' | 'XL', number>;
  boardId: number | null;
  projectKey: string;
  onClose: () => void;
}

/** Human-readable label for one diff item. */
function describeItem(item: CommitDiffItem): string {
  switch (item.kind) {
    case 'createSprint': return `Create sprint "${item.to}"`;
    case 'createVersion': return `Create release "${item.to}"`;
    case 'sprintAssign': return `${item.issueKey} → sprint "${item.to}"`;
    case 'versionAssign': return `${item.issueKey} → release "${item.to}"`;
    case 'pointsSet': return `${item.issueKey} points → ${item.to}`;
    case 'prioritySet': return `${item.issueKey} priority → ${item.to}`;
    default: return item.id;
  }
}

/** The Review & Commit modal. */
export function ReviewCommitPanel(props: ReviewCommitPanelProps): React.JSX.Element {
  const { canvasNodes, containers, sizeMapping, boardId, projectKey, onClose } = props;
  const initialDiff = useMemo(() => buildCommitDiff(canvasNodes, containers, { sizeMapping }), [canvasNodes, containers, sizeMapping]);
  const [diff, setDiff] = useState<CommitDiffItem[]>(initialDiff);
  const [results, setResults] = useState<CommitResult[] | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  const toggleItem = (itemId: string): void => {
    setDiff((current) => current.map((item) => (item.id === itemId ? { ...item, selected: !item.selected } : item)));
  };

  const handleCommit = async (): Promise<void> => {
    setIsCommitting(true);
    const commitResults = await commitToJira(diff, { containers, boardId, projectKey });
    setResults(commitResults);
    setIsCommitting(false);
  };

  const resultById = new Map((results ?? []).map((result) => [result.itemId, result]));

  return (
    <div className={controlStyles.popover} style={{ position: 'absolute', inset: '40px 360px 40px 40px', padding: 16, overflowY: 'auto', zIndex: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Review &amp; Commit</h2>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close Review and Commit">✕</button>
      </div>
      <p style={{ opacity: 0.75 }}>Nothing is written to Jira until you press Commit. Uncheck any change you want to skip.</p>
      {diff.length === 0 && <p>No pending changes — arrange features into boxes or size them first.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {diff.map((item) => {
          const result = resultById.get(item.id);
          return (
            <li key={item.id} style={{ marginBottom: 4 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={item.selected} onChange={() => toggleItem(item.id)} disabled={results !== null} />
                <span>{describeItem(item)}</span>
                {result && <span style={{ color: result.status === 'success' ? 'var(--color-success)' : result.status === 'skipped' ? 'var(--color-warning)' : 'var(--color-danger)' }}>{result.status}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {results === null ? (
        <button type="button" className={controlStyles.btnPrimary} onClick={handleCommit} disabled={isCommitting || diff.every((item) => !item.selected)}>
          {isCommitting ? 'Committing…' : `Commit ${diff.filter((item) => item.selected).length} change(s)`}
        </button>
      ) : (
        <button type="button" className={controlStyles.btn} onClick={onClose}>Done</button>
      )}
    </div>
  );
}
