// rosterImport.test.ts — Tests for parsing pasted Team Dashboard roster tables into roster member drafts.

import { describe, expect, it } from 'vitest';

import { parseRosterMembersFromPasteText } from './rosterImport.ts';

const IMPORT_SAMPLE_TEXT = `#

Team

Name

Role

Email

Location / Time Zone

Lan ID

Working Hours

1

QE / Transformers

Shahsamnan Ibrahim Shaikh

QE Transformer shift-left

ShahsamnanIbrahim.Shaikh@cignahealthcare.com

India, GMT+5:30

M07311

50% Transformers / 50% E2E Phoenix QE

2

QE

Bhargavi Somagutta (6/30)

QE

Bhargavi.Somagutta@cignahealthcare.com

India, GMT+5:30

M07322`;

const MISSING_EMAIL_SAMPLE_TEXT = `#

Team

Name

Role

Email

Location / Time Zone

Lan ID

Working Hours

1

Clean Up Crew

Amber Cannon

Scrum Master

2

Clean Up Crew

Jere Neal

Engineering Manager

Jeremiah.Neal@CignaHealthcare.com

CST`;

describe('parseRosterMembersFromPasteText', () => {
  it('parses pasted roster rows and preserves the imported metadata fields', () => {
    expect(parseRosterMembersFromPasteText(IMPORT_SAMPLE_TEXT)).toEqual([
      {
        assigneeQueryValue: 'Shahsamnan Ibrahim Shaikh',
        displayName: 'Shahsamnan Ibrahim Shaikh',
        emailAddress: 'ShahsamnanIbrahim.Shaikh@cignahealthcare.com',
        lanId: 'M07311',
        locationTimeZone: 'India, GMT+5:30',
        roleName: 'QE Transformer shift-left',
        teamName: 'QE / Transformers',
        workingHours: '50% Transformers / 50% E2E Phoenix QE',
      },
      {
        assigneeQueryValue: 'Bhargavi Somagutta',
        displayName: 'Bhargavi Somagutta',
        emailAddress: 'Bhargavi.Somagutta@cignahealthcare.com',
        lanId: 'M07322',
        locationTimeZone: 'India, GMT+5:30',
        roleName: 'QE',
        teamName: 'QE',
      },
    ]);
  });

  it('keeps rows without email addresses when the name and team are present', () => {
    expect(parseRosterMembersFromPasteText(MISSING_EMAIL_SAMPLE_TEXT)).toEqual([
      {
        assigneeQueryValue: 'Amber Cannon',
        displayName: 'Amber Cannon',
        roleName: 'Scrum Master',
        teamName: 'Clean Up Crew',
      },
      {
        assigneeQueryValue: 'Jere Neal',
        displayName: 'Jere Neal',
        emailAddress: 'Jeremiah.Neal@CignaHealthcare.com',
        locationTimeZone: 'CST',
        roleName: 'Engineering Manager',
        teamName: 'Clean Up Crew',
      },
    ]);
  });
});
