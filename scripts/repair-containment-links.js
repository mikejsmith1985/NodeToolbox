// scripts/repair-containment-links.js — One-off repair of containment links this app wrote backwards.
//
// Until v0.168.4 the app created containment links with the two ends swapped: Jira's create payload
// names each end by ROLE, not by the phrase it will display, and we had that the wrong way round. The
// result is links reading "the Dev story is contained within the SL story" — the reverse of what the
// team meant. v0.168.4 stopped new ones being written wrong; this repairs the ones already there.
//
// Jira has no route to reverse a link, so a repair is a DELETE followed by a CREATE. That is
// destructive against production data, so it runs in two steps and writes nothing without --confirm:
//
//   1. plan   — read the issues, classify every containment link, print exactly what would change
//   2. apply  — delete and recreate only the links the plan called backwards, writing a receipt first
//
// It only repairs links it can PROVE are backwards. A Story the promotion tool created carries a
// description naming the sub-task's old parent, which makes the intended direction a fact rather than
// a guess. Every other containment link is listed and left alone: somebody may have made it by hand
// and meant precisely what they wrote.
//
//   node scripts/repair-containment-links.js plan  --jql "project = ENCUC"
//   node scripts/repair-containment-links.js apply --jql "project = ENCUC" --confirm
//
// Run it on a machine that can reach Jira (VPN on) — it uses the server-side credentials from the
// NodeToolbox configuration and never prints them.

'use strict';

const fs = require('fs');

const { loadConfig } = require('../src/config/loader');
const { makeJiraApiRequest } = require('../src/utils/httpClient');
const {
  buildRepairedLinkPayload,
  classifyContainmentLinks,
  describeRepair,
  summarizeClassifications,
} = require('../src/services/containmentLinkRepair');

// ── Named constants ──

const SEARCH_PAGE_SIZE = 100;
/** Refuses an unexpectedly huge result set unless the caller raises it deliberately. */
const DEFAULT_MAX_ISSUES = 500;
const DEFAULT_RECEIPT_PATH = 'containment-link-repair-receipt.json';

/** Everything the classifier reads. `description` is what carries the promotion evidence. */
const ISSUE_FIELDS = ['summary', 'description', 'issuelinks'];

/** Turns `--name value` and `--flag` into a plain object. */
function parseCommandLineArguments(argumentList) {
  const parsedArguments = { mode: argumentList[0] || 'help' };

  for (let argumentIndex = 1; argumentIndex < argumentList.length; argumentIndex += 1) {
    const argumentName = argumentList[argumentIndex];
    if (!argumentName.startsWith('--')) continue;

    const nextValue = argumentList[argumentIndex + 1];
    const isFlag = nextValue === undefined || nextValue.startsWith('--');
    parsedArguments[argumentName.slice(2)] = isFlag ? true : nextValue;
    if (!isFlag) argumentIndex += 1;
  }
  return parsedArguments;
}

/** Sends one Jira request, turning any non-2xx into an error naming the call that failed. */
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
async function searchAllIssues(jiraContext, jql, maximumIssues) {
  const collectedIssues = [];
  let startAt = 0;

  for (;;) {
    const searchPath = '/rest/api/2/search'
      + `?jql=${encodeURIComponent(jql)}`
      + `&fields=${ISSUE_FIELDS.join(',')}`
      + `&startAt=${startAt}&maxResults=${SEARCH_PAGE_SIZE}`;
    const page = await requestJira(jiraContext, 'GET', searchPath);
    const pageIssues = page.issues || [];
    collectedIssues.push(...pageIssues);

    if (pageIssues.length < SEARCH_PAGE_SIZE || collectedIssues.length >= maximumIssues) break;
    startAt += SEARCH_PAGE_SIZE;
  }

  return collectedIssues.slice(0, maximumIssues);
}

/** Loads Jira credentials from the app's own configuration, without ever printing them. */
function buildJiraContext() {
  const configuration = loadConfig();
  const jiraConfig = configuration.jira || {};
  if (!jiraConfig.baseUrl) {
    throw new Error('No Jira base URL is configured. Open NodeToolbox and connect to Jira first.');
  }
  return { jiraConfig, isTlsVerified: configuration.isTlsVerified !== false };
}

/** Prints the classification of every containment link found, and writes nothing. */
async function runPlan(jiraContext, parsedArguments) {
  const jql = parsedArguments.jql;
  if (!jql) throw new Error('--jql "project = ENCUC" is required.');

  const maximumIssues = Number(parsedArguments.max) || DEFAULT_MAX_ISSUES;
  const issues = await searchAllIssues(jiraContext, jql, maximumIssues);
  const classifications = classifyContainmentLinks(issues);

  console.log(`\nRead ${issues.length} issue(s) matching: ${jql}`);
  console.log(summarizeClassifications(classifications));

  const backwardsLinks = classifications.filter((classification) => classification.kind === 'backwards');
  if (backwardsLinks.length > 0) {
    console.log('\n=== Would be repaired ===');
    for (const classification of backwardsLinks) console.log('  ' + describeRepair(classification));
  }

  const unverifiableLinks = classifications.filter((classification) => classification.kind === 'unverifiable');
  if (unverifiableLinks.length > 0) {
    console.log('\n=== Left alone — no recorded evidence of the intended direction ===');
    for (const classification of unverifiableLinks) {
      console.log(`  ${classification.link.containedKey} contained within ${classification.link.containerKey}`);
    }
    console.log('  Check these by hand. If any are backwards, fix them in Jira — this tool will not guess.');
  }

  console.log('\nNothing was written. Re-run with `apply --confirm` to repair the backwards links.\n');
  return classifications;
}

/** Deletes and recreates each proven-backwards link, after writing a receipt of the original state. */
async function runApply(jiraContext, parsedArguments) {
  if (!parsedArguments.confirm) {
    throw new Error('Refusing to write without --confirm. Run `plan` first and read it.');
  }

  const classifications = await runPlan(jiraContext, parsedArguments);
  const backwardsLinks = classifications.filter((classification) => classification.kind === 'backwards');
  if (backwardsLinks.length === 0) {
    console.log('Nothing to repair.\n');
    return;
  }

  // The receipt is written BEFORE the first delete: a link id is gone the moment it is deleted, and
  // without this there would be no record of what the original looked like.
  const receiptPath = parsedArguments.receipt || DEFAULT_RECEIPT_PATH;
  fs.writeFileSync(receiptPath, JSON.stringify({
    jql: parsedArguments.jql,
    repairedAt: new Date().toISOString(),
    links: backwardsLinks.map((classification) => classification.link),
  }, null, 2));
  console.log(`Receipt written to ${receiptPath}`);

  let repairedCount = 0;
  for (const classification of backwardsLinks) {
    const { link } = classification;
    const payload = buildRepairedLinkPayload(
      link, classification.shouldBeContainedKey, classification.shouldBeContainerKey,
    );

    try {
      // Create first, then delete. The reverse order would leave the pair unlinked entirely if the
      // create failed — losing information rather than merely failing to improve it.
      await requestJira(jiraContext, 'POST', '/rest/api/2/issueLink', payload);
      await requestJira(jiraContext, 'DELETE', `/rest/api/2/issueLink/${encodeURIComponent(link.linkId)}`);
      repairedCount += 1;
      console.log(`  ✔ ${classification.shouldBeContainedKey} is now contained within ${classification.shouldBeContainerKey}`);
    } catch (repairError) {
      console.error(`  ✖ ${link.containedKey}/${link.containerKey}: ${repairError.message}`);
    }
  }

  console.log(`\nRepaired ${repairedCount} of ${backwardsLinks.length} link(s).\n`);
}

const HELP_TEXT = `
Repairs containment links this app wrote backwards before v0.168.4.

  node scripts/repair-containment-links.js plan  --jql "project = ENCUC"
  node scripts/repair-containment-links.js apply --jql "project = ENCUC" --confirm

  --jql      required. Which issues to examine.
  --max      safety cap on issues read (default ${DEFAULT_MAX_ISSUES}).
  --receipt  where to record the original links (default ${DEFAULT_RECEIPT_PATH}).
  --confirm  required by apply. Without it, nothing is written.

Only links PROVEN backwards are repaired — a Story the promotion tool created names the parent it came
from, which makes the intended direction a fact. Everything else is listed for you and left alone.
`;

async function main() {
  const parsedArguments = parseCommandLineArguments(process.argv.slice(2));

  if (parsedArguments.mode === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  const jiraContext = buildJiraContext();
  if (parsedArguments.mode === 'plan') {
    await runPlan(jiraContext, parsedArguments);
    return;
  }
  if (parsedArguments.mode === 'apply') {
    await runApply(jiraContext, parsedArguments);
    return;
  }

  console.log(HELP_TEXT);
}

// Guarded so requiring this file - which the tests do - can never start writing to Jira.
if (require.main === module) {
  main().catch((runError) => {
    console.error('\n' + runError.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { parseCommandLineArguments, runApply, HELP_TEXT };
