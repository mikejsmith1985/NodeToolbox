// parseMime.test.ts — The minimal MIME reader. MIME is a standard, so these fixtures exercise the
// encodings GitHub emails use (quoted-printable, base64, multipart/alternative) without needing real
// GitHub content.

import { describe, expect, it } from 'vitest';

import { parseMime, getHeader } from './parseMime.ts';

describe('parseMime', () => {
  it('reads headers (case-insensitively) and a plain-text body', () => {
    const raw = [
      'From: notifications@github.com',
      'Subject: Hello world',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'This is the body.',
    ].join('\r\n');

    const message = parseMime(raw);

    expect(getHeader(message, 'from')).toBe('notifications@github.com');
    expect(getHeader(message, 'SUBJECT')).toBe('Hello world');
    expect(message.textPlain).toBe('This is the body.');
    expect(message.textHtml).toBeNull();
  });

  it('unfolds folded header values', () => {
    const raw = ['Subject: a very', ' long subject line', '', 'body'].join('\r\n');

    expect(getHeader(parseMime(raw), 'subject')).toBe('a very long subject line');
  });

  it('decodes an RFC-2047 encoded-word Subject (Q-encoding)', () => {
    const raw = ['Subject: =?UTF-8?Q?Caf=C3=A9_time?=', '', 'body'].join('\r\n');

    expect(getHeader(parseMime(raw), 'subject')).toBe('Café time');
  });

  it('decodes a quoted-printable body with soft breaks and UTF-8', () => {
    const raw = [
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Merged =23123 into main from feature/DENP-1414 =E2=9C=94',
    ].join('\r\n');

    expect(parseMime(raw).textPlain).toBe('Merged #123 into main from feature/DENP-1414 ✔');
  });

  it('decodes a base64 body as UTF-8', () => {
    // "opened this pull request" base64
    const encoded = btoa('opened this pull request');
    const raw = [
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
    ].join('\r\n');

    expect(parseMime(raw).textPlain).toBe('opened this pull request');
  });

  it('splits a multipart/alternative into text/plain and text/html', () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'plain version',
      '--XYZ',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<p>html version</p>',
      '--XYZ--',
    ].join('\r\n');

    const message = parseMime(raw);
    expect(message.textPlain).toBe('plain version');
    expect(message.textHtml).toContain('<p>html version</p>');
  });

  it('never throws on malformed input', () => {
    expect(() => parseMime('not really an email')).not.toThrow();
    expect(parseMime('').textPlain).toBe('');
  });
});
