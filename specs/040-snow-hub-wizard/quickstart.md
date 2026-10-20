# Quickstart: SNow Hub Wizard — validation

Live checks run by the owner in production (Jira/ServiceNow are reachable only there). Unit suites must be green first:
`npm test` (root) and `cd client && npx vitest run`.

## Phase A — Relay Probe

`npm run build:snow-wizard-probe` → `dist/snow-wizard-probe.html`. Open it, follow its steps, paste the result block into
`research.md` § R-001 and pick the branch of the decision tree. **Stop here if P-SNOW-BLOB fails.**

## Phase B onward

`npm run build:snow-wizard` → `dist/snow-hub-wizard.html`. Email it to yourself, open it from the attachment.

| ID | Scenario | Expected |
|---|---|---|
| V-01 | Fresh browser profile: open file, drag bookmark, open ServiceNow, click, open Jira from the app, click | both rows "connected as <you>" in < 5 min (SC-006a) |
| V-02 | New change from a release with 3 issues, REL + PRD | scope lists 3; remove 1, add 1 by key |
| V-03 | Choose Implementation, Technical Checkout, Business Checkout | Business Checkout ticked PRD, unticked REL |
| V-04 | Leave backout plan empty → checks | "needs action" with one fix; fixing clears it |
| V-05 | Production window needing approval | email copyable, PDF saves; REL-only change skips the step with reason |
| V-06 | Create | 2 CHGs; Business Checkout only on PRD; evidence attached; result lists all |
| V-07 | Modify: load V-06's PRD CHG, change only planning | only planning written; other steps untouched |
| V-08 | Edit the same CHG in ServiceNow, then save in the wizard | conflict warning shows both values |
| V-09 | Load a closed CHG | offered Review instead |
| V-10 | PRB → Jira: search, pick Epic, create | Defect + SL + QE on the Epic; both stories linked to Defect |
| V-11 | Break the QE create (e.g. remove permission), retry | no second Defect/SL; QE created on retry |
| V-12 | Re-select the same PRB | existing keys shown; duplicate needs confirmation |
| V-13 | Review V-06's CHG after blanking a field in ServiceNow | coaching names exactly that gap, in plain English |
| V-14 | Review and wizard step 9 on the same change | identical verdicts (SC-005) |
| V-15 | Review session in DevTools Network | zero non-GET requests |
| V-16 | Close the ServiceNow tab mid-wizard | amber banner; reconnect resumes on the same step |
| V-17 | Refresh the app window mid-job | "Continue" resumes at the right step |
