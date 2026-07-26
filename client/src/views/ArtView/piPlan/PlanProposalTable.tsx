// PlanProposalTable.tsx — Renders the per-item plan proposal with an accept/dismiss control on every
// item (spec 028, US1, FR-052). Purely presentational; nothing writes to Jira on render. Each Story
// shows its assignee, sprint, and Target Start / Target End / Due dates (with derivations on hover) and
// its sub-tasks; an already-present item is shown as existing and cannot be re-created.

import React from 'react';

import type { DatedItem, PlanItemProposal, ScheduledStory } from './piPlanTypes.ts';

interface PlanProposalTableProps {
  items: PlanItemProposal[];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** Human labels for each reviewable item kind. */
const KIND_LABEL: Record<string, string> = {
  story: 'Story',
  internalTest: '[IT] Internal Test',
  deployInt: '[INT] Deploy INT',
  deployRel: '[REL] Deploy REL',
  deployProd: '[PROD] Deploy PROD',
  sprintCreate: 'Create Sprint',
  releaseSuggest: 'Suggested Release',
};

/** The date a sub-task row displays, chosen by its kind; the Story row shows Target Start→End / Due. */
function rowDates(item: PlanItemProposal): string {
  const dates = item.dates as DatedItem | undefined;
  if (!dates) {
    return '';
  }
  switch (item.kind) {
    case 'story': return `${dates.targetStartIso} → ${dates.targetEndIso} (due ${dates.dueIso ?? '—'})`;
    case 'internalTest': return dates.internalTestEndIso ?? '';
    case 'deployInt': return dates.deployIntIso;
    case 'deployRel': return dates.deployRelIso;
    case 'deployProd': return dates.dueIso ?? '';
    default: return '';
  }
}

/** Renders one row: label, summary/assignee/sprint (for a Story), dates, warnings, and the controls. */
function ProposalRow({ item, onAccept, onDismiss }: { item: PlanItemProposal } & Pick<PlanProposalTableProps, 'onAccept' | 'onDismiss'>): React.ReactElement {
  const story = item.kind === 'story' ? (item.payload as ScheduledStory) : null;
  const isExisting = item.status === 'existing';
  return (
    <tr data-kind={item.kind} data-status={item.status} className={item.kind === 'story' ? 'pi-plan-story-row' : 'pi-plan-subtask-row'}>
      <td>{KIND_LABEL[item.kind] ?? item.kind}</td>
      <td>
        {story ? story.summary : ''}
        {story ? <span className="pi-plan-assignment"> — {story.assignee ?? 'Unassigned'} · {story.sprintName}</span> : null}
      </td>
      <td title={(item.dates as DatedItem | undefined)?.derivations?.[item.kind === 'story' ? 'targetEndIso' : 'deployRelIso']}>{rowDates(item)}</td>
      <td className="pi-plan-warnings">{item.warnings.join('; ')}</td>
      <td>
        {isExisting ? (
          <span className="pi-plan-existing">Already in Jira</span>
        ) : (
          <>
            <button type="button" onClick={() => onAccept(item.id)} disabled={item.status === 'accepted'}>
              {item.status === 'accepted' ? 'Accepted' : 'Accept'}
            </button>
            <button type="button" onClick={() => onDismiss(item.id)} disabled={item.status === 'dismissed'}>Dismiss</button>
          </>
        )}
      </td>
    </tr>
  );
}

/** The proposal table — one accept/dismiss control per item; Stories group their sub-tasks beneath them. */
export function PlanProposalTable({ items, onAccept, onDismiss }: PlanProposalTableProps): React.ReactElement {
  if (items.length === 0) {
    return <p className="pi-plan-empty">Nothing to plan — no accepted Stories yet.</p>;
  }
  return (
    <table className="pi-plan-proposal" aria-label="Plan proposal">
      <thead>
        <tr><th>Type</th><th>Summary / owner</th><th>Dates</th><th>Warnings</th><th>Action</th></tr>
      </thead>
      <tbody>
        {items.map((item) => <ProposalRow key={item.id} item={item} onAccept={onAccept} onDismiss={onDismiss} />)}
      </tbody>
    </table>
  );
}
