// subStatusFieldPayload.ts — Writing the sub-status field the way THIS Jira actually defines it.
//
// The board was sending `{ value: "Testing" }` for every sub-status write and hoping Jira agreed.
// On an instance where Sub-Status is a CASCADING select — a parent option with children under it —
// Jira reads that outer object as the parent and answers:
//
//   400 — Could not find valid 'id' or 'value' in the Parent Option object.
//
// which tells the user nothing and left the card unmovable on the board even though the same change
// made by hand in Jira worked fine.
//
// The fix is to stop guessing. The issue's own edit metadata lists exactly which options the field
// accepts and how they nest, so the wanted value is looked up in that list — at BOTH levels, since a
// column mapping may name a parent ("Working") or a child ("Code Review") and the board has no way to
// know which. Whatever is found decides the shape of the write. What cannot be found is reported by
// name, with the valid options listed, instead of being posted anyway to produce a 400.

import type { FeatureReviewEditMetaAllowedValue, FeatureReviewEditMetaField } from '../featureReviewFixes.ts';

/** The Jira field value for a sub-status write. `null` clears the field. */
export type SubStatusFieldValue =
  | null
  | { id: string }
  | { value: string }
  | { id: string; child: { id: string } }
  | { value: string; child: { value: string } };

/** Where a wanted value was found in the option tree. */
export interface SubStatusOptionMatch {
  parent: FeatureReviewEditMetaAllowedValue;
  /** Set when the wanted value was a child rather than a top-level option. */
  child: FeatureReviewEditMetaAllowedValue | null;
}

/** Compares option labels the way Jira presents them: trimmed, and casing is not a real distinction. */
function normalizeLabel(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** True when this option is the one being looked for, by any of the labels Jira might use for it. */
function doesOptionMatch(option: FeatureReviewEditMetaAllowedValue, wantedValue: string): boolean {
  const wanted = normalizeLabel(wantedValue);
  return [option.id, option.value, option.name, option.key]
    .some((candidateLabel) => normalizeLabel(candidateLabel) === wanted && wanted !== '');
}

/**
 * Finds a wanted sub-status among the field's options, parents first and then children.
 *
 * Parents are searched first because a value that is BOTH a parent and somebody's child is far more
 * likely meant as the parent — that is the option the field offers at the top level.
 *
 * When the value is only ever a child and several parents carry it, the parent whose own label
 * matches the target status wins. That is not a tie-break for its own sake: on this instance the
 * cascading field's parents mirror the statuses, so "the Testing under Ready for Testing" is exactly
 * what a column mapping of `Ready for Testing / Testing` is naming.
 */
export function findSubStatusOption(
  allowedValues: readonly FeatureReviewEditMetaAllowedValue[],
  wantedValue: string,
  targetStatusName: string,
): SubStatusOptionMatch | null {
  const topLevelMatch = (allowedValues ?? []).find((option) => doesOptionMatch(option, wantedValue));
  if (topLevelMatch) return { parent: topLevelMatch, child: null };

  const childMatches: SubStatusOptionMatch[] = [];
  for (const parentOption of allowedValues ?? []) {
    for (const childOption of parentOption.children ?? []) {
      if (doesOptionMatch(childOption, wantedValue)) childMatches.push({ parent: parentOption, child: childOption });
    }
  }

  if (childMatches.length === 0) return null;
  if (childMatches.length === 1) return childMatches[0];

  const statusAlignedMatch = childMatches.find((match) => doesOptionMatch(match.parent, targetStatusName));
  return statusAlignedMatch ?? childMatches[0];
}

/** Prefers an option's id, which is stable, over its label, which an admin can rename. */
function readOptionReference(option: FeatureReviewEditMetaAllowedValue): { id: string } | { value: string } | null {
  if (option.id !== undefined && option.id !== '') return { id: option.id };
  const label = option.value ?? option.name ?? option.key;
  return label !== undefined && label !== '' ? { value: label } : null;
}

/** Turns a located option into the exact field value Jira expects for it. */
export function buildSubStatusFieldValue(match: SubStatusOptionMatch): SubStatusFieldValue | null {
  const parentReference = readOptionReference(match.parent);
  if (parentReference === null) return null;

  if (match.child === null) return parentReference;

  const childReference = readOptionReference(match.child);
  if (childReference === null) return null;

  // Jira wants the parent AND the child in one object; sending the child alone is what produced
  // "Could not find valid 'id' or 'value' in the Parent Option object".
  return 'id' in parentReference && 'id' in childReference
    ? { id: parentReference.id, child: { id: childReference.id } }
    : {
      value: 'value' in parentReference ? parentReference.value : parentReference.id,
      child: { value: 'value' in childReference ? childReference.value : childReference.id },
    };
}

/** Every label the field will accept, for saying what a value should have been. */
export function listSelectableSubStatusLabels(
  allowedValues: readonly FeatureReviewEditMetaAllowedValue[],
): string[] {
  const labels: string[] = [];
  for (const parentOption of allowedValues ?? []) {
    const parentLabel = parentOption.value ?? parentOption.name ?? parentOption.key ?? '';
    if (parentLabel !== '') labels.push(parentLabel);
    for (const childOption of parentOption.children ?? []) {
      const childLabel = childOption.value ?? childOption.name ?? childOption.key ?? '';
      if (childLabel !== '') labels.push(`${parentLabel} / ${childLabel}`);
    }
  }
  return labels;
}

/**
 * Says why a sub-status could not be written, in terms the user can act on.
 *
 * Naming the valid options is the point: a mapping that says "Testing" where the field calls it
 * "Ready for Testing / Testing" is a two-second fix in Board setup, but only if somebody is told.
 */
export function describeSubStatusMismatch(
  wantedValue: string,
  allowedValues: readonly FeatureReviewEditMetaAllowedValue[],
): string {
  const selectableLabels = listSelectableSubStatusLabels(allowedValues);

  if (selectableLabels.length === 0) {
    return `This issue's sub-status field offers no options at all, so "${wantedValue}" cannot be set.`
      + ' It may not be on this issue type\'s screen.';
  }

  return `Jira's sub-status field has no option called "${wantedValue}" for this issue.`
    + ` It accepts: ${selectableLabels.join(', ')}.`
    + ' Correct the column\'s mapping in Board setup to one of those.';
}

/**
 * Works out the exact value to write for a wanted sub-status, or explains why it cannot be written.
 *
 * A `null` wanted value means clear the field, which needs no lookup — there is no allowed value
 * meaning "none", so an empty write is the only way to say it.
 */
export function resolveSubStatusFieldValue(
  editMetaField: FeatureReviewEditMetaField | undefined,
  wantedValue: string | null,
  targetStatusName: string,
): { kind: 'write'; fieldValue: SubStatusFieldValue } | { kind: 'unwritable'; reason: string } {
  if (wantedValue === null) return { kind: 'write', fieldValue: null };

  const allowedValues = editMetaField?.allowedValues ?? [];

  // No metadata at all means the field is not editable on this issue — worth saying, because posting
  // a guess would fail with Jira's own wording instead of ours.
  if (allowedValues.length === 0) {
    return { kind: 'unwritable', reason: describeSubStatusMismatch(wantedValue, allowedValues) };
  }

  const match = findSubStatusOption(allowedValues, wantedValue, targetStatusName);
  if (match === null) {
    return { kind: 'unwritable', reason: describeSubStatusMismatch(wantedValue, allowedValues) };
  }

  const fieldValue = buildSubStatusFieldValue(match);
  if (fieldValue === null) {
    return { kind: 'unwritable', reason: describeSubStatusMismatch(wantedValue, allowedValues) };
  }

  return { kind: 'write', fieldValue };
}
