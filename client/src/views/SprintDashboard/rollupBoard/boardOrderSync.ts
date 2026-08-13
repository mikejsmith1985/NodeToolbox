// boardOrderSync.ts — Getting the team's priority order to the rest of the team.
//
// Lane order is a real decision: it is the sequence the team agreed to work its Features in. Until
// now it lived in one person's localStorage, which meant the planning session's outcome existed on
// exactly one machine and everybody else saw Features in key order.
//
// Published and pulled explicitly, exactly as the column vocabulary is, and for the same reason: an
// order that changed under you without being shown is worse than no shared order at all. Nothing
// publishes on drag, nothing overwrites on load, and a newer copy does not win by being newer.
//
// The order is stored as KEYS, not positions. A published order that named positions would silently
// re-point at different Features the moment somebody added one; naming keys means a Feature that has
// left the board is simply not found, and one that has arrived is simply not yet ranked.

import { loadBoardOrderStore, saveBoardOrderStore, type BoardOrderRecord } from '../../../services/confluenceApi.ts';
import type { BoardPreferences } from './rollupBoardTypes.ts';

/** One way the team's published order differs from the local one. */
export type OrderDifference =
  | { kind: 'lane-moved'; featureKey: string; fromRank: number | null; toRank: number }
  | { kind: 'lane-unranked'; featureKey: string }
  | { kind: 'cards-reordered'; cellKey: string };

export interface OrderPullPreview {
  /** Null when nobody has published this team's order yet. */
  remote: BoardOrderRecord | null;
  differences: OrderDifference[];
  hasDifferences: boolean;
}

/** A rank counting from 1, or null when this Feature is not in the order at all. */
function readRank(order: readonly string[], featureKey: string): number | null {
  const index = order.indexOf(featureKey);
  return index < 0 ? null : index + 1;
}

/** True when two cells hold the same cards in the same sequence. */
function areCellsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const leftKeys = left ?? [];
  const rightKeys = right ?? [];
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

/**
 * What accepting the team's order would change.
 *
 * Reported per Feature rather than as "the order is different", because a person about to replace
 * their own board's sequence deserves to see which Features move and where to — a single line saying
 * something changed is the unreviewed overwrite this design exists to avoid.
 */
export function compareBoardOrders(
  localPreferences: BoardPreferences,
  remoteOrder: BoardOrderRecord,
): OrderDifference[] {
  const differences: OrderDifference[] = [];
  const localLaneOrder = localPreferences.laneOrder ?? [];
  const remoteLaneOrder = remoteOrder.laneOrder ?? [];

  for (const featureKey of remoteLaneOrder) {
    const fromRank = readRank(localLaneOrder, featureKey);
    const toRank = readRank(remoteLaneOrder, featureKey) ?? 0;
    if (fromRank !== toRank) differences.push({ kind: 'lane-moved', featureKey, fromRank, toRank });
  }

  // A Feature the local board ranks and the published order does not: accepting drops it back to the
  // board's default position, which is a change worth stating rather than discovering.
  for (const featureKey of localLaneOrder) {
    if (!remoteLaneOrder.includes(featureKey)) differences.push({ kind: 'lane-unranked', featureKey });
  }

  const allCellKeys = new Set([
    ...Object.keys(localPreferences.cardOrderByCell ?? {}),
    ...Object.keys(remoteOrder.cardOrderByCell ?? {}),
  ]);
  for (const cellKey of allCellKeys) {
    const isSame = areCellsEqual(
      localPreferences.cardOrderByCell?.[cellKey],
      remoteOrder.cardOrderByCell?.[cellKey],
    );
    if (!isSame) differences.push({ kind: 'cards-reordered', cellKey });
  }

  return differences;
}

/** One readable line per difference, so the preview is a sentence rather than a diff. */
export function describeOrderDifference(difference: OrderDifference): string {
  if (difference.kind === 'lane-unranked') {
    return `${difference.featureKey} is not ranked in the team's order — it returns to its default position.`;
  }
  if (difference.kind === 'cards-reordered') {
    const [featureKey = '', columnId = ''] = difference.cellKey.split('::');
    return `Cards under ${featureKey} in ${columnId} are in a different order.`;
  }
  return difference.fromRank === null
    ? `${difference.featureKey} moves to position ${difference.toRank} (it is unranked here).`
    : `${difference.featureKey} moves from position ${difference.fromRank} to ${difference.toRank}.`;
}

/** Publishes this team's order. Only ordering travels — a collapsed lane stays your own view. */
export async function publishBoardOrder(
  databaseId: string,
  preferences: BoardPreferences,
): Promise<void> {
  const store = await loadBoardOrderStore(databaseId);
  const record: BoardOrderRecord = {
    teamProfileId: preferences.teamProfileId,
    laneOrder: [...(preferences.laneOrder ?? [])],
    cardOrderByCell: { ...(preferences.cardOrderByCell ?? {}) },
    updatedAt: new Date().toISOString(),
  };

  await saveBoardOrderStore(databaseId, {
    ...store,
    orderByTeamProfileId: { ...store.orderByTeamProfileId, [preferences.teamProfileId]: record },
  });
}

/** Reads the team's published order and says what accepting it would change. Changes nothing itself. */
export async function previewBoardOrderPull(
  databaseId: string,
  preferences: BoardPreferences,
): Promise<OrderPullPreview> {
  const store = await loadBoardOrderStore(databaseId);
  const remote = store.orderByTeamProfileId[preferences.teamProfileId] ?? null;
  if (remote === null) return { remote: null, differences: [], hasDifferences: false };

  const differences = compareBoardOrders(preferences, remote);
  return { remote, differences, hasDifferences: differences.length > 0 };
}

/**
 * Applies a published order to the local preferences.
 *
 * Collapsed lanes are carried over untouched — they are the one part of these preferences that is a
 * view rather than a decision, and accepting the team's priorities must not refold your board.
 */
export function applyBoardOrder(
  preferences: BoardPreferences,
  remoteOrder: BoardOrderRecord,
): BoardPreferences {
  return {
    ...preferences,
    laneOrder: [...(remoteOrder.laneOrder ?? [])],
    cardOrderByCell: { ...(remoteOrder.cardOrderByCell ?? {}) },
  };
}
