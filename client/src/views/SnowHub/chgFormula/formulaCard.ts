// formulaCard.ts — The Release Manager's Change Request Formula Card, as data and as prompt text (GH #395).
//
// Release Management reviews every change against this card before it enters approval: for each field, a
// formula for what to write, the minimum acceptable answer, and the question the reviewer asks. Holding it
// ONCE here means the prompt that WRITES a change and the prompt that CHECKS it apply the very same rules —
// two copies would drift, and a change written to one version would be failed against the other.
//
// Sections 1-7 only. Section 8 (Closure and Learning) describes closing a change after it ran, which
// neither drafting nor the pre-approval check can speak to.

/** One field of the Formula Card, in the card's own words. */
export interface FormulaCardField {
  section: string;
  field: string;
  whenRequired: string;
  formula: string;
  minimumAcceptable: string;
  reviewerTest: string;
  evidenceExpected: string;
  specialConsiderations: string;
}

/** One of the five questions every change must pass before it enters approval. */
export interface FormulaCardQualityGateItem {
  question: string;
  passStandard: string;
}

/** The seven free-text fields a ServiceNow change carries, which AI Assist drafts. */
export type ChgTextFieldKey =
  | 'shortDescription'
  | 'description'
  | 'justification'
  | 'riskImpact'
  | 'implementationPlan'
  | 'testPlan'
  | 'backoutPlan';

/** Every field on the Formula Card, sections 1-7, in card order. */
export const FORMULA_CARD_FIELDS: readonly FormulaCardField[] = [
  {
    section: '1. Change Identity',
    field: 'Short Description',
    whenRequired: 'Always',
    formula: 'Domain + action + object + version or scope + environment. One line, no unexplained acronyms.',
    minimumAcceptable: 'Domain, action, object, and environment are clear.',
    reviewerTest: 'Can I identify what is changing without opening the record?',
    evidenceExpected: 'Aligns with the detailed description.',
    specialConsiderations: 'Use business-recognizable system names. Avoid team names, ticket language, and vague verbs such as "update" without an object.',
  },
  {
    section: '1. Change Identity',
    field: 'Description',
    whenRequired: 'Always',
    formula: 'Current state + what changes + how it changes + what does not change + why now.',
    minimumAcceptable: 'What is changing, how, and why are explained.',
    reviewerTest: 'Could a technically informed stranger understand the exact scope and boundaries?',
    evidenceExpected: 'Architecture diagram, release notes, design record, or vendor documentation when applicable.',
    specialConsiderations: 'Explicitly state what is out of scope.',
  },
  {
    section: '1. Change Identity',
    field: 'Configuration Item',
    whenRequired: 'Always',
    formula: 'Specific CI directly modified + associated or impacted CIs identified separately.',
    minimumAcceptable: 'The CI directly receiving the change is selected.',
    reviewerTest: 'Is this the object being modified, rather than the parent service or a convenient placeholder?',
    evidenceExpected: 'CMDB record, infrastructure inventory, architecture diagram, discovery record.',
    specialConsiderations: 'If the correct CI is missing, document the gap and initiate a CMDB correction.',
  },
  {
    section: '1. Change Identity',
    field: 'Category',
    whenRequired: 'Always',
    formula: 'Category matching the object changed, not the team performing the work.',
    minimumAcceptable: 'Category aligns to the technology being changed.',
    reviewerTest: 'Would the category still be correct if another team performed the work?',
    evidenceExpected: 'ServiceNow category definition or process reference.',
    specialConsiderations: 'A database change performed by an application team is still a database change.',
  },
  {
    section: '1. Change Identity',
    field: 'Environment',
    whenRequired: 'Always',
    formula: 'Environment changed + environments traversed + shared management or control-plane components.',
    minimumAcceptable: 'Production, nonproduction, disaster recovery, or shared environment is identified.',
    reviewerTest: 'Is every environment or shared component touched by the implementation visible?',
    evidenceExpected: 'Architecture or network diagram where scope crosses environments.',
    specialConsiderations: 'Centralized identity, firewall, cloud, or orchestration platforms may cross tiers.',
  },
  {
    section: '1. Change Identity',
    field: 'Assignment Group',
    whenRequired: 'Always',
    formula: 'Group owning the work and able to answer implementation questions.',
    minimumAcceptable: 'Accountable technical group identified.',
    reviewerTest: 'Can this group execute, troubleshoot, and restore the change?',
    evidenceExpected: 'Assignment-group ownership record.',
    specialConsiderations: 'Do not assign based only on who submitted the record.',
  },
  {
    section: '1. Change Identity',
    field: 'Change Owner',
    whenRequired: 'Always',
    formula: 'Named person able to explain the what, why, how, risks, and recovery approach.',
    minimumAcceptable: 'One accountable owner identified.',
    reviewerTest: 'Can this person make or obtain a go/no-go and backout decision?',
    evidenceExpected: 'Contact and support information.',
    specialConsiderations: 'The requester and change owner may differ.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Justification / Business Impact / Impact if Deferred',
    whenRequired: 'Always',
    formula: 'Driver + benefit or risk avoided + consequence of deferral, using dates, volumes, or numbers when available.',
    minimumAcceptable: 'Why the change is needed and what happens if it is delayed.',
    reviewerTest: 'Does this explain why the change should occur now rather than someday?',
    evidenceExpected: 'Release milestone, defect record, vendor deadline, business commitment, audit item.',
    specialConsiderations: 'Avoid "routine maintenance" unless the actual business or risk driver is also stated.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Affected Users or Customers',
    whenRequired: 'Always',
    formula: 'Population + approximate number + window experience + post-change experience.',
    minimumAcceptable: 'Who is affected and whether they experience interruption.',
    reviewerTest: 'Do I know who notices this change and what they experience?',
    evidenceExpected: 'User counts, transaction volumes, business-process documentation.',
    specialConsiderations: 'Distinguish direct users from downstream consumers.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Regulatory or Compliance Driver',
    whenRequired: 'When applicable',
    formula: 'Requirement + source + deadline + evidence produced.',
    minimumAcceptable: 'Regulation, control, audit item, or contract obligation identified.',
    reviewerTest: 'Can the stated compliance requirement be independently verified?',
    evidenceExpected: 'Policy, regulation, audit finding, control ID, contract clause.',
    specialConsiderations: 'Do not label general security hygiene as a regulatory mandate without a specific source.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Related Incident or Problem',
    whenRequired: 'When applicable',
    formula: 'Record number + relationship + lessons incorporated into the plan.',
    minimumAcceptable: 'Related record and connection to the change are stated.',
    reviewerTest: 'Did the prior failure or investigation materially shape this implementation?',
    evidenceExpected: 'Incident, problem, root-cause analysis, known-error record.',
    specialConsiderations: 'Clarify whether the change resolves, mitigates, or temporarily works around the issue.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Data Impact',
    whenRequired: 'Required when data may be created, changed, copied, transmitted, archived, or deleted',
    formula: 'Data affected + action performed + volume or scope + reconciliation + backout treatment + retention or compliance consideration.',
    minimumAcceptable: 'State whether data changes and how integrity is protected.',
    reviewerTest: 'Could this change lose, duplicate, expose, misroute, or corrupt data?',
    evidenceExpected: 'Data mapping, reconciliation report, backup confirmation, retention standard.',
    specialConsiderations: 'Especially important for Claims, Enrollment, Billing, reporting, integrations, and reclamation.',
  },
  {
    section: '2. Business Need and Scope',
    field: 'Assumptions',
    whenRequired: 'Required when execution depends on conditions not controlled by the implementer',
    formula: 'Assumption + verification method + owner + response if false.',
    minimumAcceptable: 'Critical assumptions are stated.',
    reviewerTest: 'What must remain true for this plan to work?',
    evidenceExpected: 'Monitoring evidence, readiness confirmation, dependency sign-off.',
    specialConsiderations: 'Convert important assumptions into go/no-go checks wherever possible.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Risk',
    whenRequired: 'Always',
    formula: 'Environment + probability + consequence + blast radius + detectability + reversibility + execution maturity.',
    minimumAcceptable: 'Risk rating and rationale are provided.',
    reviewerTest: 'Does the rating reflect what could actually happen rather than how confident the team feels?',
    evidenceExpected: 'Prior change history, test results, failure data, vendor guidance.',
    specialConsiderations: 'A low-probability failure may still be high risk if the consequence is severe or difficult to detect.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Impact',
    whenRequired: 'Always',
    formula: 'Failure scenario + services affected + users affected + business or regulatory consequence + visibility + duration tolerance.',
    minimumAcceptable: 'State what happens if the change fails.',
    reviewerTest: 'Can I picture the operational consequence of failure?',
    evidenceExpected: 'Service maps, business-impact analysis, operational metrics.',
    specialConsiderations: 'Separate expected implementation impact from failure impact.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Risk and Impact Analysis',
    whenRequired: 'Always; deeper detail for moderate/high-risk work',
    formula: 'For each credible failure mode: failure + detection + limiting control + response + residual risk.',
    minimumAcceptable: 'At least the most credible failure modes and controls are documented.',
    reviewerTest: 'Are the controls specific enough to reduce the stated risk?',
    evidenceExpected: 'Test evidence, monitoring thresholds, design review, runbook.',
    specialConsiderations: 'Include silent failures, not only outages.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Blast Radius',
    whenRequired: 'Always',
    formula: 'Direct CIs + direct consumers + downstream consumers + shared infrastructure + stopping point.',
    minimumAcceptable: 'Direct and first-order downstream impact identified.',
    reviewerTest: 'Can I see how far impact could travel and why the analysis stops where it does?',
    evidenceExpected: 'Service mapping, CMDB relationships, network or application diagrams.',
    specialConsiderations: 'Shared services may create a larger blast radius than the named application suggests.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Dependencies',
    whenRequired: 'Always',
    formula: 'Dependency + owner + status + fallback if unmet.',
    minimumAcceptable: 'Dependency and accountable owner identified.',
    reviewerTest: 'What happens if this dependency is unavailable at the start of the window?',
    evidenceExpected: 'Readiness confirmation, related change, vendor commitment, support roster.',
    specialConsiderations: '"Available" should mean confirmed, not merely invited.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Conflicts',
    whenRequired: 'Always',
    formula: 'Calendar and CI checks performed + findings + resolution for each collision.',
    minimumAcceptable: 'Relevant calendars and affected CIs were checked.',
    reviewerTest: 'What concurrent work could alter the risk or invalidate testing?',
    evidenceExpected: 'Change calendar, freeze calendar, release calendar, outage schedule.',
    specialConsiderations: 'Include business events, batch schedules, and freeze periods, not only technical changes.',
  },
  {
    section: '3. Risk, Impact, and Dependencies',
    field: 'Known Failure Modes',
    whenRequired: 'Required when known patterns exist',
    formula: 'Failure mode + source + control included in this plan.',
    minimumAcceptable: 'Relevant known failures are acknowledged.',
    reviewerTest: 'Did the team learn from prior internal, vendor, or industry failures?',
    evidenceExpected: 'Prior incidents, vendor advisories, problem records, lessons learned.',
    specialConsiderations: '"None known" should mean the team checked, not that memory returned no results.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Planned Start',
    whenRequired: 'Always',
    formula: 'Date + time + timezone + why this timing was selected.',
    minimumAcceptable: 'Exact start time and timezone.',
    reviewerTest: 'Does the timing avoid business, batch, and technical conflicts?',
    evidenceExpected: 'Business calendar, batch schedule, maintenance calendar.',
    specialConsiderations: '"After hours" is not specific enough.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Planned End',
    whenRequired: 'Always',
    formula: 'Start + implementation + validation + full backout + margin. Show the arithmetic.',
    minimumAcceptable: 'Window includes implementation, validation, and backout.',
    reviewerTest: 'Could the team fully restore service before the window closes?',
    evidenceExpected: 'Timing worksheet, rehearsal data, prior execution history.',
    specialConsiderations: 'Margin should be intentional, not whatever time remains.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Implementation Duration',
    whenRequired: 'Always',
    formula: 'Duration + source of estimate.',
    minimumAcceptable: 'Estimated duration documented.',
    reviewerTest: 'Is the estimate grounded in something more reliable than optimism?',
    evidenceExpected: 'Rehearsal, prior execution, vendor estimate adjusted for scale.',
    specialConsiderations: 'Include pauses, replication, synchronization, and staged rollout time.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Validation Duration',
    whenRequired: 'Always',
    formula: 'Duration + technical, business, and monitoring coverage + minimum below which the team backs out.',
    minimumAcceptable: 'Validation time is explicitly reserved.',
    reviewerTest: 'Is there enough time to prove success rather than merely observe that implementation ended?',
    evidenceExpected: 'Test script, business-validation checklist, monitoring plan.',
    specialConsiderations: 'Validation must not be sacrificed because implementation ran long.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Backout Duration',
    whenRequired: 'Always',
    formula: 'Duration + evidence + whether post-backout validation is included.',
    minimumAcceptable: 'Backout and restoration validation fit the window.',
    reviewerTest: 'Is this the time to remove the change, or the time to fully restore and validate service?',
    evidenceExpected: 'Restore benchmarks, prior backout, rehearsal.',
    specialConsiderations: 'Include synchronization, restart, recovery, and business validation.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Maintenance Window',
    whenRequired: 'When a named window applies',
    formula: 'Named window + fit with its terms + exceptions and approvals.',
    minimumAcceptable: 'Applicable window identified.',
    reviewerTest: 'Is the work permitted within this window and duration?',
    evidenceExpected: 'Maintenance calendar, exception approval.',
    specialConsiderations: 'A window does not automatically authorize every type of activity.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Communications',
    whenRequired: 'Always; deeper plan for moderate/high-risk work',
    formula: 'Audience + message + channel + timing + sender + acknowledgement requirement where needed.',
    minimumAcceptable: 'Start and completion communications identified.',
    reviewerTest: 'Who needs to know before, during, after, and if the change fails?',
    evidenceExpected: 'Communication template, stakeholder list, bridge notes.',
    specialConsiderations: 'High-risk changes should include failure and backout messaging.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Support Coverage',
    whenRequired: 'Always',
    formula: 'Role + named person + contact method + response commitment during the window and post-change period.',
    minimumAcceptable: 'Required support roles are confirmed.',
    reviewerTest: 'Are the necessary responders truly available, or merely on an email thread?',
    evidenceExpected: 'Support roster, on-call schedule, acknowledgement.',
    specialConsiderations: 'Include the first business day where delayed failures are possible.',
  },
  {
    section: '4. Scheduling and Coordination',
    field: 'Bridge or Command Center',
    whenRequired: 'Moderate/high risk, outages, shared infrastructure, or multi-team work',
    formula: 'Channel + open/close times + participants + leader + go/no-go and backout authority.',
    minimumAcceptable: 'Coordination method and decision-maker identified.',
    reviewerTest: 'Who controls the room when the plan meets reality?',
    evidenceExpected: 'Meeting invite, bridge details, role roster.',
    specialConsiderations: 'Authority should be singular and explicit.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Implementation Plan',
    whenRequired: 'Always',
    formula: 'Numbered steps with actor + action + expected result + verification + time + checkpoints.',
    minimumAcceptable: 'Clear numbered steps and accountable actor.',
    reviewerTest: 'Could another qualified person execute the plan without inventing missing steps?',
    evidenceExpected: 'Runbook, script, screenshots, commands, deployment plan.',
    specialConsiderations: 'Avoid "implement change," "monitor," and "validate" as standalone steps.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Pre-Implementation Checks',
    whenRequired: 'Always',
    formula: 'Check + expected result + response if failed.',
    minimumAcceptable: 'Readiness checks identified.',
    reviewerTest: 'Does every check have a consequence when it fails?',
    evidenceExpected: 'Readiness checklist, health dashboard, backup confirmation.',
    specialConsiderations: 'Checks without abort or delay criteria are decorative.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Required Access',
    whenRequired: 'When privileged or special access is needed',
    formula: 'System + person + access level + acquisition method + verification.',
    minimumAcceptable: 'Required access is confirmed before the window.',
    reviewerTest: 'Could access failure delay or derail execution?',
    evidenceExpected: 'Privileged-access checkout, access test, approval record.',
    specialConsiderations: 'Include emergency or firecall access only when intentionally planned.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Required Resources',
    whenRequired: 'Always',
    formula: 'People + artifacts + capacity + tooling.',
    minimumAcceptable: 'Required personnel and technical resources identified.',
    reviewerTest: 'Is anything assumed to "just be there" at implementation time?',
    evidenceExpected: 'Staffing confirmation, staged package, capacity check, license check.',
    specialConsiderations: 'Include disk, memory, licenses, ports, bandwidth, storage, and bridge tooling where relevant.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Technical Dependencies',
    whenRequired: 'Always',
    formula: 'Component + required state/version + verification + behavior if absent.',
    minimumAcceptable: 'Critical technical prerequisites stated.',
    reviewerTest: 'Does the implementation depend on an undocumented version, service, agent, route, or platform state?',
    evidenceExpected: 'Compatibility matrix, health check, version output.',
    specialConsiderations: 'Distinguish technical prerequisites from organizational dependencies.',
  },
  {
    section: '5. Implementation Readiness',
    field: 'Go or No-Go Criteria',
    whenRequired: 'Always',
    formula: 'Objective checklist + decision time + decision-maker + default when any condition fails.',
    minimumAcceptable: 'Clear decision conditions and owner.',
    reviewerTest: 'Would two reviewers reach the same decision using these criteria?',
    evidenceExpected: 'Readiness record, bridge decision, checklist.',
    specialConsiderations: 'The safest default is no-go when an objective criterion fails.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Preproduction Test Plan',
    whenRequired: 'Always unless testing is demonstrably inapplicable',
    formula: 'Environment + production differences + scope tested + backout tested + date + performer.',
    minimumAcceptable: 'Test environment and test scope identified.',
    reviewerTest: 'Does the testing represent the production risk closely enough to matter?',
    evidenceExpected: 'Test script, test environment record, screenshots, logs.',
    specialConsiderations: 'Explicitly document differences between test and production.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Test Results',
    whenRequired: 'Always when testing occurred',
    formula: 'Pass/fail counts + evidence link + failures + disposition + retest confirmation.',
    minimumAcceptable: 'Outcome and unresolved issues documented.',
    reviewerTest: 'Were failures corrected, accepted, or quietly buried beneath "testing complete"?',
    evidenceExpected: 'Test report, defect record, screenshots, output logs.',
    specialConsiderations: '"Passed" without criteria or evidence is not a result.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Post-Implementation Technical Validation',
    whenRequired: 'Always',
    formula: 'Check + tool or command + expected result + comparison baseline + performer.',
    minimumAcceptable: 'Technical checks and expected outcomes documented.',
    reviewerTest: 'Does each check prove something meaningful about health or function?',
    evidenceExpected: 'Logs, monitoring screenshots, commands, dashboards.',
    specialConsiderations: 'Include negative testing where appropriate, such as confirming unauthorized access remains blocked.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Business Validation',
    whenRequired: 'Required when a business workflow is affected',
    formula: 'Validator + workflows + data used + expected outcome + sign-off location.',
    minimumAcceptable: 'Business function and validator identified.',
    reviewerTest: 'Does the validation prove that users can complete the intended workflow?',
    evidenceExpected: 'Transaction record, report, workflow output, written sign-off.',
    specialConsiderations: 'Technical health alone does not prove business success.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Success Criteria',
    whenRequired: 'Always',
    formula: 'Numbered, binary conditions covering technical health + business function + stability period.',
    minimumAcceptable: 'Clear pass/fail conditions.',
    reviewerTest: 'Can every criterion be marked yes or no without interpretation?',
    evidenceExpected: 'Validation record, monitoring data, business sign-off.',
    specialConsiderations: '"System looks good" is not binary.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Monitoring Plan',
    whenRequired: 'Always; enhanced for moderate/high-risk work',
    formula: 'Metric + baseline + threshold + observation frequency + duration + owner + routing + rollback or forward-fix trigger.',
    minimumAcceptable: 'What will be watched, by whom, and for how long.',
    reviewerTest: 'Would the team detect both immediate and delayed failure?',
    evidenceExpected: 'Dashboard, alert configuration, baseline capture.',
    specialConsiderations: 'State the baseline and alert threshold, not just the tool name.',
  },
  {
    section: '6. Testing and Validation',
    field: 'Validation Owner',
    whenRequired: 'Always',
    formula: 'Named person + scope + sign-off location + independence from implementation.',
    minimumAcceptable: 'Accountable validator identified.',
    reviewerTest: 'Is the person proving success sufficiently independent from the person declaring success?',
    evidenceExpected: 'Work note, approval, test record.',
    specialConsiderations: 'Independence may be role-based rather than organizational.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Backout Plan',
    whenRequired: 'Always unless technically impossible and explicitly approved',
    formula: 'Trigger + decision owner + restoration steps + recovery source + duration + validation.',
    minimumAcceptable: 'Actionable restoration plan.',
    reviewerTest: 'Does this restore the service, or merely remove the new code or configuration?',
    evidenceExpected: 'Backup, prior version, restore script, rollback package.',
    specialConsiderations: '"Revert the change" is not a plan.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Backout Trigger',
    whenRequired: 'Always',
    formula: 'Observable threshold or failed check + elapsed-time trigger + last safe decision point.',
    minimumAcceptable: 'Clear conditions requiring backout.',
    reviewerTest: 'Would the team know when troubleshooting ends and restoration begins?',
    evidenceExpected: 'Monitoring thresholds, validation checklist, timing calculation.',
    specialConsiderations: 'Include time-based triggers so the team does not troubleshoot past recoverability.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Recovery Point',
    whenRequired: 'Always when state, configuration, code, or data may change',
    formula: 'Version or state + location + capture time + integrity verification + treatment of interim data.',
    minimumAcceptable: 'Recoverable version or state identified.',
    reviewerTest: 'Can the team point to the exact state they will restore?',
    evidenceExpected: 'Snapshot, backup, repository version, checksum, export.',
    specialConsiderations: 'Address transactions or data created after the recovery point.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Recovery Time',
    whenRequired: 'Always',
    formula: 'Decision-to-validated-restoration duration + evidence + comparison to window and service expectations.',
    minimumAcceptable: 'Full restoration time documented.',
    reviewerTest: 'Does recovery fit both the change window and business tolerance?',
    evidenceExpected: 'Rehearsal timing, service recovery objective, prior execution.',
    specialConsiderations: 'Measure through validated service restoration, not technical rollback completion.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Forward-Fix Option',
    whenRequired: 'When forward-fix may be considered',
    formula: 'Permitted failure types + time-box + decision-maker + conversion point to mandatory backout.',
    minimumAcceptable: 'State whether forward-fix is allowed.',
    reviewerTest: 'Is forward-fix controlled, or merely hope wearing a badge?',
    evidenceExpected: 'Troubleshooting guide, authority matrix, time threshold.',
    specialConsiderations: 'Never allow forward-fix to consume the restoration window.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Post-Backout Validation',
    whenRequired: 'Always',
    formula: 'Same classes of checks as post-implementation validation against the pre-change baseline.',
    minimumAcceptable: 'Technical and business restoration checks documented.',
    reviewerTest: 'How will the team prove the old state works after restoration?',
    evidenceExpected: 'Logs, business test, monitoring comparison, sign-off.',
    specialConsiderations: 'Backout is incomplete until service is validated.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Irreversibility Point',
    whenRequired: 'Reclamation, decommissioning, deletion, destructive migration, or retention expiry',
    formula: 'Final reversible step + decision owner + evidence reviewed + retention period + exact irreversible action.',
    minimumAcceptable: 'State when restoration is no longer guaranteed.',
    reviewerTest: 'At what exact point does the organization lose the ability to undo this work?',
    evidenceExpected: 'Archive validation, backup expiration, approval, retention record.',
    specialConsiderations: 'Require explicit authorization before deletion or destruction.',
  },
  {
    section: '7. Backout, Recovery, and Irreversibility',
    field: 'Escalation Path',
    whenRequired: 'Always; more detail for high-risk work',
    formula: 'Tiered contacts + trigger + contact method + confirmation of availability.',
    minimumAcceptable: 'Technical and management escalation contacts identified.',
    reviewerTest: 'Who is contacted when restoration does not follow the plan?',
    evidenceExpected: 'Contact list, vendor case process, incident procedure.',
    specialConsiderations: 'Include security, vendor, business, and incident paths where applicable.',
  },
];

/** The Front-Page Quality Gate: all five must be "yes" before a change enters approval. */
export const FORMULA_CARD_QUALITY_GATE: readonly FormulaCardQualityGateItem[] = [
  { question: 'Can anyone understand exactly what is changing?', passStandard: 'Scope, object, environment, method, and exclusions are clear.' },
  { question: 'Is it clear why the change must occur now?', passStandard: 'Driver, benefit, and consequence of deferral are documented.' },
  { question: 'Can the team detect failure quickly?', passStandard: 'Monitoring, thresholds, validation, and owners are defined.' },
  { question: 'Can the service be restored within the approved window?', passStandard: 'Backout, recovery time, recovery point, and validation fit the schedule.' },
  { question: 'Is success objective?', passStandard: 'Every success criterion can be marked pass or fail.' },
];

/**
 * Where each card field is answered on a ServiceNow change. The card has far more fields than the change
 * form has text boxes, so the richer items (dependencies, go/no-go, monitoring...) are written INTO the text
 * field whose subject they belong to — a Test Plan that meets the card carries success criteria and a
 * monitoring plan, not just "tested in INT".
 */
export const CHG_TEXT_FIELD_FORMULA_FIELDS: Readonly<Record<ChgTextFieldKey, readonly string[]>> = {
  shortDescription: ['Short Description'],
  description: ['Description', 'Environment', 'Affected Users or Customers', 'Data Impact', 'Assumptions'],
  justification: [
    'Justification / Business Impact / Impact if Deferred',
    'Regulatory or Compliance Driver',
    'Related Incident or Problem',
  ],
  riskImpact: [
    'Risk',
    'Impact',
    'Risk and Impact Analysis',
    'Blast Radius',
    'Dependencies',
    'Conflicts',
    'Known Failure Modes',
  ],
  implementationPlan: [
    'Implementation Plan',
    'Pre-Implementation Checks',
    'Required Access',
    'Required Resources',
    'Technical Dependencies',
    'Go or No-Go Criteria',
    'Implementation Duration',
    'Communications',
    'Support Coverage',
    'Bridge or Command Center',
  ],
  testPlan: [
    'Preproduction Test Plan',
    'Test Results',
    'Post-Implementation Technical Validation',
    'Business Validation',
    'Success Criteria',
    'Monitoring Plan',
    'Validation Owner',
    'Validation Duration',
  ],
  backoutPlan: [
    'Backout Plan',
    'Backout Trigger',
    'Recovery Point',
    'Recovery Time',
    'Forward-Fix Option',
    'Post-Backout Validation',
    'Backout Duration',
    'Irreversibility Point',
    'Escalation Path',
  ],
};

/**
 * Card fields answered by the change record's own fields (pickers and dates), not by drafted text. The
 * check still reviews them, against the record facts it is given.
 */
export const RECORD_LEVEL_FORMULA_FIELDS: readonly string[] = [
  'Configuration Item',
  'Category',
  'Assignment Group',
  'Change Owner',
  'Planned Start',
  'Planned End',
  'Maintenance Window',
];

/** How each drafted field is labelled on the ServiceNow change form. */
export const CHG_TEXT_FIELD_LABELS: Readonly<Record<ChgTextFieldKey, string>> = {
  shortDescription: 'Short Description',
  description: 'Description',
  justification: 'Justification',
  riskImpact: 'Risk & Impact',
  implementationPlan: 'Implementation Plan',
  testPlan: 'Test Plan',
  backoutPlan: 'Backout Plan',
};

/** Looks a card field up by its exact name; every name used above exists (the tests prove it). */
function findFormulaCardField(fieldName: string): FormulaCardField {
  const matchingField = FORMULA_CARD_FIELDS.find((entry) => entry.field === fieldName);
  if (matchingField === undefined) {
    throw new Error(`The Formula Card has no field named "${fieldName}".`);
  }
  return matchingField;
}

/** One card rule as the drafting prompt states it: what to write, the bar to clear, the reviewer's question. */
function renderGuidanceLine(entry: FormulaCardField): string {
  return [
    `- ${entry.field} (${entry.whenRequired})`,
    `  Formula: ${entry.formula}`,
    `  Minimum acceptable: ${entry.minimumAcceptable}`,
    `  Reviewer will ask: ${entry.reviewerTest}`,
    `  Note: ${entry.specialConsiderations}`,
  ].join('\n');
}

/**
 * The Formula Card rules one drafted field must satisfy, ready to sit in the drafting prompt under that
 * field's name.
 */
export function renderFormulaGuidanceForField(fieldKey: ChgTextFieldKey): string {
  return CHG_TEXT_FIELD_FORMULA_FIELDS[fieldKey]
    .map((fieldName) => renderGuidanceLine(findFormulaCardField(fieldName)))
    .join('\n');
}

/** One card field as the review checklist states it, including the evidence a reviewer expects to see. */
function renderChecklistLine(entry: FormulaCardField): string {
  return [
    `- ${entry.field} [${entry.whenRequired}]`,
    `  Formula: ${entry.formula}`,
    `  Minimum acceptable: ${entry.minimumAcceptable}`,
    `  Reviewer test: ${entry.reviewerTest}`,
    `  Evidence expected: ${entry.evidenceExpected}`,
  ].join('\n');
}

/**
 * The whole card — sections 1-7 then the quality gate — as the checklist a Release Manager reviews a
 * change against.
 */
export function renderFormulaCardChecklist(): string {
  const sectionNames = [...new Set(FORMULA_CARD_FIELDS.map((entry) => entry.section))];
  const sectionBlocks = sectionNames.map((sectionName) => [
    `${sectionName}`,
    ...FORMULA_CARD_FIELDS.filter((entry) => entry.section === sectionName).map((entry) => renderChecklistLine(entry)),
  ].join('\n'));
  const qualityGateBlock = [
    'Front-Page Quality Gate (all five must be "yes" before approval):',
    ...FORMULA_CARD_QUALITY_GATE.map((item, gateIndex) => `${gateIndex + 1}. ${item.question} Pass standard: ${item.passStandard}`),
  ].join('\n');
  return [...sectionBlocks, qualityGateBlock].join('\n\n');
}
