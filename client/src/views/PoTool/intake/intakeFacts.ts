// intakeFacts.ts — Re-reads everything Toolbox can know about an item from its own lines — named Jira keys, stated
// T-shirt sizes, and "future conversation"-style evidence — and lets the rules settle what they can (spec 037).
//
// This is the single place item facts are recomputed, so the notes' first grouping and any later regrouping always
// agree on what an item's lines say.

import {
  readSettledValue,
  type IntakeItem,
  type NamedKey,
  type SourceLine,
} from './epicIntakeModel.ts';
import { refreshApplicability, settleDecision } from './intakeChecklist.ts';
import { findDeferralEvidence } from './deferralEvidence.ts';
import { extractNamedKeys } from './namedKeys.ts';
import { decideOwnerFromSizes, parseAreaSizes } from './ownershipRule.ts';

/** Keeps what was already looked up for a key the item still names, so regrouping never forgets a Jira answer. */
function carryForwardLookups(freshKeys: readonly NamedKey[], previousKeys: readonly NamedKey[]): NamedKey[] {
  return freshKeys.map((freshKey) => {
    const previous = previousKeys.find((candidate) => candidate.key === freshKey.key);
    return previous === undefined ? freshKey : { ...freshKey, lookup: previous.lookup };
  });
}

function settleKindFromEvidence(item: IntakeItem): IntakeItem {
  if (item.deferralEvidence === null) {
    return item;
  }
  const reason = `Notes say "${item.deferralEvidence.phrase}"`;
  return { ...item, decisions: { ...item.decisions, kind: settleDecision(item.decisions.kind, item.deferralEvidence.kind, 'rule', reason) } };
}

/**
 * Settles the owner from stated sizes when they decide it, or hands it to the PO when they tie. When sizes say
 * nothing the owner is left open for the estimate. An owner the PO chose is never touched.
 */
function settleOwnerFromSizes(item: IntakeItem): IntakeItem {
  const sizeRule = decideOwnerFromSizes(item.areaSizes);
  if (sizeRule.owner === undefined || readSettledValue(item.decisions.owner) !== null) {
    return item;
  }
  // Equal stated sizes mean both teams carry the same weight: that is Shared, decided here and flagged for
  // review, never put to the PO as a question (GH #387 feedback).
  const isTie = sizeRule.owner === null;
  const owner = settleDecision(item.decisions.owner, sizeRule.owner ?? 'shared', 'rule', sizeRule.reason);
  return { ...item, reviewFlag: isTie ? `Shared: ${sizeRule.reason}` : item.reviewFlag, decisions: { ...item.decisions, owner } };
}

/**
 * Recomputes an item's facts from its current lines and applies every rule that can decide without anyone being
 * asked: deferral evidence on the title line settles the kind, and stated sizes settle the owner (FR-013, FR-014).
 */
export function deriveItemFacts(item: IntakeItem, lines: readonly SourceLine[]): IntakeItem {
  const itemLines = lines.filter((line) => item.lineNumbers.includes(line.lineNumber));
  const withFacts: IntakeItem = {
    ...item,
    namedKeys: carryForwardLookups(extractNamedKeys(lines, item.lineNumbers), item.namedKeys),
    deferralEvidence: findDeferralEvidence(itemLines),
    areaSizes: itemLines.flatMap((line) => parseAreaSizes(line)),
  };
  return refreshApplicability(settleOwnerFromSizes(settleKindFromEvidence(withFacts)));
}
