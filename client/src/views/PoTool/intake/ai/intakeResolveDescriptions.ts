// intakeResolveDescriptions.ts — Reads each new Epic's nine-section description from a resolve answer written as a
// document, one "item-3 DESCRIPTION:" section per item (spec 037, GH #499).
//
// A nine-section description is far too long for one table cell, so the resolve request asks for the table first and
// then one labelled description per item that needs a new Epic. Google's AI Mode writes those as headings
// ("item-3 — Description", "### item-3"), adds an intro and a closing offer; this module finds each item's section by
// its label or heading, drops the table rows and the offer, and never writes a description that was not given.

import { readReplySections, type ReplySection } from '../../../../utils/aiReplySections.ts';
import { splitReplyCellsKeepingBlanks } from '../../../../utils/aiReplyTable.ts';
import { resolveItemId } from './intakeReplyEnvelope.ts';

/** The first cell of the resolve table's header row, so that row is dropped with the item rows. */
const TABLE_HEADER_FIRST_CELL = 'item';
// Characters with a meaning inside a regular expression, escaped so an item id is matched literally.
const REGEX_SPECIAL_CHARACTER_PATTERN = /[.*+?^${}()|[\]\\]/g;
// Bold marks an assistant leaves at the start of a section when it bolds the label: "**item-3 DESCRIPTION:**".
const LEADING_BOLD_PATTERN = /^\*+\s*/;

/** The label one item's description starts with: "item-3 DESCRIPTION". */
export function buildDescriptionMarker(itemId: string): string {
  return `${itemId} DESCRIPTION`;
}

/** One description section per item: found by its label, or by a heading that starts with the item's id. */
function buildDescriptionSections(itemIds: readonly string[]): ReplySection[] {
  return itemIds.map((itemId) => {
    const escapedId = itemId.replace(REGEX_SPECIAL_CHARACTER_PATTERN, '\\$&');
    // "item-3", "item-3 — Description", "Description for item-3", "Epic item-3" — but never "item-30".
    const headingPattern = new RegExp(`^(?:epic\\s+)?(?:description\\s+(?:for|of)\\s+)?${escapedId}(?![\\w-])`, 'i');
    return { key: itemId, marker: buildDescriptionMarker(itemId), headingPattern };
  });
}

/** True when a reply line is a row of the answer table — its first cell an item id or the header's "Item". */
function isAnswerTableLine(replyLine: string, itemIds: readonly string[]): boolean {
  const cells = splitReplyCellsKeepingBlanks(replyLine);
  if (cells.length < 2) return false;
  return cells[0].toLowerCase() === TABLE_HEADER_FIRST_CELL || resolveItemId(cells[0], itemIds) !== null;
}

/**
 * Each item's description as written in the answer, keyed by item id. The answer table's own rows are removed first,
 * so a table written after the descriptions never ends up inside the last one. Items with no description are absent.
 */
export function readItemDescriptions(replyText: string, itemIds: readonly string[]): Record<string, string> {
  const proseText = replyText.split(/\r?\n/).filter((replyLine) => !isAnswerTableLine(replyLine, itemIds)).join('\n');
  const sectionTexts = readReplySections(proseText, buildDescriptionSections(itemIds));
  const descriptions: Record<string, string> = {};
  for (const [itemId, sectionText] of Object.entries(sectionTexts)) {
    const description = (sectionText ?? '').replace(LEADING_BOLD_PATTERN, '').trim();
    if (description !== '') descriptions[itemId] = description;
  }
  return descriptions;
}
