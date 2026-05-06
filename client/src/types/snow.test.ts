// snow.test.ts — Runtime shape checks for ServiceNow domain type literals.

import { describe, expect, it } from 'vitest';

import type {
  ChangeRequest,
  SnowApproval,
  SnowIncident,
  SnowUser,
} from './snow.ts';

describe('snow types', () => {
  it('accepts a ServiceNow user literal with the expected keys', () => {
    const snowUser: SnowUser = {
      sysId: 'user-1',
      name: 'Example User',
      email: 'example@example.com',
    };

    expect(snowUser).toHaveProperty('sysId');
    expect(snowUser).toHaveProperty('name');
    expect(snowUser).toHaveProperty('email');
  });

  it('accepts a change request literal with the expected keys', () => {
    const changeRequest: ChangeRequest = {
      sysId: 'change-1',
      number: 'CHG0001',
      shortDescription: 'Deploy release',
      state: 'Implement',
      assignedTo: null,
      plannedStartDate: '2025-01-01T00:00:00.000Z',
      plannedEndDate: '2025-01-01T01:00:00.000Z',
      risk: 'Moderate',
      impact: 'Low',
    };

    expect(changeRequest).toHaveProperty('number');
    expect(changeRequest).toHaveProperty('shortDescription');
    expect(changeRequest).toHaveProperty('assignedTo');
    expect(changeRequest).toHaveProperty('plannedStartDate');
    expect(changeRequest).toHaveProperty('plannedEndDate');
    expect(changeRequest).toHaveProperty('risk');
    expect(changeRequest).toHaveProperty('impact');
  });

  it('accepts approval and incident literals with the expected keys', () => {
    const approver: SnowUser = {
      sysId: 'user-2',
      name: 'Approver User',
      email: 'approver@example.com',
    };
    const snowApproval: SnowApproval = {
      sysId: 'approval-1',
      approver,
      state: 'requested',
      changeRequestSysId: 'change-1',
    };
    const snowIncident: SnowIncident = {
      sysId: 'incident-1',
      number: 'INC0001',
      shortDescription: 'Production alert',
      state: 'New',
      severity: '1',
      assignedTo: approver,
    };

    expect(snowApproval).toHaveProperty('approver');
    expect(snowApproval).toHaveProperty('state');
    expect(snowApproval).toHaveProperty('changeRequestSysId');
    expect(snowIncident).toHaveProperty('severity');
    expect(snowIncident).toHaveProperty('assignedTo');
  });
});
