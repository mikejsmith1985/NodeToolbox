// labels.ts — Case-sensitive label handling for templates. Pure (no I/O).
// Jira labels are case-sensitive ("Ops" ≠ "ops") and may not contain spaces. These helpers
// dedupe within a template and union with an issue's existing labels without duplication.

/** Removes exact (case-sensitive) duplicate labels, dropping blanks, preserving order. */
export function dedupeLabels(labels: string[]): string[] {
  const seenLabels = new Set<string>();
  const uniqueLabels: string[] = [];
  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    if (!label || seenLabels.has(label)) {
      continue;
    }
    seenLabels.add(label);
    uniqueLabels.push(label);
  }
  return uniqueLabels;
}

/** A label is valid when it is non-empty and contains no whitespace (Jira's core rule). */
export function isValidLabel(label: string): boolean {
  return label.length > 0 && !/\s/.test(label);
}

/**
 * Builds the label set to write on create: the issue's existing labels plus the template's
 * labels, case-sensitively de-duplicated so no label is added twice (FR-3.3).
 */
export function mergeLabelsForCreate(templateLabels: string[], existingLabels: string[]): string[] {
  return dedupeLabels([...existingLabels, ...templateLabels]);
}
