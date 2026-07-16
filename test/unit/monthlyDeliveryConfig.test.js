// test/unit/monthlyDeliveryConfig.test.js — The scheduler.monthlyDelivery config block round-trips
// through load and save (feature 018). saveConfigToDisk is a whitelist serializer, so a block missing
// from the whitelist is silently dropped — this suite is the guard against that. No credential fields
// (auth reuses configuration.jira).

'use strict';

jest.mock('fs');
const fsMock = require('fs');

const { loadConfig, saveConfigToDisk } = require('../../src/config/loader');

const SAMPLE_MONTHLY_DELIVERY_CONFIG = {
  isEnabled: true,
  scheduleTime: '08:00',
  featureLinkFieldId: 'customfield_10108',
  teams: [
    { teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' },
    { teamName: 'Cleanup Crew', projectKey: 'CLNC', boardId: '77' },
  ],
};

describe('scheduler.monthlyDelivery config', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('surfaces scheduler.monthlyDelivery from a saved config file on load', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      scheduler: { monthlyDelivery: SAMPLE_MONTHLY_DELIVERY_CONFIG },
    }));

    const configuration = loadConfig();

    expect(configuration.scheduler.monthlyDelivery.isEnabled).toBe(true);
    expect(configuration.scheduler.monthlyDelivery.scheduleTime).toBe('08:00');
    expect(configuration.scheduler.monthlyDelivery.teams).toHaveLength(2);
    expect(configuration.scheduler.monthlyDelivery.teams[0].projectKey).toBe('TRFM');
  });

  it('persists scheduler.monthlyDelivery via saveConfigToDisk (whitelist serializer)', () => {
    fsMock.existsSync.mockReturnValue(false);
    const configuration = loadConfig(); // full defaults so saveConfigToDisk has every section it reads
    configuration.scheduler.monthlyDelivery = SAMPLE_MONTHLY_DELIVERY_CONFIG;

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});

    saveConfigToDisk(configuration);

    const persisted = JSON.parse(writtenJson);
    expect(persisted.scheduler.monthlyDelivery.isEnabled).toBe(true);
    expect(persisted.scheduler.monthlyDelivery.featureLinkFieldId).toBe('customfield_10108');
    expect(persisted.scheduler.monthlyDelivery.teams).toHaveLength(2);
    expect(persisted.scheduler.monthlyDelivery.teams[1]).toEqual(
      { teamName: 'Cleanup Crew', projectKey: 'CLNC', boardId: '77' },
    );
  });

  it('writes safe defaults when the block was never configured', () => {
    fsMock.existsSync.mockReturnValue(false);
    const configuration = loadConfig();

    let writtenJson = '';
    fsMock.writeFileSync.mockImplementation((_filePath, contents) => { writtenJson = contents; });
    fsMock.mkdirSync.mockImplementation(() => {});

    saveConfigToDisk(configuration);

    const persisted = JSON.parse(writtenJson);
    expect(persisted.scheduler.monthlyDelivery).toEqual({
      isEnabled: false,
      scheduleTime: '08:00',
      featureLinkFieldId: 'customfield_10108',
      teams: [],
    });
  });
});
