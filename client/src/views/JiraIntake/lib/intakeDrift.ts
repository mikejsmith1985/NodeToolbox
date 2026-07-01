// intakeDrift.ts — Flags a submission whose mapped choice value no longer exists in Jira, so the
// queue can mark it invalid instead of creating a malformed issue (FR-2.4). Pure (no I/O).
//
// Framework-First note (Article VII): the Template Maker's drift.ts validates option *ids* held on
// TemplateFieldEntry values, but intake maps choice fields *by name* (the Teams card sends "Highest",
// not an option id). So intake needs this small name-based check against the createmeta descriptors
// rather than reusing findTemplateDrift directly.

import type { FieldDescriptor } from '../../JiraTemplateMaker/lib/templateTypes.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

/**
 * Returns human-readable reasons for any choiceByName mapping whose value is not among the field's
 * current allowed options. Returns [] when descriptors are unavailable (cannot validate) or the
 * field has no constrained option list.
 */
export function findChoiceDrift(
  submission: IntakeSubmission,
  config: IntakeConfig,
  descriptors: FieldDescriptor[],
): string[] {
  if (descriptors.length === 0) {
    return [];
  }
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.fieldId, descriptor]));
  const reasons: string[] = [];

  for (const mapping of config.fieldMappings) {
    if (mapping.transform !== 'choiceByName') {
      continue;
    }
    const rawValue = mapping.fixedValue !== undefined ? mapping.fixedValue : submission.fields[mapping.coreField];
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      continue;
    }
    const value = rawValue.trim();

    const descriptor = descriptorById.get(mapping.jiraFieldId);
    // A field absent from createmeta or without a constrained option list is not a drift signal here.
    if (!descriptor || !descriptor.allowedValues || descriptor.allowedValues.length === 0) {
      continue;
    }
    const isAllowed = descriptor.allowedValues.some((option) => option.label.toLowerCase() === value.toLowerCase());
    if (!isAllowed) {
      reasons.push(`${descriptor.name}: "${value}" is not an available option`);
    }
  }

  return reasons;
}
