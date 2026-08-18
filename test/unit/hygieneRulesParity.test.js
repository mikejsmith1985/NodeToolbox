// hygieneRulesParity.test.js — The server port must agree with the client it mirrors.
//
// src/services/hygieneRules.js is a hand-written port of the client's hygiene checks, and hand-
// written ports drift. Two kinds of drift had already happened and neither was visible from either
// side alone: four checks carried a different severity, and the stale check answered to a different
// check id entirely — which quietly broke the file's own stated purpose, that "the hygiene monitor
// scheduler can use the same check IDs the UI already displays".
//
// So the client catalog is read here, from source, and compared. It is the only place the two can
// be checked against each other: the client is TypeScript the server never loads, and the server is
// plain JS the client never imports.

'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const { evaluateHygieneRules } = require('../../src/services/hygieneRules');

const CLIENT_CHECKS_PATH = path.join(
  __dirname, '..', '..', 'client', 'src', 'views', 'Hygiene', 'checks', 'hygieneChecks.ts',
);

/**
 * Reads the client's BUILT_IN_HYGIENE_FLAGS catalog as a checkId → severity map.
 *
 * Parsing source is a blunt instrument, and deliberately so: if the catalog's shape changes this
 * throws rather than silently comparing nothing, which is exactly the moment someone should look.
 */
function readClientSeverityByCheckId() {
  const source = readFileSync(CLIENT_CHECKS_PATH, 'utf8');
  const catalogStart = source.indexOf('const BUILT_IN_HYGIENE_FLAGS');
  const catalogEnd = source.indexOf('\n};', catalogStart);
  if (catalogStart === -1 || catalogEnd === -1) {
    throw new Error('Could not find BUILT_IN_HYGIENE_FLAGS in the client hygiene checks — has it been renamed?');
  }

  const catalogText = source.slice(catalogStart, catalogEnd);
  const entryPattern = /checkId: '([^']+)', label: '[^']*', severity: '([^']+)'/g;
  const severityByCheckId = {};
  let match = entryPattern.exec(catalogText);
  while (match !== null) {
    severityByCheckId[match[1]] = match[2];
    match = entryPattern.exec(catalogText);
  }

  if (Object.keys(severityByCheckId).length === 0) {
    throw new Error('Parsed zero entries out of BUILT_IN_HYGIENE_FLAGS — the catalog format changed.');
  }
  return severityByCheckId;
}

/** An issue built to trip as many checks at once as possible, so one scan yields a broad sample. */
function buildMaximallyUnhealthyIssue(issueTypeName, statusName, statusCategoryKey, extraFields) {
  return {
    key: 'PAR-1',
    fields: {
      summary: 'A neglected item',
      issuetype: { name: issueTypeName },
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      created: '2020-01-01T00:00:00.000Z',
      updated: '2020-01-01T00:00:00.000Z',
      assignee: null,
      ...extraFields,
    },
  };
}

describe('server hygiene — severity parity with the client catalog', () => {
  const clientSeverityByCheckId = readClientSeverityByCheckId();
  // Every family configured, so the sample exercises as much of the port as it can raise.
  const fieldConfig = {
    targetEndFieldIds: ['customfield_10102'],
    targetStartFieldIds: ['customfield_10101'],
    featureLinkFieldIds: ['customfield_10108'],
    parentLinkFieldIds: ['parent'],
    productOwnerFieldIds: ['customfield_10400'],
    initiativeTypeFieldIds: ['customfield_10401'],
    programIncrementFieldIds: ['customfield_10301'],
    applicationFieldIds: ['customfield_10402'],
    acceptanceCriteriaFieldIds: ['customfield_10200'],
  };

  // Between them these cover every check the server port can actually raise.
  const sampleIssues = [
    buildMaximallyUnhealthyIssue('Feature', 'To Do', 'new', { duedate: '2020-01-01', customfield_10102: '2020-01-01', customfield_10101: '2020-01-01' }),
    buildMaximallyUnhealthyIssue('Story', 'In Progress', 'indeterminate', { duedate: '2020-01-01', customfield_10020: [{ state: 'active' }] }),
    buildMaximallyUnhealthyIssue('Task', 'In Progress', 'indeterminate', {}),
  ];

  const raisedFlags = sampleIssues.flatMap((issue) => evaluateHygieneRules(issue, fieldConfig));

  test('raises a broad enough sample to be worth comparing', () => {
    expect(new Set(raisedFlags.map((flag) => flag.checkId)).size).toBeGreaterThanOrEqual(10);
  });

  test('every check id the server raises is one the client also knows', () => {
    const unknownCheckIds = [...new Set(raisedFlags.map((flag) => flag.checkId))]
      .filter((checkId) => clientSeverityByCheckId[checkId] === undefined);
    expect(unknownCheckIds).toEqual([]);
  });

  test('every raised check carries the same severity the client gives it', () => {
    const severityDrift = [...new Set(raisedFlags.map((flag) => flag.checkId))]
      .map((checkId) => ({
        checkId,
        server: raisedFlags.find((flag) => flag.checkId === checkId).severity,
        client: clientSeverityByCheckId[checkId],
      }))
      .filter((comparison) => comparison.server !== comparison.client);
    expect(severityDrift).toEqual([]);
  });
});

describe('server hygiene — "today" is the server\'s own calendar day, not UTC\'s', () => {
  const fieldConfig = { targetEndFieldIds: ['customfield_10102'] };

  /** The calendar day an instant falls on locally — how a person reading a clock would name it. */
  function localDayOf(instant) {
    return [
      String(instant.getFullYear()),
      String(instant.getMonth() + 1).padStart(2, '0'),
      String(instant.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function isOverdue(dueDate) {
    const issue = buildMaximallyUnhealthyIssue('Story', 'In Progress', 'indeterminate', { duedate: dueDate });
    return evaluateHygieneRules(issue, fieldConfig).some((flag) => flag.checkId === 'due-date-overdue');
  }

  beforeEach(() => {
    jest.useFakeTimers();
    // Late evening local time — the window in which UTC has already rolled to the next day, and in
    // which this port used to call tomorrow's due dates overdue while the UI did not.
    jest.setSystemTime(new Date('2026-07-16T03:30:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  test('counts today as due', () => {
    expect(isOverdue(localDayOf(new Date()))).toBe(true);
  });

  test('counts yesterday as past', () => {
    expect(isOverdue(localDayOf(new Date(Date.now() - 86_400_000)))).toBe(true);
  });

  test('does NOT count tomorrow, even once UTC has rolled over to it', () => {
    expect(isOverdue(localDayOf(new Date(Date.now() + 86_400_000)))).toBe(false);
  });
});
