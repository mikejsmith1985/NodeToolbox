// test/unit/piReviewSchedulerConfig.test.js — The scheduler.piReview config block round-trips
// through load and save (feature 015). Auth reuses configuration.jira/confluence, so this block
// carries no credentials.

'use strict';

jest.mock('fs');
const fsMock = require('fs');

const { loadConfig, saveConfigToDisk } = require('../../src/config/loader');

describe('scheduler.piReview config', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('surfaces scheduler.piReview.teams from a saved config file on load', () => {
    const fileConfig = {
      scheduler: {
        piReview: {
          teams: [{
            teamName: 'Transformers',
            isEnabled: true,
            scheduleTime: '06:30',
            productOwnerAssignee: 'C73130',
            piFieldId: 'customfield_10301',
            pages: [{ pageUrlOrId: '12345', piName: 'PI 26.4' }],
          }],
        },
      },
    };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

    const configuration = loadConfig();

    expect(configuration.scheduler.piReview.teams).toHaveLength(1);
    expect(configuration.scheduler.piReview.teams[0].teamName).toBe('Transformers');
    expect(configuration.scheduler.piReview.teams[0].productOwnerAssignee).toBe('C73130');
    expect(configuration.scheduler.piReview.teams[0].pages[0].piName).toBe('PI 26.4');
  });

  it('persists scheduler.piReview.teams via saveConfigToDisk (no credential fields)', () => {
    fsMock.existsSync.mockReturnValue(false);
    const configuration = loadConfig(); // full defaults so saveConfigToDisk has every section it reads
    configuration.scheduler.piReview = {
      teams: [{
        teamName: 'Cleanup Crew',
        isEnabled: false,
        scheduleTime: '07:00',
        productOwnerAssignee: 'C99999',
        piFieldId: 'customfield_10301',
        pages: [{ pageUrlOrId: 'https://acme.atlassian.net/wiki/pages/67890/PI', piName: 'PI 26.5' }],
      }],
    };

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});

    saveConfigToDisk(configuration);

    const persisted = JSON.parse(writtenJson);
    expect(persisted.scheduler.piReview.teams).toHaveLength(1);
    expect(persisted.scheduler.piReview.teams[0].teamName).toBe('Cleanup Crew');
    expect(persisted.scheduler.piReview.teams[0].pages[0].piName).toBe('PI 26.5');
  });
});
