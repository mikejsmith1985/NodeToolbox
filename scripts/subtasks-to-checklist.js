// scripts/subtasks-to-checklist.js — One-off bulk conversion of Jira sub-tasks into Smart Checklist items.
//
// Jira converts checklist items INTO sub-tasks but has no route back, and none at all in bulk. This is
// that missing route. It runs in four separate steps on purpose, because it writes to production Jira
// and deleting a sub-task in Jira is permanent — there is no trash can to recover one from.
//
//   1. discover          — find the Smart Checklist field id on THIS instance and show its real format
//   2. plan              — show exactly what would be written to every parent. Writes nothing.
//   3. apply             — write the checklists only. Sub-tasks are left completely untouched.
//   4. remove-subtasks   — delete the sub-tasks, and only ones proven to be on a parent's checklist now
//
// Steps 3 and 4 both refuse to act without --confirm, so a mistyped JQL costs nothing. Step 3 records a
// receipt holding every parent's PREVIOUS checklist text, which is what makes step 3 reversible and what
// step 4 reads to know which sub-tasks were genuinely captured.
//
// Run it on a machine that can reach Jira (VPN on) — it uses the server-side credentials from the
// NodeToolbox configuration and never prints them.

'use strict';

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../src/config/loader');
const { makeJiraApiRequest } = require('../src/utils/httpClient');
const {
  findChecklistFieldCandidates,
  buildConversionPlan,
  checklistContainsSubtask,
} = require('../src/services/subtaskChecklistConversion');

// ── Named constants ──

const SEARCH_PAGE_SIZE = 100;
/** Refuses to run against an unexpectedly huge result set unless the caller raises it deliberately. */
const DEFAULT_MAX_SUBTASKS = 500;
const DEFAULT_RECEIPT_PATH = 'subtask-checklist-receipt.json';

/** Everything the plan needs to render a line and to warn about what conversion destroys. */
const SUBTASK_FIELDS = ['summary', 'status', 'assignee', 'parent', 'issuetype', 'issuelinks', 'worklog', 'comment'];

// ── Argument handling ──

/** Turns `--name value` and `--flag` into a plain object. */
function parseCommandLineArguments(argumentList) {
  const parsedArguments = { mode: argumentList[0] || 'help' };

  for (let argumentIndex = 1; argumentIndex < argumentList.length; argumentIndex += 1) {
    const argumentName = argumentList[argumentIndex];
    if (!argumentName.startsWith('--')) continue;

    const optionName = argumentName.slice(2);
    const nextArgument = argumentList[argumentIndex + 1];
    if (nextArgument && !nextArgument.startsWith('--')) {
      parsedArguments[optionName] = nextArgument;
      argumentIndex += 1;
    } else {
      parsedArguments[optionName] = true;
    }
  }

  return parsedArguments;
}

// ── Jira access ──

/** Holds the credentials and TLS setting every request needs, resolved once at start-up. */
function loadJiraContext() {
  const configuration = loadConfig();
  return {
    jiraConfig: configuration.jira || {},
    isTlsVerified: configuration.sslVerify !== false,
    storyPointsFieldIds: configuration.storyPointsFieldIds || [],
  };
}

/** Issues one Jira request, turning any non-2xx response into an error that names what Jira said. */
async function requestJira(jiraContext, httpMethod, apiPath, requestBody = null) {
  const response = await makeJiraApiRequest(
    httpMethod, apiPath, requestBody, jiraContext.jiraConfig, jiraContext.isTlsVerified,
  );

  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    throw new Error(`Jira ${httpMethod} ${apiPath} → HTTP ${response.status}: ${detail}`);
  }
  return response.body;
}

/** Reads every issue matching a JQL query, one page at a time, stopping at the safety cap. */
async function searchAllIssues(jiraContext, jql, fieldIds, maximumIssues) {
  const collectedIssues = [];
  let startAt = 0;

  for (;;) {
    const searchPath = '/rest/api/2/search'
      + `?jql=${encodeURIComponent(jql)}`
      + `&fields=${encodeURIComponent(fieldIds.join(','))}`
      + `&startAt=${startAt}&maxResults=${SEARCH_PAGE_SIZE}`;
    const pageBody = await requestJira(jiraContext, 'GET', searchPath);
    const pageIssues = pageBody.issues || [];

    collectedIssues.push(...pageIssues);
    startAt += pageIssues.length;

    if (pageIssues.length === 0 || startAt >= (pageBody.total || 0)) break;
    if (collectedIssues.length >= maximumIssues) {
      throw new Error(
        `Query matched more than the ${maximumIssues} sub-task safety cap. `
        + 'Narrow the JQL, or raise it deliberately with --max.',
      );
    }
  }

  return collectedIssues;
}

/** Reads the current checklist text for every parent the plan touches. */
async function readParentChecklistText(jiraContext, parentKeys, checklistFieldId) {
  const checklistTextByParentKey = {};

  for (const parentKey of parentKeys) {
    const issueBody = await requestJira(
      jiraContext, 'GET', `/rest/api/2/issue/${encodeURIComponent(parentKey)}?fields=${checklistFieldId}`,
    );
    const rawValue = issueBody.fields ? issueBody.fields[checklistFieldId] : '';
    checklistTextByParentKey[parentKey] = typeof rawValue === 'string' ? rawValue : '';
  }

  return checklistTextByParentKey;
}

// ── Step 1: discover ──

/**
 * Finds the Smart Checklist field on this instance and, given a sample issue, prints its RAW value.
 *
 * The checklist markdown belongs to a third-party app, so the exact syntax is confirmed against a real
 * issue rather than assumed — writing a guessed format into production is not worth the convenience.
 */
async function runDiscoverMode(jiraContext, options) {
  const fieldCatalog = await requestJira(jiraContext, 'GET', '/rest/api/2/field');
  const candidates = findChecklistFieldCandidates(fieldCatalog);

  console.log('\n=== Checklist field candidates on this Jira instance ===');
  if (candidates.length === 0) {
    console.log('  None found. This instance may not expose the Smart Checklist field over REST.');
  }
  for (const candidate of candidates) {
    console.log(`  ${candidate.id.padEnd(22)} ${candidate.name}  ${candidate.schemaType}`);
  }

  if (!options.sample) {
    console.log('\nNext: re-run with --sample <ISSUE-KEY> pointing at an issue that ALREADY has a');
    console.log('Smart Checklist, to see the exact text format before anything is written.');
    return;
  }

  const sampleIssue = await requestJira(jiraContext, 'GET', `/rest/api/2/issue/${encodeURIComponent(options.sample)}`);
  console.log(`\n=== Raw checklist values on ${options.sample} ===`);
  for (const candidate of candidates) {
    const rawValue = sampleIssue.fields ? sampleIssue.fields[candidate.id] : undefined;
    console.log(`\n--- ${candidate.id} (${candidate.name}) ---`);
    console.log(rawValue === undefined || rawValue === null ? '(empty)' : JSON.stringify(rawValue, null, 2));
  }
}

// ── Step 2 & 3: plan and apply ──

/** Prints one parent's before/after so a human can approve the exact text that will be written. */
function printParentPlan(parentPlan) {
  const changeLabel = parentPlan.hasChanged ? 'WILL CHANGE' : 'already up to date';
  console.log(`\n── ${parentPlan.parentKey} (${parentPlan.subtaskKeys.length} sub-tasks) — ${changeLabel}`);

  if (parentPlan.hasChanged) {
    // Diff by line rather than by string offset, so the preview stays accurate even when merging
    // trimmed trailing whitespace off the parent's existing text.
    const previousLines = new Set(parentPlan.previousChecklistText.split(/\r?\n/));
    console.log('   Adding:');
    for (const nextLine of parentPlan.nextChecklistText.split(/\r?\n/)) {
      if (nextLine.trim() && !previousLines.has(nextLine)) console.log(`     ${nextLine}`);
    }
  }
  for (const warning of parentPlan.lossWarnings) {
    console.log(`   ⚠ ${warning.subtaskKey} would lose: ${warning.losesContent.join(', ')}`);
  }
}

/** Builds the plan from live Jira. Shared by `plan` and `apply` so the preview cannot drift from the write. */
async function buildLivePlan(jiraContext, options) {
  const checklistFieldId = options.field;
  if (!checklistFieldId) throw new Error('--field <customfield_NNNNN> is required. Run `discover` first.');
  if (!options.jql) throw new Error('--jql "<query>" is required, selecting the SUB-TASKS to convert.');

  const maximumSubtasks = Number(options.max) || DEFAULT_MAX_SUBTASKS;
  const subtaskIssues = await searchAllIssues(
    jiraContext, options.jql, [...SUBTASK_FIELDS, ...jiraContext.storyPointsFieldIds], maximumSubtasks,
  );
  console.log(`Matched ${subtaskIssues.length} sub-tasks.`);

  const parentKeys = [...new Set(subtaskIssues.map((issue) => issue.fields?.parent?.key).filter(Boolean))];
  const parentChecklistTextByKey = await readParentChecklistText(jiraContext, parentKeys, checklistFieldId);

  return buildConversionPlan(subtaskIssues, parentChecklistTextByKey, {
    storyPointsFieldIds: jiraContext.storyPointsFieldIds,
    shouldIncludeKey: options['no-key'] !== true,
    headingText: typeof options.heading === 'string' ? options.heading : 'Converted sub-tasks',
  });
}

/** Prints the whole plan and the totals a human needs before approving a bulk write. */
function printPlanSummary(conversionPlan) {
  for (const parentPlan of conversionPlan.parentPlans) printParentPlan(parentPlan);

  console.log('\n=== Summary ===');
  console.log(`  Sub-tasks matched:      ${conversionPlan.totalSubtaskCount}`);
  console.log(`  Parents affected:       ${conversionPlan.parentPlans.length}`);
  console.log(`  Parents needing a write:${String(conversionPlan.changedParentCount).padStart(4)}`);
  if (conversionPlan.orphanedSubtaskKeys.length > 0) {
    console.log(`  ⚠ No parent, skipped:   ${conversionPlan.orphanedSubtaskKeys.join(', ')}`);
  }
}

/** Writes the merged checklist onto every changed parent and records a receipt for rollback. */
async function runApplyMode(jiraContext, options) {
  const conversionPlan = await buildLivePlan(jiraContext, options);
  printPlanSummary(conversionPlan);

  if (options.confirm !== true) {
    console.log('\nDRY RUN — nothing was written. Re-run with --confirm to apply.');
    return;
  }

  const receiptEntries = [];
  for (const parentPlan of conversionPlan.parentPlans) {
    if (!parentPlan.hasChanged) continue;

    await requestJira(jiraContext, 'PUT', `/rest/api/2/issue/${encodeURIComponent(parentPlan.parentKey)}`, {
      fields: { [options.field]: parentPlan.nextChecklistText },
    });
    receiptEntries.push({
      parentKey: parentPlan.parentKey,
      checklistFieldId: options.field,
      previousChecklistText: parentPlan.previousChecklistText,
      writtenChecklistText: parentPlan.nextChecklistText,
      capturedSubtaskKeys: parentPlan.subtaskKeys,
    });
    console.log(`  ✓ ${parentPlan.parentKey} updated`);
  }

  const receiptPath = path.resolve(options.receipt || DEFAULT_RECEIPT_PATH);
  fs.writeFileSync(receiptPath, JSON.stringify({ entries: receiptEntries }, null, 2), 'utf8');
  console.log(`\nReceipt written to ${receiptPath}`);
  console.log('It holds every parent\'s PREVIOUS checklist text — keep it until you are satisfied.');
}

// ── Step 4: remove the sub-tasks ──

/**
 * Deletes only the sub-tasks that are provably represented on their parent's checklist RIGHT NOW.
 *
 * The receipt alone is not trusted: each parent's checklist is re-read from Jira first, so a checklist
 * that was edited or reverted after the apply step cannot lead to a sub-task being deleted for nothing.
 */
async function runRemoveSubtasksMode(jiraContext, options) {
  const receiptPath = path.resolve(options.receipt || DEFAULT_RECEIPT_PATH);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const deletableSubtaskKeys = [];

  for (const entry of receipt.entries) {
    const parentIssue = await requestJira(
      jiraContext, 'GET', `/rest/api/2/issue/${encodeURIComponent(entry.parentKey)}?fields=${entry.checklistFieldId}`,
    );
    const currentChecklistText = String(parentIssue.fields?.[entry.checklistFieldId] || '');

    for (const subtaskKey of entry.capturedSubtaskKeys) {
      const isOnChecklist = checklistContainsSubtask(currentChecklistText, { key: subtaskKey, fields: {} });
      if (isOnChecklist) deletableSubtaskKeys.push(subtaskKey);
      else console.log(`  ⚠ ${subtaskKey} is NOT on ${entry.parentKey}'s checklist — skipping deletion`);
    }
  }

  console.log(`\n${deletableSubtaskKeys.length} sub-tasks are safe to delete:`);
  console.log(`  ${deletableSubtaskKeys.join(', ')}`);

  if (options.confirm !== true) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --confirm to delete PERMANENTLY.');
    return;
  }

  for (const subtaskKey of deletableSubtaskKeys) {
    await requestJira(jiraContext, 'DELETE', `/rest/api/2/issue/${encodeURIComponent(subtaskKey)}`);
    console.log(`  ✓ ${subtaskKey} deleted`);
  }
}

// ── Entry point ──

function printUsage() {
  console.log(`
Convert Jira sub-tasks into Smart Checklist items on their parent.

  node scripts/subtasks-to-checklist.js discover [--sample ENCUC-123]
  node scripts/subtasks-to-checklist.js plan  --field customfield_NNNNN --jql "<sub-task JQL>"
  node scripts/subtasks-to-checklist.js apply --field customfield_NNNNN --jql "<sub-task JQL>" --confirm
  node scripts/subtasks-to-checklist.js remove-subtasks --receipt <path> --confirm

Options:
  --field       The Smart Checklist custom field id (find it with \`discover\`)
  --jql         Selects the SUB-TASKS to convert, e.g. "project = ENCUC AND issuetype = Sub-task"
  --heading     Heading placed above the converted items (default: "Converted sub-tasks")
  --no-key      Leave the sub-task key out of each checklist line
  --max         Raise the ${DEFAULT_MAX_SUBTASKS} sub-task safety cap
  --receipt     Where the rollback receipt is written/read (default: ${DEFAULT_RECEIPT_PATH})
  --confirm     Actually write (apply) or actually delete (remove-subtasks)

Nothing is written without --confirm. Deleting sub-tasks in Jira is permanent.
`);
}

async function main() {
  const options = parseCommandLineArguments(process.argv.slice(2));
  if (options.mode === 'help' || options.help) {
    printUsage();
    return;
  }

  const jiraContext = loadJiraContext();
  if (options.mode === 'discover') return runDiscoverMode(jiraContext, options);
  if (options.mode === 'plan') return printPlanSummary(await buildLivePlan(jiraContext, options));
  if (options.mode === 'apply') return runApplyMode(jiraContext, options);
  if (options.mode === 'remove-subtasks') return runRemoveSubtasksMode(jiraContext, options);

  printUsage();
  throw new Error(`Unknown mode '${options.mode}'`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseCommandLineArguments, printParentPlan, printPlanSummary };
