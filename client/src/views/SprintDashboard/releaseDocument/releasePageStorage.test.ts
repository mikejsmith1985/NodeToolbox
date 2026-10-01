// releasePageStorage.test.ts — The release document as a Confluence page, written and read back (GH #395).

import { describe, expect, it } from 'vitest';

import type { EpicGroup, ReleaseItem } from './releaseGather.ts';
import {
  buildReleasePageStorage,
  createEmptyDeploymentStep,
  parseReleasePageStorage,
  type DeploymentStep,
  type ReleaseDocument,
} from './releasePageStorage.ts';

/** A release-document row. */
function buildItem(key: string, overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    key,
    summary: `${key} summary`,
    issueTypeName: 'Story',
    statusName: 'In Progress',
    assigneeName: 'Smith, Mike',
    fixVersionNames: ['10/14/2026'],
    epicKey: null,
    notes: '',
    ...overrides,
  };
}

const DEPLOYMENT_STEP: DeploymentStep = {
  ...createEmptyDeploymentStep(),
  pr: 'https://github.com/zilvertonz/usmg-esi-recon/pull/35',
  repo: 'usmg-esi-recon',
  workflowRun: 'https://github.com/zilvertonz/usmg-esi-recon/actions/workflows/main.yaml',
  branch: 'main',
  jobType: 'build, push',
  application: 'usmg-esi-recon',
  environment: 'prd',
  repository: 'ecr',
  tag: 'Does not matter',
};

const GROUPS: EpicGroup[] = [
  {
    epicKey: 'DENP-20',
    epic: buildItem('DENP-20', { issueTypeName: 'Epic', summary: 'Recon <reporting> & fixes', notes: 'Epic note' }),
    items: [buildItem('ENCUC-2', { epicKey: 'DENP-20', notes: 'Waiting on QA' })],
    outsideItems: [],
    misalignments: [{ kind: 'child-outside-release', issueKey: 'ENCUC-9', message: 'ENCUC-9 is in 11/11/2026, not this release.' }],
  },
  { epicKey: null, epic: null, items: [buildItem('ENCUC-3')], outsideItems: [], misalignments: [] },
];

const DOCUMENT: ReleaseDocument = {
  groups: GROUPS,
  deploymentSteps: [DEPLOYMENT_STEP, { ...createEmptyDeploymentStep(), pr: 'To be created after above steps', module: 'fargate-esi-recon' }],
  lastSyncedLabel: 'Oct 1, 2026, 9:00 AM',
};

const buildIssueUrl = (issueKey: string): string => `https://jira.example.com/browse/${issueKey}`;

describe('buildReleasePageStorage', () => {
  const storage = buildReleasePageStorage(DOCUMENT, buildIssueUrl);

  it('says when it was last synced from Jira', () => {
    expect(storage).toContain('Last synced from Jira: Oct 1, 2026, 9:00 AM');
  });

  it('lays out the release items table with every column', () => {
    ['Key', 'Summary', 'Type', 'Status', 'Assignee', 'Release check', 'Notes']
      .forEach((header) => expect(storage).toContain(`<th>${header}</th>`));
  });

  it('shows Epic rows in bold, children beneath with an arrow, and links every key to Jira', () => {
    expect(storage).toContain('<strong>Recon &lt;reporting&gt; &amp; fixes</strong>');
    expect(storage).toContain('↳ <a href="https://jira.example.com/browse/ENCUC-2">ENCUC-2</a>');
    expect(storage.indexOf('DENP-20')).toBeLessThan(storage.indexOf('ENCUC-2'));
  });

  it('puts misalignments in the Release check column and keeps "No Epic" last', () => {
    expect(storage).toContain('ENCUC-9 is in 11/11/2026, not this release.');
    expect(storage.indexOf('No Epic')).toBeGreaterThan(storage.indexOf('ENCUC-2'));
  });

  it('lays out the deployment steps table, linking PR and workflow run only when they are URLs', () => {
    ['PR', 'Repo', 'Workflow run', 'Branch', 'Job type', 'Application', 'Environment', 'Repository', 'Tag', 'Task', 'Module', 'Log level']
      .forEach((header) => expect(storage).toContain(`<th>${header}</th>`));
    expect(storage).toContain('<a href="https://github.com/zilvertonz/usmg-esi-recon/pull/35">');
    expect(storage).toContain('<td>To be created after above steps</td>');
  });

  it('never relies on data- markers, which Confluence strips', () => {
    expect(storage).not.toContain('data-');
  });
});

describe('parseReleasePageStorage', () => {
  it('reads back exactly the deployment steps and notes it wrote', () => {
    const parsed = parseReleasePageStorage(buildReleasePageStorage(DOCUMENT, buildIssueUrl));

    expect(parsed.deploymentSteps.map(({ id: _id, ...step }) => step))
      .toEqual(DOCUMENT.deploymentSteps.map(({ id: _id, ...step }) => step));
    expect(parsed.notesByKey.get('ENCUC-2')).toBe('Waiting on QA');
    expect(parsed.notesByKey.get('DENP-20')).toBe('Epic note');
  });

  it('reads deployment steps someone typed straight into Confluence', () => {
    const handEdited = '<table><tbody><tr><th>PR</th><th>Repo</th><th>Log level</th></tr>'
      + '<tr><td><p>TBD</p></td><td>infra</td><td>ERROR</td></tr></tbody></table>';

    const parsed = parseReleasePageStorage(handEdited);

    expect(parsed.deploymentSteps).toEqual([expect.objectContaining({ pr: 'TBD', repo: 'infra', logLevel: 'ERROR', branch: '' })]);
  });

  it('returns nothing, without failing, for a page with no release tables', () => {
    expect(parseReleasePageStorage('<p>Hello</p>')).toEqual({ deploymentSteps: [], notesByKey: new Map() });
  });
});
