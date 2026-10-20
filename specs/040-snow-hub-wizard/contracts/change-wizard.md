# Contract: Change Wizard (P1 Create, P2 Modify)

Driven by `useCrgState({ storageKey: 'snowWizard:change:<jobId>' })`.

## Steps

| # | Step | Uses | Done when |
|---|---|---|---|
| 1 | What's in this change? (scope) | existing fetch-by-fixVersion / JQL + `addIssues` | ≥ 1 issue |
| 2 | Tell us about the change (basic info) | template pre-fill, ServiceNow choice lists | required values set |
| 3 | How will it go? (planning) | implementation / backout / test plans | required values set |
| 4 | Where and when? (environments + windows) | REL / PRD / PFIX cards | ≥ 1 env, dates ordered |
| 5 | Make it better with AI (optional) | `chgRiskCheckPrompt` + ingest, propose-only, always visible (no unlock) | skipped or reviewed |
| 6 | Add proof (evidence) | `testEvidence/*` | optional; files listed |
| 7 | Which tasks are needed? | ServiceNow `change_task_type` choices, CTASK templates | ≥ 1 task |
| 8 | Which environment needs each task? | `ctaskEnvironmentPlan.ts` | every task ≥ 1 env |
| 9 | Will it pass review? (checks) | 039 engine; fixes = AI gap-fix prompt or jump to step | `isReady` or acknowledged |
| 10 | Production paperwork (only if needed) | `rcpApprovalEmail`, `changePlanDocument` | copied / saved or skipped with reason |
| 11 | Create / Save | `createChg(envValues, { ctaskEnvironmentPlan })` / `updateExistingChg` | result screen |

Modify (P2) starts with **Which change?** (number → load), pre-fills 1–8, marks edited steps, and step 11 is **Save**;
unchanged steps are not written. Closed/cancelled changes go to Review instead.

## `ctaskEnvironmentPlan.ts` (pure)

- `seedCtaskEnvironmentPlan(selectedTypes, enabledEnvs, savedDefaults): CtaskEnvironmentPlan`
- `listPlanErrors(plan, enabledEnvs): string[]` — a task with no env; a tick on a disabled env.
- `filterStagedCtasksForEnvironment(staged, plan, envKey)` — used inside `createChg` (drift 1).

Defaults: Implementation → all; Technical Checkout → all; Business Checkout → PRD + PFIX, not REL; unknown → all.

## `useCrgState.createChg` change (drift 1)

`createChg(environmentValueByKey?, options?: { ctaskEnvironmentPlan?: CtaskEnvironmentPlan })`. Absent ⇒ identical to
today; Toolbox callers unchanged; existing `useCrgState` tests pass unmodified.

## Result screen

Lists per environment: CHG number (link), CTASKs created, outage created/not needed, PRBs linked, evidence attached,
and every failure with a **Retry what's missing** (reuses `createChg`'s retry targets — never duplicates a CHG).
