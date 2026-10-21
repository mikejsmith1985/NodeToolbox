// missingField.ts — Finds the first field on a step that still needs a value, so "Show me" can scroll to it and point it out.
//
// A step marks its required fields in words the user reads ("(needed)" in the label, as every guided step does), so
// this reads the same words rather than asking each step to register its fields: a field labelled "needed" and still
// empty is what a blocked Next is waiting for. A date or time box left empty counts too (the environments step).

/** How long the pointed-out field keeps its highlight. */
const HIGHLIGHT_MILLISECONDS = 2500;
/** The attribute the highlight is drawn with (see GuidedFlowShell.module.css). */
export const MISSING_FIELD_ATTRIBUTE = 'data-missing-field';
const NEEDED_MARKER = /\bneeded\b/i;
const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea';

/** The words that name a field: its label(s), its aria-label, or a label element right before it. */
function readFieldName(field: HTMLElement): string {
  const labelText = Array.from((field as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? '').join(' ');
  const ariaText = field.getAttribute('aria-label') ?? '';
  const previousElement = field.previousElementSibling;
  const precedingText = previousElement?.tagName === 'LABEL' ? previousElement.textContent ?? '' : '';
  return `${labelText} ${ariaText} ${precedingText}`;
}

/** True when the field holds nothing yet. */
function isFieldEmpty(field: HTMLElement): boolean {
  return ((field as HTMLInputElement).value ?? '').trim() === '';
}

/** True for an empty date or time part — "REL day", "PRD hour" and the like. */
function isEmptyDatePart(field: HTMLElement): boolean {
  return isFieldEmpty(field) && /\b(day|hour|minutes|start|end)\b/i.test(field.getAttribute('aria-label') ?? '');
}

/** The first empty field marked "needed" (or, failing that, the first empty date part) inside the step. */
export function findFirstMissingField(container: HTMLElement): HTMLElement | null {
  const fields = Array.from(container.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  return fields.find((field) => isFieldEmpty(field) && NEEDED_MARKER.test(readFieldName(field)))
    ?? fields.find(isEmptyDatePart)
    ?? null;
}

/**
 * Scrolls to the first missing field, puts the cursor in it and highlights it for a moment. Returns false when
 * nothing on the step looks missing (the blocked reason then has to speak for itself).
 */
export function pointToFirstMissingField(container: HTMLElement | null): boolean {
  const missingField = container ? findFirstMissingField(container) : null;
  if (!missingField) return false;
  missingField.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  missingField.focus();
  missingField.setAttribute(MISSING_FIELD_ATTRIBUTE, 'true');
  window.setTimeout(() => missingField.removeAttribute(MISSING_FIELD_ATTRIBUTE), HIGHLIGHT_MILLISECONDS);
  return true;
}
