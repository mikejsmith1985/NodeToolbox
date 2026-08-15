// editableFieldWrite.test.ts — Proves each field reaches the writer that knows its shape.
//
// The routing is the part that can be wrong. The writers it routes to already shipped and are
// exercised by Feature Review, so these assertions are about the choice, not the request.

import { describe, expect, it, vi } from 'vitest';

import { resolveFieldWriteRoute } from './editableFieldWrite.ts';
import type { EditableFieldPlan, FieldEditorKind } from './editableFieldPlan.ts';

vi.mock('../../views/SprintDashboard/featureReviewFixes.ts', () => ({
  getStoryPointsCandidateFieldIds: () => ['customfield_10002'],
  saveFeatureReviewFixVersion: vi.fn(),
  saveFeatureReviewOptionField: vi.fn(),
  saveFeatureReviewSimpleField: vi.fn(),
  saveFeatureReviewStoryPoints: vi.fn(),
  saveFeatureReviewUserField: vi.fn(),
}));

/** One field plan with only the parts routing looks at. */
function buildPlan(fieldId: string, editorKind: FieldEditorKind): EditableFieldPlan {
  return {
    fieldId, label: fieldId, editorKind, currentValue: '', displayValue: '',
    isEmpty: true, isReplacingList: false, editMetaField: undefined,
  };
}

describe('resolveFieldWriteRoute', () => {
  it('sends fix versions through their own writer, not a plain field write', () => {
    // Jira takes fix versions through the `update`/`set` shape; a field write of an array of names
    // is rejected.
    expect(resolveFieldWriteRoute(buildPlan('fixVersions', 'select'))).toBe('fix-version');
  });

  it('sends story points through their own writer, because on this instance they are a DROPDOWN', () => {
    // Writing a raw number to them fails. Only that writer knows it.
    expect(resolveFieldWriteRoute(buildPlan('customfield_10002', 'number'))).toBe('story-points');
  });

  it('routes by control for everything else', () => {
    expect(resolveFieldWriteRoute(buildPlan('assignee', 'user'))).toBe('user');
    expect(resolveFieldWriteRoute(buildPlan('priority', 'select'))).toBe('option');
    expect(resolveFieldWriteRoute(buildPlan('summary', 'text'))).toBe('simple');
    expect(resolveFieldWriteRoute(buildPlan('customfield_7', 'date'))).toBe('simple');
  });

  it('prefers the special writers over the control they would otherwise imply', () => {
    // Fix versions render as a select and story points as a number; both would route wrong on
    // control alone, which is why the two ids are asked about first.
    expect(resolveFieldWriteRoute(buildPlan('fixVersions', 'select'))).not.toBe('option');
    expect(resolveFieldWriteRoute(buildPlan('customfield_10002', 'number'))).not.toBe('simple');
  });
});
