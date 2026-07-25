// test/unit/githubEmailIntakeConfig.test.js — The scheduler.githubEmailIntake config block round-trips
// through load and save. saveConfigToDisk is a whitelist serializer, so a block missing from the
// whitelist is silently dropped — this suite guards against that. No credential fields (auth reuses
// configuration.jira).

'use strict';

jest.mock('fs');
const fsMock = require('fs');

const { loadConfig, saveConfigToDisk } = require('../../src/config/loader');

const SAMPLE = {
  isEnabled: true,
  mode: 'commentOnly',
  scheduleTime: '07:30',
  intervalMin: 0,
  dropFolder: 'C:\\gh-emails',
  processedArchiveFolder: '',
  errorFolder: '',
  fileExtensions: ['.eml'],
  jiraProjectKeys: ['DENP'],
  transitions: { branchCreated: '', commitPushed: '', prOpened: 'In Progress', prMerged: 'Done' },
  seenPrs: { 'myorg/toolbox': { '123': 'merged' } },
};

describe('scheduler.githubEmailIntake config', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('surfaces scheduler.githubEmailIntake from a saved config file on load', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ scheduler: { githubEmailIntake: SAMPLE } }));

    const configuration = loadConfig();

    expect(configuration.scheduler.githubEmailIntake.mode).toBe('commentOnly');
    expect(configuration.scheduler.githubEmailIntake.dropFolder).toBe('C:\\gh-emails');
    expect(configuration.scheduler.githubEmailIntake.transitions.prMerged).toBe('Done');
    expect(configuration.scheduler.githubEmailIntake.jiraProjectKeys).toEqual(['DENP']);
  });

  it('persists scheduler.githubEmailIntake via saveConfigToDisk (whitelist serializer)', () => {
    fsMock.existsSync.mockReturnValue(false);
    const configuration = loadConfig();
    configuration.scheduler.githubEmailIntake = SAMPLE;

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});

    saveConfigToDisk(configuration);

    const persisted = JSON.parse(writtenJson);
    expect(persisted.scheduler.githubEmailIntake.mode).toBe('commentOnly');
    expect(persisted.scheduler.githubEmailIntake.dropFolder).toBe('C:\\gh-emails');
    expect(persisted.scheduler.githubEmailIntake.seenPrs).toEqual({ 'myorg/toolbox': { '123': 'merged' } });
    expect(persisted.scheduler.githubEmailIntake.transitions.prOpened).toBe('In Progress');
  });

  it('writes safe defaults when the block was never configured', () => {
    fsMock.existsSync.mockReturnValue(false);
    const configuration = loadConfig();

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});

    saveConfigToDisk(configuration);

    const persisted = JSON.parse(writtenJson);
    expect(persisted.scheduler.githubEmailIntake.isEnabled).toBe(false);
    expect(persisted.scheduler.githubEmailIntake.mode).toBe('dryRun');
    expect(persisted.scheduler.githubEmailIntake.scheduleTime).toBe('07:00');
    expect(persisted.scheduler.githubEmailIntake.fileExtensions).toEqual(['.eml', '.txt', '.msg']);
    expect(persisted.scheduler.githubEmailIntake.outlookExport).toEqual({
      isEnabled: false, sourceFolder: 'Inbox\\GitHub Intake', processedFolder: 'Inbox\\GitHub Processed', lookbackDays: 0,
    });
  });

  it('round-trips the outlookExport block through load and save (whitelist guard)', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      scheduler: { githubEmailIntake: { outlookExport: { isEnabled: true, sourceFolder: 'Inbox\\GH', processedFolder: 'Inbox\\Done' } } },
    }));

    const configuration = loadConfig();
    expect(configuration.scheduler.githubEmailIntake.outlookExport).toEqual({
      isEnabled: true, sourceFolder: 'Inbox\\GH', processedFolder: 'Inbox\\Done',
    });

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});
    saveConfigToDisk(configuration);

    expect(JSON.parse(writtenJson).scheduler.githubEmailIntake.outlookExport.isEnabled).toBe(true);
  });

  it('round-trips config-driven customRules through load and save', () => {
    const customRules = [{ id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true }];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ scheduler: { githubEmailIntake: { customRules } } }));

    const configuration = loadConfig();
    expect(configuration.scheduler.githubEmailIntake.customRules).toEqual(customRules);

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});
    saveConfigToDisk(configuration);

    expect(JSON.parse(writtenJson).scheduler.githubEmailIntake.customRules).toEqual(customRules);
  });
});
