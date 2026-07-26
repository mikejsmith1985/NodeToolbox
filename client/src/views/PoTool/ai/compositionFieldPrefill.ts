// compositionFieldPrefill.ts — Deterministically fills the structured Jira fields a composed Feature needs
// but the AI can't reliably invent: Program Increment (from the team's selected PI), Product Owner (from
// the team roster), and Application (always "Initial"). Pure and unit-tested; the tab supplies the live
// inputs. Everything is resolved through the app's field config ids (never a hardcoded field name), only
// fills a field that is currently empty (never clobbers), and flags anything it could not resolve so the
// PO sets it by hand. Initiative Type is NOT set here — the AI picks it from the options the prompt supplies.

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';

/** Application is always seeded to this option per the team's working agreement. */
const APPLICATION_DEFAULT_VALUE = 'Initial';

/** The field-config ids this prefill uses — resolved by the app's name→id discovery, passed in by the tab. */
export interface PrefillFieldConfig {
  programIncrementFieldIds: string[];
  productOwnerFieldIds: string[];
  applicationFieldIds: string[];
}

export interface PrefillInputs {
  fieldConfig: PrefillFieldConfig;
  /** The writable fields the issue type actually offers (with allowedValues + schema), from createmeta. */
  descriptors: readonly CreateMetaFieldEntry[];
  /** The draft's current field values — a field is only filled when its current value is empty. */
  currentFields: Record<string, unknown>;
  /** The team's selected PI (SprintDashboardTeamProfile.selectedPiValue), or null when it has none. */
  piValue: string | null;
  /** The team Product Owner's Jira accountId (from the roster), or null when none is on the roster. */
  poAccountId: string | null;
}

export interface PrefillResult {
  /** Field values to merge into the draft (only-when-empty already applied). */
  fields: Record<string, unknown>;
  /** Human-readable notices for fields left blank that the PO must set manually. */
  flags: string[];
}

/** A value counts as empty (so it may be filled) when it is null/undefined/blank/empty collection. */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

/** The first descriptor whose fieldId is one of the configured ids — i.e. the field the issue type offers. */
function findWritableDescriptor(
  candidateFieldIds: string[],
  descriptors: readonly CreateMetaFieldEntry[],
): CreateMetaFieldEntry | null {
  const candidateSet = new Set(candidateFieldIds);
  return descriptors.find((descriptor) => candidateSet.has(descriptor.fieldId)) ?? null;
}

/** Resolves a select/version option to its `{ id }` payload by matching name or value, case-insensitively. */
function resolveOptionPayload(descriptor: CreateMetaFieldEntry, matchText: string): { id: string } | null {
  const target = matchText.trim().toLowerCase();
  const option = (descriptor.allowedValues ?? []).find(
    (allowed) => (allowed.value ?? allowed.name ?? '').trim().toLowerCase() === target,
  );
  return option ? { id: option.id } : null;
}

/**
 * Builds the deterministic field prefill for a composed Feature. Fills only empty, issue-type-offered
 * fields; captures a flag for anything it cannot resolve (missing PI, no PO on the roster, no "Initial"
 * option) so the field is left blank and visibly needs manual attention.
 */
export function buildCompositionPrefill(inputs: PrefillInputs): PrefillResult {
  const { fieldConfig, descriptors, currentFields, piValue, poAccountId } = inputs;
  const fields: Record<string, unknown> = {};
  const flags: string[] = [];

  // ── Program Increment (from the team's selected PI) ──
  const piDescriptor = findWritableDescriptor(fieldConfig.programIncrementFieldIds, descriptors);
  if (piDescriptor && isEmptyValue(currentFields[piDescriptor.fieldId])) {
    if (piValue && piValue.trim() !== '') {
      const option = resolveOptionPayload(piDescriptor, piValue);
      if (option) {
        fields[piDescriptor.fieldId] = option;
      } else {
        flags.push(`Program Increment — “${piValue}” is not an option on this issue type; set it manually.`);
      }
    } else {
      flags.push('Program Increment — the team has no PI selected; set it manually.');
    }
  }

  // ── Product Owner (from the team roster) ──
  const poDescriptor = findWritableDescriptor(fieldConfig.productOwnerFieldIds, descriptors);
  if (poDescriptor && isEmptyValue(currentFields[poDescriptor.fieldId])) {
    if (poAccountId && poAccountId.trim() !== '') {
      fields[poDescriptor.fieldId] = { accountId: poAccountId };
    } else {
      flags.push('Product Owner — no Product Owner found in the team roster; set it manually.');
    }
  }

  // ── Application (always "Initial") ──
  const applicationDescriptor = findWritableDescriptor(fieldConfig.applicationFieldIds, descriptors);
  if (applicationDescriptor && isEmptyValue(currentFields[applicationDescriptor.fieldId])) {
    const option = resolveOptionPayload(applicationDescriptor, APPLICATION_DEFAULT_VALUE);
    if (option) {
      fields[applicationDescriptor.fieldId] = option;
    } else {
      flags.push(`Application — no “${APPLICATION_DEFAULT_VALUE}” option is available; set it manually.`);
    }
  }

  return { fields, flags };
}
