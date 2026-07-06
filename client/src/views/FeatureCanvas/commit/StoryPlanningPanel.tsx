// StoryPlanningPanel.tsx — Story-level ("Pull from Canvas") planning inside the sandbox.
//
// Jira sprints hold stories, not features — so real sprint planning happens at the story level.
// This panel expands every canvas box into the child stories currently placed there and lets the
// planner move stories between boxes (splitting a feature across sprints) with a live points-vs-
// capacity readout per sprint. It mutates ONLY the overlay (per-story placement); nothing is written
// to Jira until Review & Commit, which already expands each story to its placed sprint.

import { useMemo, useState } from 'react';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { ContainerKind } from '../overlay/overlayModel.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import { StoryInspectorPanel } from './StoryInspectorPanel.tsx';
import controlStyles from '../canvas/canvasControls.module.css';

// Story-level planning is about sequencing into sprints (and deferring to Later). Parked, Complete,
// and release boxes are feature-level triage outcomes — their stories are NOT being sprint-planned,
// so they are excluded from this board entirely.
const PLANNABLE_KINDS: readonly ContainerKind[] = ['sprint', 'later'];

/** Props for the story-level planning panel. */
export interface StoryPlanningPanelProps {
  canvasNodes: readonly CanvasNode[];
  controller: CanvasOverlayController;
  onClose: () => void;
}

/** One child story (or a childless feature) as a placeable unit. */
interface PlaceableStory {
  featureKey: string;
  storyKey: string;
  summary: string;
  points: number | null;
  status: string;
  statusCategoryKey: string | null;
  issueType: string | null;
  assignee: string | null;
  subtaskCount: number;
  /** The box this story currently sits in — its own placement override, else its feature's box. */
  effectiveContainerId: string | null;
}

const UNASSIGNED = '__unassigned__';

/** Maps a story's status category to a badge colour, so To Do / In Progress / Done read at a glance. */
function statusColor(statusCategoryKey: string | null): string {
  if (statusCategoryKey === 'done') {
    return '#22c55e';
  }
  if (statusCategoryKey === 'indeterminate') {
    return '#3b82f6';
  }
  return '#6b7280';
}

/** Flattens every feature into its placeable stories (childless features act as a single story). */
function collectStories(canvasNodes: readonly CanvasNode[]): PlaceableStory[] {
  const stories: PlaceableStory[] = [];
  for (const node of canvasNodes) {
    const units = node.childStories.length > 0
      ? node.childStories.map((child) => ({
        storyKey: child.key, summary: child.summary, points: child.storyPoints,
        status: child.status, statusCategoryKey: child.statusCategoryKey,
        issueType: child.issueType ?? null, assignee: child.assignee ?? null, subtaskCount: child.subtaskCount ?? 0,
      }))
      : [{
        storyKey: node.issueKey, summary: node.summary, points: node.storyPoints,
        status: node.status, statusCategoryKey: node.statusCategoryKey,
        issueType: 'Feature', assignee: node.assignee, subtaskCount: 0,
      }];
    for (const unit of units) {
      stories.push({
        featureKey: node.issueKey,
        ...unit,
        effectiveContainerId: node.storyPlacements[unit.storyKey] ?? node.containerId,
      });
    }
  }
  return stories;
}

/** The story-level planning board. Columns are sprint/Later boxes; cards are child stories to reassign. */
export function StoryPlanningPanel({ canvasNodes, controller, onClose }: StoryPlanningPanelProps): React.JSX.Element {
  const containers = controller.overlay.containers;
  const stories = useMemo(() => collectStories(canvasNodes), [canvasNodes]);
  const [selectedStory, setSelectedStory] = useState<PlaceableStory | null>(null);

  // Only sprint/Later boxes are planning targets and columns — never Parking Lot/Complete/release.
  const plannableContainers = useMemo(() => containers.filter((container) => PLANNABLE_KINDS.includes(container.kind)), [containers]);

  const storiesInColumn = (columnId: string): PlaceableStory[] =>
    stories.filter((story) => story.effectiveContainerId === columnId);

  const columnPoints = (columnId: string): number =>
    storiesInColumn(columnId).reduce((total, story) => total + (story.points ?? 0), 0);

  return (
    // A solid, full-viewport planning surface — not a translucent floating popover — so the canvas
    // never bleeds through and every column is reachable via one clean scroll container.
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--color-bg-surface, var(--color-bg))', color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Plan stories</h2>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close story planning">✕ Close</button>
      </div>
      <p style={{ opacity: 0.75, margin: '8px 0' }}>
        Move child stories between sprints (or defer to Later) to plan each sprint at the story level — a
        feature can span sprints. Click a story for its full detail. This stays in the sandbox; Review &amp;
        Commit assigns each story to its placed sprint.
      </p>

      {plannableContainers.length === 0 && <p style={{ opacity: 0.6 }}>Add a sprint box first, then come back to plan its stories.</p>}

      {/* Board (left, scrolls) + the docked story inspector (right, when a card is selected). */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 'max-content', paddingBottom: 8 }}>
          {plannableContainers.map((container) => {
            const isSprint = container.kind === 'sprint';
            const budget = container.capacityBudget;
            const points = columnPoints(container.id);
            const isOver = isSprint && budget !== null && points > budget;
            return (
              <section key={container.id} aria-label={`Box ${container.title}`} style={{ flex: '0 0 320px', border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, background: 'var(--color-surface)' }}>
                <header style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>{container.title}</strong>
                  {isSprint && (
                    <div style={{ fontSize: 12, color: isOver ? 'var(--color-danger)' : 'inherit', fontWeight: isOver ? 700 : 400 }}>
                      {points}{budget !== null ? ` / ${budget}` : ''} pt{isOver ? ' · over capacity' : ''} · {storiesInColumn(container.id).length} stories
                    </div>
                  )}
                </header>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {storiesInColumn(container.id).map((story) => (
                    <li key={story.storyKey} style={{ border: `1px solid ${selectedStory?.storyKey === story.storyKey ? 'var(--color-accent, #8b5cf6)' : 'var(--color-border)'}`, borderRadius: 6, padding: 8, fontSize: 12, background: 'var(--color-bg-surface, var(--color-bg))' }}>
                      {/* Click anywhere on the card body to inspect its full detail (description/AC/comments). */}
                      <button
                        type="button"
                        onClick={() => setSelectedStory(story)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
                        title={`Open ${story.storyKey} detail`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                          <strong>{story.storyKey}</strong>
                          <span style={{ fontWeight: 700, color: story.points === null ? 'var(--color-warning)' : 'inherit' }}>
                            {story.points !== null ? `${story.points} pt` : 'unpointed'}
                          </span>
                        </div>
                        <div style={{ lineHeight: 1.35, margin: '3px 0' }}>{story.summary}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11, opacity: 0.85 }}>
                          {story.issueType && <span>{story.issueType}</span>}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(story.statusCategoryKey) }} />
                            {story.status || '—'}
                          </span>
                          {story.subtaskCount > 0 && <span>· {story.subtaskCount} subtask{story.subtaskCount === 1 ? '' : 's'}</span>}
                          <span>· 👤 {story.assignee ?? 'Unassigned'}</span>
                        </div>
                        <div style={{ opacity: 0.55, fontSize: 10, marginTop: 2 }}>in {story.featureKey}</div>
                      </button>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11 }}>
                        Move to:
                        <select
                          aria-label={`Move ${story.storyKey} to box`}
                          value={story.effectiveContainerId ?? UNASSIGNED}
                          onChange={(event) => controller.setStoryPlacement(
                            story.featureKey,
                            story.storyKey,
                            event.target.value === UNASSIGNED ? null : event.target.value,
                          )}
                          style={{ flex: 1, fontSize: 11 }}
                        >
                          <option value={UNASSIGNED}>Inherit feature&apos;s box</option>
                          {plannableContainers.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}
                        </select>
                      </label>
                    </li>
                  ))}
                  {storiesInColumn(container.id).length === 0 && <li style={{ opacity: 0.5, fontSize: 12 }}>No stories.</li>}
                </ul>
              </section>
            );
          })}
          </div>
        </div>
        {selectedStory && <StoryInspectorPanel story={selectedStory} onClose={() => setSelectedStory(null)} />}
      </div>
    </div>
  );
}
