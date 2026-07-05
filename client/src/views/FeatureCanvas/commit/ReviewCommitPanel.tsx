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
  /** Opens the Sprint Dashboard to plan the just-committed stories at story altitude. */
  onPlanSprints?: () => void;
}

/** One sprint's selected-vs-budget story-point tally, from the currently-checked story assignments. */
interface SprintCapacityLine {
  containerId: string;
  title: string;
  budget: number | null;
  selectedPoints: number;
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
    case 'parkComment': return `${item.issueKey} → comment "Parked: ${item.to}"`;
    default: return item.id;
  }
}

/** The Review & Commit modal. */
export function ReviewCommitPanel(props: ReviewCommitPanelProps): React.JSX.Element {
  const { canvasNodes, containers, sizeMapping, boardId, projectKey, onClose, onPlanSprints } = props;
  const initialDiff = useMemo(() => buildCommitDiff(canvasNodes, containers, { sizeMapping }), [canvasNodes, containers, sizeMapping]);
  const [diff, setDiff] = useState<CommitDiffItem[]>(initialDiff);
  const [results, setResults] = useState<CommitResult[] | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  // Real story points per issue key (child stories, plus childless features) — used to show the
  // capacity a sprint actually takes on from the child stories you leave checked. This is the
  // story-altitude planning signal: uncheck stories that shouldn't ship this sprint and watch the load.
  const pointsByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of canvasNodes) {
      if (node.storyPoints !== null) {
        map.set(node.issueKey, node.storyPoints);
      }
      for (const child of node.childStories) {
        if (child.storyPoints !== null) {
          map.set(child.key, child.storyPoints);
        }
      }
    }
    return map;
  }, [canvasNodes]);

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

  // Points a sprintAssign story contributes (0 when the issue has no estimate).
  const pointsForItem = (item: CommitDiffItem): number => (item.issueKey ? pointsByKey.get(item.issueKey) ?? 0 : 0);

  // Per-sprint capacity from the CURRENTLY-CHECKED story assignments — recomputes as you toggle.
  const sprintCapacities: SprintCapacityLine[] = containers
    .filter((container) => container.kind === 'sprint' && diff.some((item) => item.kind === 'sprintAssign' && item.containerId === container.id))
    .map((container) => ({
      containerId: container.id,
      title: container.title,
      budget: container.capacityBudget,
      selectedPoints: diff
        .filter((item) => item.kind === 'sprintAssign' && item.containerId === container.id && item.selected)
        .reduce((total, item) => total + pointsForItem(item), 0),
    }));

  return (
    <div className={controlStyles.popover} style={{ position: 'absolute', inset: '40px 360px 40px 40px', padding: 16, overflowY: 'auto', zIndex: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Review &amp; Commit</h2>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close Review and Commit">✕</button>
      </div>
      <p style={{ opacity: 0.75 }}>Nothing is written to Jira until you press Commit. Uncheck any story that should not ship this sprint — the sprint load below updates as you do.</p>
      {diff.length === 0 && <p>No pending changes — arrange features into boxes or size them first.</p>}

      {sprintCapacities.length > 0 && (
        <div style={{ margin: '8px 0', padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}>
          <div style={{ opacity: 0.6, marginBottom: 2 }}>Sprint load (from selected stories)</div>
          {sprintCapacities.map((line) => {
            const isOver = line.budget !== null && line.selectedPoints > line.budget;
            return (
              <div key={line.containerId} style={{ color: isOver ? 'var(--color-danger)' : 'inherit', fontWeight: isOver ? 700 : 400 }}>
                {line.title}: {line.selectedPoints}{line.budget !== null ? ` / ${line.budget}` : ''} pt{isOver ? ' · over capacity' : ''}
              </div>
            );
          })}
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {diff.map((item) => {
          const result = resultById.get(item.id);
          const storyPoints = item.kind === 'sprintAssign' ? pointsForItem(item) : null;
          return (
            <li key={item.id} style={{ marginBottom: 4 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={item.selected} onChange={() => toggleItem(item.id)} disabled={results !== null} />
                <span>{describeItem(item)}{storyPoints !== null ? ` · ${storyPoints}pt` : ''}</span>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className={controlStyles.btn} onClick={onClose}>Done</button>
          {onPlanSprints && (
            <button type="button" className={controlStyles.btnPrimary} onClick={onPlanSprints} title="Continue at story level in the Sprint Dashboard">
              Plan in Sprint Dashboard →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
