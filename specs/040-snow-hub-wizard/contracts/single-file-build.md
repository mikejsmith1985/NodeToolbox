# Contract: Single-File Build

`npm run build:snow-wizard` → `scripts/build-snow-wizard.js`:

1. esbuild bundles `client/src/snowWizard/main.entry.tsx` (`bundle`, `minify`, `format: 'iife'`, `alias` + `inject` per
   `wizard-transport.md`, `.module.css` via esbuild's `local-css` loader) → app JS + CSS strings.
2. Wraps them into the **app HTML** (the document the bookmark opens as a blob).
3. Builds the bookmark (`javascript:` + encoded launcher holding the app HTML). Fails the build if it exceeds
   `WIZARD_BOOKMARK_BUDGET_BYTES` (1.5 MB).
4. Writes `dist/snow-hub-wizard.html` — the **launcher page**: product name, version, the draggable bookmark button, and
   numbered, picture-led instructions (drag → open ServiceNow → click → open Jira from the app → click again).

## Built-in defaults

`client/src/snowWizard/wizardDefaults.ts` is the one place for instance addresses baked into the file:
`DEFAULT_SNOW_URL = 'https://zilverton.service-now.com'` (installer's Open ServiceNow button) and `DEFAULT_JIRA_URL`
(same value as `src/config/loader.js`, pre-fills the Jira setting). The Wizard never needs the ServiceNow default at run
time — it runs inside ServiceNow.

## Rules

- Output is **one file**, no external URL of any kind (no CDN, no font links).
- The launcher page itself makes no network calls.
- Version string = root `package.json` version; the app shows it on Home.
- `local-release.ps1` attaches `dist/snow-hub-wizard.html` to the GitHub Release (additive step).
- The probe has its own entry (`probe/relayProbe.entry.ts`) and output `dist/snow-wizard-probe.html`.
