// savePreview.ts — What "Save to ServiceNow" will change on one created change: each piece of writing as it is now in
// ServiceNow beside what will be saved, so nothing is written blind.
//
// The "after" side is the very payload the save sends (buildEnvironmentChangePayload); the "now" side is the change as
// ServiceNow holds it (the same snapshot read a modify uses), so the preview cannot disagree with the save.

import { buildEnvironmentChangePayload, type EnvironmentKey } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { CreatedChangeSummary } from './createOutcome.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';

/** One field that will change: what ServiceNow holds now, and what the save writes. */
export interface SavePreviewRow {
  label: string;
  nowText: string;
  afterText: string;
}

/** The writing the preview compares — the fields a person reads before approving. */
const PREVIEW_FIELDS: ReadonlyArray<{ recordField: string; label: string }> = [
  { recordField: 'short_description', label: 'Title' },
  { recordField: 'description', label: 'Description' },
  { recordField: 'justification', label: 'Justification' },
  { recordField: 'risk_impact_analysis', label: 'Risk and impact' },
  { recordField: 'implementation_plan', label: 'Implementation plan' },
  { recordField: 'backout_plan', label: 'Backout plan' },
  { recordField: 'test_plan', label: 'Test plan' },
];

/** The fields whose saved text differs from what ServiceNow holds now, in reading order. */
export function buildSavePreviewRows(snapshot: Readonly<Record<string, string>>, payload: Readonly<Record<string, unknown>>): SavePreviewRow[] {
  return PREVIEW_FIELDS.flatMap(({ recordField, label }) => {
    const nowText = (snapshot[recordField] ?? '').trim();
    const afterValue = payload[recordField];
    const afterText = typeof afterValue === 'string' ? afterValue.trim() : '';
    return nowText === afterText ? [] : [{ label, nowText, afterText }];
  });
}

/** Reads one created change and lists what saving the draft to it will change. */
export async function readSavePreview(draft: CrgDraftState, createdChange: CreatedChangeSummary): Promise<SavePreviewRow[]> {
  if (!createdChange.environmentLabel) return [];
  const snapshot = await fetchChangeSnapshot(createdChange.changeNumber);
  const payload = buildEnvironmentChangePayload(draft, createdChange.environmentLabel.toLowerCase() as EnvironmentKey);
  return buildSavePreviewRows(snapshot, payload);
}
