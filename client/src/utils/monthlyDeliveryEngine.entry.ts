// monthlyDeliveryEngine.entry.ts — esbuild entry for the server-side Monthly Delivery Report engine.
//
// Bundled to src/services/generated/monthlyDeliveryEngine.cjs (npm run build:monthly-delivery-engine)
// so the server scheduler classifies delivery with the SAME ladder and feature-link rules the client
// uses — never a reimplementation (feature 018, contracts/engine-bundle.md).
//
// RULE: only pure functions and constants may be re-exported here. Nothing that touches browser APIs
// (localStorage, document, window) — specifically NOT loadConfiguredFeatureLinkFieldId; the configured
// feature-link field id reaches the server through scheduler config instead.

export {
  EXTERNAL_TESTING_STATUS_NAME,
  READY_TO_ACCEPT_STATUS_NAME,
  DONE_CATEGORY_STATUS_NAMES,
  isDeliveredWorkflowStatusName,
  isDeliveredIssue,
  resolveDeliveryDateIso,
  resolveDoneEntryDateIso,
} from './workflowDelivery.ts';

export {
  FEATURE_LINK_DEFAULT_FIELD,
  EPIC_LINK_FIELD,
  featureLinkCandidateFieldIds,
  extractIssueKeyFromLinkValue,
  extractFeatureKeyFromIssueFields,
} from './featureLink.ts';
