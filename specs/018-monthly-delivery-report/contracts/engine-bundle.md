# Contract: Monthly Delivery Engine Bundle

**Feature**: `018-monthly-delivery-report`
The server-side delivery-classification logic is NOT reimplemented — it is the client's `workflowDelivery.ts` and
`featureLink.ts` bundled to CommonJS, following the feature-015 `build:pi-review-engine` precedent.

## Entry file — `client/src/utils/monthlyDeliveryEngine.entry.ts`

Re-exports **pure functions and constants only**. It MUST NOT export anything that touches browser APIs
(`localStorage`, `document`, `window`) — specifically NOT `loadConfiguredFeatureLinkFieldId` (localStorage) from
`featureLink.ts`. The configured feature-link field id reaches the server via scheduler config instead
(`featureLinkFieldId`, see http-api.md).

Exports:

| Export | Source | Server use |
|---|---|---|
| `EXTERNAL_TESTING_STATUS_NAME`, `READY_TO_ACCEPT_STATUS_NAME`, `DONE_CATEGORY_STATUS_NAMES` | workflowDelivery.ts | ladder constants |
| `isDeliveredWorkflowStatusName(statusName)` | workflowDelivery.ts | delivered-set membership |
| `isDeliveredIssue(issue)` | workflowDelivery.ts | released-version Production path precondition |
| `resolveDeliveryDateIso(issue)` | workflowDelivery.ts | External Test month attribution (current-run entry, carry-over aware) |
| `resolveDoneEntryDateIso(issue)` | workflowDelivery.ts (**new pure helper**, vitest-tested) | Production status-path attribution: ISO of the most recent transition INTO a done-category status, null when never done / no changelog |
| `featureLinkCandidateFieldIds(featureLinkField)` | featureLink.ts | ordered candidate field ids |
| `extractFeatureKeyFromIssueFields(fields, featureLinkField)` | featureLink.ts | child → Feature key resolution (includes native `parent.key` fallback) |

## Build

- `package.json` script `build:monthly-delivery-engine`:
  `esbuild client/src/utils/monthlyDeliveryEngine.entry.ts --bundle --platform=node --format=cjs
  --outfile=src/services/generated/monthlyDeliveryEngine.cjs`
- Chained into `prestart`, `prebuild:exe`, and `pretest` exactly like `build:pi-review-engine` (the server Jest
  suite requires the `.cjs` to exist).
- Output `src/services/generated/monthlyDeliveryEngine.cjs` is generated — gitignored the same way as
  `piReviewEngine.cjs`.

## Standing constraint (mirrors the 015 constraint — to be recorded in CLAUDE.md)

`workflowDelivery.ts` and `featureLink.ts` are now bundled into a server engine. Any change to them must keep
`npm run build:monthly-delivery-engine` compiling and the server Jest suite green, in addition to their existing
vitest suites.

## Server consumption

```js
const {
  resolveDeliveryDateIso,
  resolveDoneEntryDateIso,
  isDeliveredIssue,
  extractFeatureKeyFromIssueFields,
} = require('./generated/monthlyDeliveryEngine.cjs');
```

The require is top-level (no linkedom-style lazy loading needed — the bundle has no ESM-only dependencies).
