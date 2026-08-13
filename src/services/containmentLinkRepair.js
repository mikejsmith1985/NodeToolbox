// containmentLinkRepair.js — Deciding which containment links were written backwards, and how to fix them.
//
// Until v0.168.4 this app created containment links with the two ends swapped: Jira's create payload
// names each end by ROLE, not by the phrase it will display, and we had that backwards. The result is
// links reading "the Dev story is contained within the SL story" — the reverse of what the team meant.
//
// Jira has no route to reverse a link. Repairing one means deleting it and creating it again the other
// way round, which is a destructive operation against production data, so this module makes the
// DECISION and nothing else. It reads issues, classifies each containment link, and returns a plan.
// The script that owns the writing refuses to act without an explicit confirmation.
//
// The hard part is not the swap; it is knowing WHICH links are wrong. "Backwards" is a statement about
// intent, and intent is not recorded in a Jira link. So this module never guesses:
//
//   • A Story promoted from a sub-task carries a description saying so, naming the sub-task's old
//     parent. That is ground truth — the promoted Story belongs INSIDE that parent — and any link
//     saying the opposite is provably backwards.
//   • Everything else is reported for a human to judge, never repaired automatically. A link somebody
//     made by hand in Jira may be exactly as they intended it.

'use strict';

// ── Named constants ──

/** The relationship a repaired link must express, from the contained issue's side. */
const CONTAINMENT_PHRASE = 'contained within';

/**
 * The sentence the promotion tool writes into a new Story's description.
 *
 * It names the sub-task and the parent that sub-task belonged to, which is what makes the intended
 * direction knowable rather than guessable.
 */
const PROMOTED_DESCRIPTION_PATTERN = /Promoted from sub-task\s+([A-Z][A-Z0-9]*-\d+)\s+of\s+([A-Z][A-Z0-9]*-\d+)/i;

/** Loosens a link phrase so "is contained within" and "Contained within" compare equal. */
function normalizeLinkPhrase(linkPhrase) {
  return String(linkPhrase || '').toLowerCase().replace(/^is\s+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Reads the parent a promoted Story was created from.
 *
 * Null for any issue the promotion tool did not create, which is most of them — and the reason those
 * are left alone rather than repaired on a hunch.
 */
function readPromotedFromParentKey(issue) {
  const description = String(issue?.fields?.description || '');
  const match = PROMOTED_DESCRIPTION_PATTERN.exec(description);
  return match ? match[2].toUpperCase() : null;
}

/**
 * Describes one containment link as seen from the issue holding it.
 *
 * Which phrase applies to this issue depends on which end it sits on: an entry naming `inwardIssue`
 * means this issue is the outward end and reads with the INWARD phrase; an entry naming `outwardIssue`
 * means it reads with the OUTWARD phrase. Getting this backwards is the original bug, so it is stated
 * once, here, and every caller uses it.
 */
function describeContainmentLink(issue, issueLink) {
  const otherEndKey = issueLink?.inwardIssue?.key || issueLink?.outwardIssue?.key || '';
  if (!otherEndKey) return null;

  const isThisIssueTheOutwardEnd = Boolean(issueLink?.inwardIssue?.key);
  const phraseForThisIssue = isThisIssueTheOutwardEnd
    ? issueLink?.type?.inward
    : issueLink?.type?.outward;
  const phraseForOtherEnd = isThisIssueTheOutwardEnd
    ? issueLink?.type?.outward
    : issueLink?.type?.inward;

  const isThisIssueContained = normalizeLinkPhrase(phraseForThisIssue) === CONTAINMENT_PHRASE;
  const isOtherEndContained = normalizeLinkPhrase(phraseForOtherEnd) === CONTAINMENT_PHRASE;
  if (!isThisIssueContained && !isOtherEndContained) return null;

  return {
    linkId: String(issueLink?.id || ''),
    linkTypeName: String(issueLink?.type?.name || ''),
    linkTypeInward: String(issueLink?.type?.inward || ''),
    linkTypeOutward: String(issueLink?.type?.outward || ''),
    issueKey: String(issue.key),
    otherEndKey: String(otherEndKey),
    /** The key the link currently says is INSIDE the other. */
    containedKey: isThisIssueContained ? String(issue.key) : String(otherEndKey),
    containerKey: isThisIssueContained ? String(otherEndKey) : String(issue.key),
  };
}

/** Every containment link on one issue, described from that issue's point of view. */
function readContainmentLinks(issue) {
  const issueLinks = Array.isArray(issue?.fields?.issuelinks) ? issue.fields.issuelinks : [];
  return issueLinks
    .map((issueLink) => describeContainmentLink(issue, issueLink))
    .filter((describedLink) => describedLink !== null);
}

/**
 * Builds the payload that creates a containment link the RIGHT way round.
 *
 * Jira's create payload reads `{ inwardIssue: I, outwardIssue: O }` as "I <outward> O" and equally
 * "O <inward> I". So the issue that must read "contained within" belongs on whichever side carries
 * that phrase — the outwardIssue for a conventionally worded link type, the inwardIssue for one worded
 * the other way round. Both are handled, because an instance is free to word it either way.
 */
function buildRepairedLinkPayload(describedLink, containedKey, containerKey) {
  const isContainmentTheInwardPhrase =
    normalizeLinkPhrase(describedLink.linkTypeInward) === CONTAINMENT_PHRASE;

  return {
    type: { name: describedLink.linkTypeName },
    inwardIssue: { key: isContainmentTheInwardPhrase ? containerKey : containedKey },
    outwardIssue: { key: isContainmentTheInwardPhrase ? containedKey : containerKey },
  };
}

/**
 * Classifies every containment link across the given issues.
 *
 * Three outcomes and no fourth, because silently dropping a link is how a wrong one survives a repair:
 *
 *   • `backwards`   — a promoted Story's description proves the intended direction and the link
 *                     contradicts it. These are the only ones the repair will write.
 *   • `correct`     — the link already matches the promotion evidence. Nothing to do.
 *   • `unverifiable` — no evidence of intent. Reported for a human, never touched.
 */
function classifyContainmentLinks(issues) {
  const issuesByKey = new Map((issues || []).map((issue) => [String(issue.key).toUpperCase(), issue]));
  const seenLinkIds = new Set();
  const classifications = [];

  for (const issue of issues || []) {
    for (const describedLink of readContainmentLinks(issue)) {
      // A link is visible from both ends; judging it twice would offer to repair it twice.
      if (describedLink.linkId !== '' && seenLinkIds.has(describedLink.linkId)) continue;
      if (describedLink.linkId !== '') seenLinkIds.add(describedLink.linkId);

      // Evidence can sit on either end — whichever of the pair is the promoted Story.
      const containedIssue = issuesByKey.get(describedLink.containedKey.toUpperCase());
      const containerIssue = issuesByKey.get(describedLink.containerKey.toUpperCase());
      const promotedParentOfContained = readPromotedFromParentKey(containedIssue);
      const promotedParentOfContainer = readPromotedFromParentKey(containerIssue);

      if (promotedParentOfContained
        && promotedParentOfContained === describedLink.containerKey.toUpperCase()) {
        classifications.push({ kind: 'correct', link: describedLink });
        continue;
      }

      if (promotedParentOfContainer
        && promotedParentOfContainer === describedLink.containedKey.toUpperCase()) {
        // The promoted Story is currently the CONTAINER of the very parent it was promoted out of.
        classifications.push({
          kind: 'backwards',
          link: describedLink,
          shouldBeContainedKey: describedLink.containerKey,
          shouldBeContainerKey: describedLink.containedKey,
          evidence: `${describedLink.containerKey} was promoted from a sub-task of ${describedLink.containedKey}`,
        });
        continue;
      }

      classifications.push({
        kind: 'unverifiable',
        link: describedLink,
        reason: 'Neither end is a promoted Story, so the intended direction is not recorded anywhere.',
      });
    }
  }

  return classifications;
}

/** One line describing what a repair would do, for the plan output. */
function describeRepair(classification) {
  if (classification.kind !== 'backwards') return '';
  return `${classification.link.containedKey} currently contains ${classification.link.containerKey}`
    + ` — should be ${classification.shouldBeContainedKey} contained within ${classification.shouldBeContainerKey}`
    + ` (${classification.evidence})`;
}

/** A one-line summary of a whole classification run. */
function summarizeClassifications(classifications) {
  const counts = { backwards: 0, correct: 0, unverifiable: 0 };
  for (const classification of classifications || []) {
    counts[classification.kind] = (counts[classification.kind] || 0) + 1;
  }

  return `${counts.backwards} backwards, ${counts.correct} already correct,`
    + ` ${counts.unverifiable} unverifiable (left alone).`;
}

module.exports = {
  buildRepairedLinkPayload,
  classifyContainmentLinks,
  describeContainmentLink,
  describeRepair,
  readContainmentLinks,
  readPromotedFromParentKey,
  summarizeClassifications,
  CONTAINMENT_PHRASE,
};
