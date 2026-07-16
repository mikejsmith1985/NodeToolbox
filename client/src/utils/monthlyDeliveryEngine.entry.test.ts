// monthlyDeliveryEngine.entry.test.ts — Guards the server-engine entry surface: every export the
// server scheduler requires from the bundled .cjs must exist here, and nothing browser-bound may leak in.

import { describe, expect, it } from 'vitest';

import * as engineEntry from './monthlyDeliveryEngine.entry.ts';

/** The exact export surface contracts/engine-bundle.md promises the server. */
const REQUIRED_ENGINE_EXPORT_NAMES = [
  'EXTERNAL_TESTING_STATUS_NAME',
  'READY_TO_ACCEPT_STATUS_NAME',
  'DONE_CATEGORY_STATUS_NAMES',
  'isDeliveredWorkflowStatusName',
  'isDeliveredIssue',
  'resolveDeliveryDateIso',
  'resolveDoneEntryDateIso',
  'FEATURE_LINK_DEFAULT_FIELD',
  'EPIC_LINK_FIELD',
  'featureLinkCandidateFieldIds',
  'extractIssueKeyFromLinkValue',
  'extractFeatureKeyFromIssueFields',
];

describe('monthlyDeliveryEngine entry surface', () => {
  it('exposes every export the server engine contract requires', () => {
    for (const exportName of REQUIRED_ENGINE_EXPORT_NAMES) {
      expect(engineEntry, `missing engine export: ${exportName}`).toHaveProperty(exportName);
    }
  });

  it('never exports the localStorage-backed feature-link reader (browser API — banned server-side)', () => {
    expect(engineEntry).not.toHaveProperty('loadConfiguredFeatureLinkFieldId');
  });
});
