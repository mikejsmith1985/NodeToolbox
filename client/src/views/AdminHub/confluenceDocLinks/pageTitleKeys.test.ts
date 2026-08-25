// pageTitleKeys.test.ts — Every title shape this team actually writes.
//
// Each case here is a real page title from the tree. A parser that only handled the tidy form would
// silently ignore most of it, and silence is the failure mode that never gets reported.

import { describe, expect, it } from 'vitest';

import { readPageSubject, readPageTitleKeys } from './pageTitleKeys.ts';

const FEATURE_PROJECTS = ['DENP'];

describe('readPageTitleKeys', () => {
  it('reads the tidy form', () => {
    expect(readPageTitleKeys('DENP-477: OHI Survey file'))
      .toEqual([{ issueKey: 'DENP-477', projectKey: 'DENP' }]);
  });

  it('reads a key written with a SPACE instead of a hyphen', () => {
    // "DENP 842: Dev: Pass blank into keyword records" — a real page, and one a strict parser drops.
    expect(readPageTitleKeys('DENP 842: Dev: Pass blank into keyword records')[0].issueKey)
      .toBe('DENP-842');
  });

  it('finds a key hiding behind a ServiceNow number', () => {
    // "INC0100170/ENCUC-2070 TCO dates". The INC number must not be mistaken for the key, and the
    // real key must not be missed for sitting second.
    expect(readPageTitleKeys('INC0100170/ENCUC-2070 TCO dates').map((key) => key.issueKey))
      .toEqual(['ENCUC-2070']);
  });

  it('reads a key with no punctuation after it', () => {
    expect(readPageTitleKeys('ENCUC-1145 THUB Part - Changes in Enrollment')[0].issueKey)
      .toBe('ENCUC-1145');
  });

  it('finds nothing in a title that names nothing', () => {
    expect(readPageTitleKeys('ESI reconciliation')).toEqual([]);
    expect(readPageTitleKeys('OEC to COB/MSP file transformer')).toEqual([]);
    expect(readPageTitleKeys('Sales Force Scenarios')).toEqual([]);
  });

  it('reads every key a title names, in order, without repeating one', () => {
    const keys = readPageTitleKeys('DENP-482 (ESI Monthly) & DENP-483 and DENP-482 again');

    expect(keys.map((key) => key.issueKey)).toEqual(['DENP-482', 'DENP-483']);
  });

  it('does not read a key out of the middle of a longer number', () => {
    expect(readPageTitleKeys('Release 2026-1234567890')).toEqual([]);
  });

  it('survives an empty or missing title', () => {
    expect(readPageTitleKeys('')).toEqual([]);
    expect(readPageTitleKeys(undefined as unknown as string)).toEqual([]);
  });
});

describe('readPageSubject', () => {
  it('routes a Feature page from its Feature key', () => {
    const subject = readPageSubject('DENP-475: COB/MSP Test cases', FEATURE_PROJECTS);

    expect(subject).toEqual({ issueKey: 'DENP-475', isFeatureKey: true, allIssueKeys: ['DENP-475'] });
  });

  it('routes a team page straight to that issue', () => {
    const subject = readPageSubject('ENCUC-1088 CMS Processor enhancements', FEATURE_PROJECTS);

    expect(subject.issueKey).toBe('ENCUC-1088');
    expect(subject.isFeatureKey).toBe(false);
  });

  it('prefers the FEATURE when a title names both', () => {
    // A page titled with a Feature and a story is about the Feature's work. Routing to the story
    // named beside it would attach the whole Feature's scenarios to one piece of it.
    const subject = readPageSubject('DENP-475 / ENCUC-2070: shared scenarios', FEATURE_PROJECTS);

    expect(subject.issueKey).toBe('DENP-475');
    expect(subject.isFeatureKey).toBe(true);
    expect(subject.allIssueKeys).toEqual(['DENP-475', 'ENCUC-2070']);
  });

  it('reports a page it cannot route rather than guessing one', () => {
    const subject = readPageSubject('ESI reconciliation', FEATURE_PROJECTS);

    expect(subject.issueKey).toBeNull();
    expect(subject.allIssueKeys).toEqual([]);
  });

  it('matches a feature project however it was configured for case', () => {
    expect(readPageSubject('DENP-475: x', ['denp']).isFeatureKey).toBe(true);
  });
});
