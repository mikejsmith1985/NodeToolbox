// CoachPanel.tsx — The guided-journey side panel that walks the user through the five stages.
//
// The panel always shows the current stage's job, decision, and output, lets the user jump to
// any stage (non-linear), and surfaces exactly the controls that stage needs — WIP limit and
// parking in Stabilize, MoSCoW buttons in Prioritize, size buttons in Size, container creation
// in Sequence. All guidance addresses the USER; nothing here references or depends on AI.

import { COACH_STAGES, findStage } from './stages.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import type { MoscowBucket, StageId, TshirtSize } from '../overlay/overlayModel.ts';
import type { CanvasNode, WipSnapshot } from '../logic/canvasTypes.ts';
import { TSHIRT_SIZES } from '../logic/sizing.ts';
import controlStyles from '../canvas/canvasControls.module.css';

const MOSCOW_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could', 'Wont'];

/** Props the CoachPanel needs to render stage guidance and act on the selected node/overlay. */
export interface CoachPanelProps {
  controller: CanvasOverlayController;
  selectedNode: CanvasNode | null;
  wip: WipSnapshot;
  onAddContainer: (kind: 'sprint' | 'release') => void;
  onOpenCommit: () => void;
  isAiUnlocked: boolean;
  onOpenAi: () => void;
}

/** A small labelled action button used throughout the stage controls. */
function ActionButton({ label, onClick, isActive }: { label: string; onClick: () => void; isActive?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      className={isActive ? controlStyles.btnPrimary : controlStyles.btn}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Prompt shown when a stage control needs a selected feature but none is selected. */
function SelectHint(): React.JSX.Element {
  return <p style={{ opacity: 0.7 }}>Select a feature on the canvas to act on it.</p>;
}

/** Stage 2 controls: set a WIP limit and park the selected feature. */
function StabilizeControls({ controller, selectedNode, wip }: CoachPanelProps): React.JSX.Element {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 8 }}>
        WIP limit:{' '}
        <input
          type="number"
          min={0}
          value={wip.limit ?? ''}
          onChange={(event) => controller.setWipLimit(event.target.value === '' ? null : Math.max(0, Number(event.target.value)))}
          style={{ width: 64 }}
        />
      </label>
      <p>In progress: {wip.inProgressCount}{wip.overflow > 0 ? ` · ${wip.overflow} over limit` : ''} · Parked: {wip.parkedCount}</p>
      {selectedNode ? (
        <ActionButton
          label={selectedNode.isParked ? 'Un-park selected' : 'Park selected'}
          onClick={() => controller.setParked(selectedNode.issueKey, !selectedNode.isParked)}
        />
      ) : <SelectHint />}
    </div>
  );
}

/** Stage 3 controls: assign the selected feature a MoSCoW bucket. */
function PrioritizeControls({ controller, selectedNode }: CoachPanelProps): React.JSX.Element {
  if (!selectedNode) {
    return <SelectHint />;
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {MOSCOW_BUCKETS.map((bucket) => (
        <ActionButton
          key={bucket}
          label={bucket}
          isActive={selectedNode.priority === bucket}
          onClick={() => controller.setPriority(selectedNode.issueKey, selectedNode.priority === bucket ? null : bucket)}
        />
      ))}
    </div>
  );
}

/** Stage 4 controls: assign the selected feature a relative size. */
function SizeControls({ controller, selectedNode }: CoachPanelProps): React.JSX.Element {
  if (!selectedNode) {
    return <SelectHint />;
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {TSHIRT_SIZES.map((size: TshirtSize) => (
        <ActionButton
          key={size}
          label={size}
          isActive={selectedNode.size === size}
          onClick={() => controller.setSize(selectedNode.issueKey, selectedNode.size === size ? null : size)}
        />
      ))}
    </div>
  );
}

/** Stage 5 controls: create release/sprint boxes and open the commit review. */
function SequenceControls({ onAddContainer, onOpenCommit }: CoachPanelProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <ActionButton label="+ Sprint box" onClick={() => onAddContainer('sprint')} />
      <ActionButton label="+ Release box" onClick={() => onAddContainer('release')} />
      <ActionButton label="Review & Commit →" onClick={onOpenCommit} />
    </div>
  );
}

/** Renders the control cluster for the active stage. */
function StageControls(props: CoachPanelProps): React.JSX.Element {
  const stageId = props.controller.overlay.stageState.currentStageId;
  if (stageId === 'stabilize') return <StabilizeControls {...props} />;
  if (stageId === 'prioritize') return <PrioritizeControls {...props} />;
  if (stageId === 'size') return <SizeControls {...props} />;
  if (stageId === 'sequence') return <SequenceControls {...props} />;
  return <p style={{ opacity: 0.8 }}>Drag features apart so you can see them all. When ready, move to the next stage.</p>;
}

/** The guided coaching side panel. */
export function CoachPanel(props: CoachPanelProps): React.JSX.Element {
  const { controller, isAiUnlocked, onOpenAi } = props;
  const currentStageId: StageId = controller.overlay.stageState.currentStageId;
  const stage = findStage(currentStageId);

  return (
    <aside style={{ width: 320, padding: 16, borderLeft: '1px solid rgba(148,163,184,0.3)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {COACH_STAGES.map((candidate) => (
          <ActionButton
            key={candidate.id}
            label={`${candidate.order}. ${candidate.title}${controller.overlay.stageState.completed[candidate.id] ? ' ✓' : ''}`}
            isActive={candidate.id === currentStageId}
            onClick={() => controller.goToStage(candidate.id)}
          />
        ))}
      </div>
      <h2 style={{ margin: '4px 0' }}>{stage.order}. {stage.title}</h2>
      <p style={{ fontWeight: 600 }}>{stage.job}</p>
      <p>{stage.decision}</p>
      <p style={{ opacity: 0.75, fontStyle: 'italic' }}>Output: {stage.output}</p>
      <hr style={{ opacity: 0.2, margin: '12px 0' }} />
      <StageControls {...props} />
      <hr style={{ opacity: 0.2, margin: '12px 0' }} />
      <ActionButton label="Mark stage complete" onClick={() => controller.completeStage(currentStageId)} />
      {isAiUnlocked && (
        <div style={{ marginTop: 12 }}>
          <ActionButton label="⚡ AI suggestions" onClick={onOpenAi} />
        </div>
      )}
    </aside>
  );
}
