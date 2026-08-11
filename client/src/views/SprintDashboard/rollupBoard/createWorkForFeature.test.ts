// createWorkForFeature.test.ts — Proves an issue created from the board actually appears on it.
//
// The whole point of creating from here is that the new issue lands in the right lane. This board is
// scoped by `<PI field> = "PI 26.4"` and its lanes come from the Feature Link, so an issue created
// without both is invisible the moment it is saved — the failure that hid ENCUC-2208 for a whole PI.

import { describe, expect, it } from 'vitest';

import {
  buildBoardVisibilityPayload,
  buildNewWorkPayload,
  describeCreationOutcome,
  isNewWorkRequestComplete,
} from './createWorkForFeature.ts';

const REQUEST = { projectKey: 'ENCUC', issueTypeId: '10001', summary: 'Wire up the retry handler' };

describe('buildNewWorkPayload — only what Jira always accepts', () => {
  it('carries the project, type and summary', () => {
    expect(buildNewWorkPayload(REQUEST)).toEqual({
      fields: {
        project: { key: 'ENCUC' },
        issuetype: { id: '10001' },
        summary: 'Wire up the retry handler',
      },
    });
  });

  it('sends no custom field, which would make Jira reject the whole create', () => {
    const payloadFieldNames = Object.keys(buildNewWorkPayload(REQUEST).fields);
    expect(payloadFieldNames).toEqual(['project', 'issuetype', 'summary']);
  });

  it('tidies whitespace so a pasted summary does not arrive with line breaks in it', () => {
    const payload = buildNewWorkPayload({ ...REQUEST, summary: '  Wire up\n  the handler  ' });
    expect(payload.fields.summary).toBe('Wire up the handler');
  });
});

describe('isNewWorkRequestComplete — never send a half-filled create', () => {
  it('accepts a complete request', () => {
    expect(isNewWorkRequestComplete(REQUEST)).toBe(true);
  });

  it('rejects a blank summary, including one that is only spaces', () => {
    expect(isNewWorkRequestComplete({ ...REQUEST, summary: '   ' })).toBe(false);
  });

  it('rejects a missing issue type', () => {
    expect(isNewWorkRequestComplete({ ...REQUEST, issueTypeId: '' })).toBe(false);
  });

  it('rejects a missing project', () => {
    expect(isNewWorkRequestComplete({ ...REQUEST, projectKey: '' })).toBe(false);
  });
});

/** Stands in for resolvePiFieldUpdateValue, which the app already owns and tests. */
const shapePiValue = (piValue: string) => ({ value: piValue });
/** Stands in for buildFeatureFieldUpdateFields, likewise already owned and tested. */
const shapeFeatureLink = (fieldId: string, featureKey: string) => ({ [fieldId]: featureKey });

describe('buildBoardVisibilityPayload — both fields, for different reasons', () => {
  const FIELDS = {
    featureLinkFieldId: 'customfield_10108',
    featureKey: 'DENP-1387',
    piFieldId: 'customfield_10301',
    piValue: 'PI 26.4',
  };

  it('sets the Feature Link so the issue lands in the right lane, and the PI so it is in scope at all', () => {
    expect(buildBoardVisibilityPayload(FIELDS, shapePiValue, shapeFeatureLink)).toEqual({
      fields: {
        customfield_10108: 'DENP-1387',
        customfield_10301: { value: 'PI 26.4' },
      },
    });
  });

  it('delegates both shapes rather than deciding them here, so they cannot drift', () => {
    const payload = buildBoardVisibilityPayload(
      FIELDS,
      (piValue) => `plain:${piValue}`,
      (fieldId, featureKey) => ({ parent: { key: featureKey }, [fieldId]: featureKey }),
    );

    expect(payload!.fields.customfield_10301).toBe('plain:PI 26.4');
    expect(payload!.fields.parent).toEqual({ key: 'DENP-1387' });
  });

  it('still sets the Feature Link when the board is not scoped by a PI', () => {
    const payload = buildBoardVisibilityPayload(
      { ...FIELDS, piFieldId: '', piValue: '' }, shapePiValue, shapeFeatureLink,
    );
    expect(payload).toEqual({ fields: { customfield_10108: 'DENP-1387' } });
  });

  it('returns null when neither field can be written, so no empty edit is sent', () => {
    const payload = buildBoardVisibilityPayload(
      { featureLinkFieldId: '', featureKey: '', piFieldId: '', piValue: '' },
      shapePiValue,
      shapeFeatureLink,
    );
    expect(payload).toBeNull();
  });
});

describe('describeCreationOutcome — a half-finished create must not read as done', () => {
  it('confirms the issue will appear when both halves worked', () => {
    expect(describeCreationOutcome('ENCUC-2300', true, null))
      .toBe('ENCUC-2300 created and linked — it should appear on this board now.');
  });

  it('says the issue exists AND that it will not show, since either alone would mislead', () => {
    const message = describeCreationOutcome('ENCUC-2300', false, 'field not on screen');

    expect(message).toContain('ENCUC-2300 was created');
    expect(message).toContain('will not show on this board');
    expect(message).toContain('field not on screen');
  });

  it('reads properly when there is no error text to quote', () => {
    expect(describeCreationOutcome('ENCUC-2300', false, null)).not.toContain('()');
  });
});
