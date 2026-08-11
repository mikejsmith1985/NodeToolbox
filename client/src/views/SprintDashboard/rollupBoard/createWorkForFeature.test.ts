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
  shapeFieldValue,
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

describe('shapeFieldValue — the schema decides, never a guess', () => {
  it('wraps a select value the way Jira wants it', () => {
    expect(shapeFieldValue({ schema: { type: 'option' } }, 'PI 26.4')).toEqual({ value: 'PI 26.4' });
  });

  it('wraps a multi-select value in an array', () => {
    expect(shapeFieldValue({ schema: { type: 'array' } }, 'PI 26.4')).toEqual([{ value: 'PI 26.4' }]);
  });

  it('sends a text field as a bare string', () => {
    expect(shapeFieldValue({ schema: { type: 'string' } }, 'DENP-1387')).toBe('DENP-1387');
  });

  it('returns null when the instance does not offer the field, so it is omitted not guessed', () => {
    expect(shapeFieldValue(undefined, 'DENP-1387')).toBeNull();
  });

  it('returns null for an empty value rather than writing a blank over something', () => {
    expect(shapeFieldValue({ schema: { type: 'string' } }, '   ')).toBeNull();
  });
});

describe('buildBoardVisibilityPayload — both fields, for different reasons', () => {
  const SHAPES = {
    customfield_10108: { schema: { type: 'string' } },
    customfield_10301: { schema: { type: 'option' } },
  };
  const FIELDS = {
    featureLinkFieldId: 'customfield_10108',
    featureKey: 'DENP-1387',
    piFieldId: 'customfield_10301',
    piValue: 'PI 26.4',
  };

  it('sets the Feature Link so the issue lands in the right lane, and the PI so it is in scope at all', () => {
    expect(buildBoardVisibilityPayload(FIELDS, SHAPES)).toEqual({
      fields: {
        customfield_10108: 'DENP-1387',
        customfield_10301: { value: 'PI 26.4' },
      },
    });
  });

  it('still sets the Feature Link when the instance has no PI field', () => {
    const payload = buildBoardVisibilityPayload({ ...FIELDS, piFieldId: '' }, SHAPES);
    expect(payload).toEqual({ fields: { customfield_10108: 'DENP-1387' } });
  });

  it('omits a field this project does not carry rather than writing something Jira refuses', () => {
    const payload = buildBoardVisibilityPayload(FIELDS, { customfield_10108: { schema: { type: 'string' } } });
    expect(payload).toEqual({ fields: { customfield_10108: 'DENP-1387' } });
  });

  it('returns null when neither field can be written, so no empty edit is sent', () => {
    expect(buildBoardVisibilityPayload(FIELDS, {})).toBeNull();
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
