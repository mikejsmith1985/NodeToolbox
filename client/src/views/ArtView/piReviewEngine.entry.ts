// piReviewEngine.entry.ts — Single entry point bundled (by esbuild) into a CommonJS module the Node
// server can `require`. It re-exports ONLY the pure PI Review functions the server-side scheduler
// needs, so client and server share one engine source with zero drift. The client keeps importing
// these from their original modules directly; only the server consumes the generated .cjs.
//
// Server usage: call setPiReviewDomParser(new (require('linkedom').DOMParser)()) once, then use the
// parse/reconcile/write functions exactly as the browser does.

export {
  setPiReviewDomParser,
  parsePiReviewTable,
  writePiReviewTable,
  parsePiReviewCapacitySummary,
  writePiReviewCapacitySummary,
  stripToolboxPiReviewTitleSection,
  parseConfidenceVoteTable,
  writeConfidenceVoteTable,
  createEmptyPiReviewRow,
} from './piReviewTable.ts';

export {
  reconcilePiReviewRowsWithJira,
  extractPiReviewFeatureKey,
} from './piReviewJira.ts';

export { buildDirectFeatureJql } from './piReviewPullFeatures.ts';
export { computePiReviewLoadComparison } from './piReviewLoad.ts';

// Delivery-milestone derivation (GH #262) — pure, shared with the browser so the scheduled refresh
// and the manual save derive Dev Start / Dev Test / INT/PVS / Prod Deploy identically.
export {
  DEFAULT_DEV_START_STATUS_NAME,
  buildPiReviewChildStoryJql,
  buildStatusCategoryMap,
  collectDeliverySubtaskKeys,
  derivePiReviewDeliveryDatesByFeature,
} from './piReviewDeliveryDates.ts';
export { FEATURE_LINK_DEFAULT_FIELD, featureLinkCandidateFieldIds } from '../../utils/featureLink.ts';
