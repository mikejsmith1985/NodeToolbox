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
  parseConfidenceVoteTable,
  writeConfidenceVoteTable,
  createEmptyPiReviewRow,
} from './piReviewTable.ts';

export {
  reconcilePiReviewRowsWithJira,
  extractPiReviewFeatureKey,
} from './piReviewJira.ts';

export { buildDirectFeatureJql } from './piReviewPullFeatures.ts';
