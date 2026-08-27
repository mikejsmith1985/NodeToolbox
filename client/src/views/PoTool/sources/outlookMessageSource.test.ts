// outlookMessageSource.test.ts — Reading a saved Outlook message without losing who said it, or when.

import { describe, expect, it } from 'vitest';

import {
  buildMessageText,
  OutlookMessageReadError,
  readMessageFromEntries,
  readOutlookMessageSource,
  readSentDate,
  readTextProperty,
  type CompoundFileEntry,
  type CompoundFileReader,
} from './outlookMessageSource.ts';

/** A UTF-16 little-endian property stream, the way Outlook stores Unicode text. */
function unicodeEntry(propertyId: string, value: string): CompoundFileEntry {
  const bytes: number[] = [];
  for (const character of value) {
    const codeUnit = character.charCodeAt(0);
    bytes.push(codeUnit & 0xff, codeUnit >> 8);
  }
  return { name: `__substg1.0_${propertyId}001F`, content: new Uint8Array(bytes) };
}

/** An 8-bit property stream, the encoding older senders still produce. */
function singleByteEntry(propertyId: string, value: string): CompoundFileEntry {
  return {
    name: `__substg1.0_${propertyId}001E`,
    content: new Uint8Array([...value].map((character) => character.charCodeAt(0))),
  };
}

/** The HTML body stream, which is stored as bytes rather than as a string property. */
function htmlBodyEntry(html: string): CompoundFileEntry {
  return {
    name: '__substg1.0_10130102',
    content: new Uint8Array([...html].map((character) => character.charCodeAt(0))),
  };
}

/** A File whose bytes start the way a compound file's do. */
function messageFile(name = 'decision.msg'): File {
  return new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])], name);
}

/** A reader standing in for `cfb`, serving the given entries. */
function readerFor(entries: readonly CompoundFileEntry[]): CompoundFileReader {
  return async () => [...entries];
}

describe('readTextProperty', () => {
  it('reads the Unicode form, which is what a modern Outlook writes', () => {
    expect(readTextProperty([unicodeEntry('0037', 'Runout ownership')], '0037')).toBe('Runout ownership');
  });

  it('falls back to the 8-bit form, so a message from another mail client still reads', () => {
    // Reading only the Unicode form works perfectly right up until somebody hands you a file that
    // was not saved by the Outlook build that happened to be tested.
    expect(readTextProperty([singleByteEntry('0037', 'Legacy subject')], '0037')).toBe('Legacy subject');
  });

  it('returns nothing when the property is absent, rather than guessing', () => {
    expect(readTextProperty([unicodeEntry('0037', 'A subject')], '0C1A')).toBe('');
  });

  it('matches a stream whatever path the container reports it under', () => {
    const entry: CompoundFileEntry = { ...unicodeEntry('0037', 'Nested'), name: 'Root Entry/__substg1.0_0037001F' };

    expect(readTextProperty([entry], '0037')).toBe('Nested');
  });

  it('skips a present-but-empty property and keeps looking', () => {
    const entries = [unicodeEntry('0037', '   '), singleByteEntry('0037', 'The real subject')];

    expect(readTextProperty(entries, '0037')).toBe('The real subject');
  });
});

describe('readSentDate', () => {
  it('takes the date out of the transport headers', () => {
    const headers = 'Received: from mail\r\nDate: Mon, 17 Aug 2026 14:02:11 -0400\r\nSubject: x';

    expect(readSentDate(headers)).toBe('Mon, 17 Aug 2026 14:02:11 -0400');
  });

  it('returns nothing when the headers carried no date, rather than inventing one', () => {
    expect(readSentDate('Subject: no date here')).toBe('');
  });

  it('returns nothing when there are no headers at all', () => {
    expect(readSentDate('')).toBe('');
  });
});

describe('readMessageFromEntries', () => {
  it('prefers the plain body, because the HTML one has to be reduced to get there', () => {
    const message = readMessageFromEntries([
      unicodeEntry('1000', 'We agreed to defer runout.'),
      htmlBodyEntry('<p>A reduced version</p>'),
    ]);

    expect(message.body).toBe('We agreed to defer runout.');
  });

  it('falls back to the HTML body, keeping its tables', () => {
    const message = readMessageFromEntries([
      htmlBodyEntry('<table><tr><td>Process</td><td>Owner</td></tr><tr><td>Runout</td><td>Blue</td></tr></table>'),
    ]);

    expect(message.body).toContain('| Process | Owner |');
    expect(message.body).toContain('| Runout | Blue |');
  });

  it('reads who sent it and who it went to', () => {
    const message = readMessageFromEntries([
      unicodeEntry('0C1A', 'Reynolds, Kevin (CTR)'),
      unicodeEntry('0C1F', 'kevin.reynolds@example.com'),
      unicodeEntry('0E04', 'Smith, Mike'),
      unicodeEntry('0E03', 'Architecture Team'),
    ]);

    expect(message.senderName).toBe('Reynolds, Kevin (CTR)');
    expect(message.senderEmail).toBe('kevin.reynolds@example.com');
    expect(message.displayTo).toBe('Smith, Mike');
    expect(message.displayCc).toBe('Architecture Team');
  });
});

describe('buildMessageText', () => {
  const message = {
    subject: 'Runout ownership',
    senderName: 'Reynolds, Kevin',
    senderEmail: 'kevin@example.com',
    displayTo: 'Smith, Mike',
    displayCc: '',
    sentDate: 'Mon, 17 Aug 2026 14:02:11 -0400',
    body: 'We agreed to defer runout to Purple.',
  };

  it('heads the body with who sent it and when, because that is what settles an argument', () => {
    // This text is what rides into a prompt; a field on a record the assistant never sees cannot tell
    // it who said something or when.
    const text = buildMessageText(message);

    expect(text).toContain('Subject: Runout ownership');
    expect(text).toContain('From: Reynolds, Kevin <kevin@example.com>');
    expect(text).toContain('Sent: Mon, 17 Aug 2026 14:02:11 -0400');
    expect(text).toContain('We agreed to defer runout to Purple.');
  });

  it('leaves out a header the message did not carry, rather than printing an empty one', () => {
    const text = buildMessageText({ ...message, displayCc: '', sentDate: '' });

    expect(text).not.toContain('Cc:');
    expect(text).not.toContain('Sent:');
  });

  it('does not print a name twice when the address is all the message had', () => {
    const text = buildMessageText({ ...message, senderName: 'kevin@example.com' });

    expect(text).toContain('From: kevin@example.com');
    expect(text).not.toContain('kevin@example.com <kevin@example.com>');
  });
});

describe('readOutlookMessageSource', () => {
  it('reads a message into a source titled by its subject', async () => {
    const source = await readOutlookMessageSource(messageFile('runout.msg'), [], readerFor([
      unicodeEntry('0037', 'Runout ownership'),
      unicodeEntry('0C1A', 'Reynolds, Kevin'),
      unicodeEntry('1000', 'We agreed to defer runout.'),
      unicodeEntry('007D', 'Date: Mon, 17 Aug 2026 14:02:11 -0400'),
    ]));

    expect(source.kind).toBe('email');
    expect(source.subject).toBe('Runout ownership');
    expect(source.senderName).toBe('Reynolds, Kevin');
    expect(source.sentDate).toBe('Mon, 17 Aug 2026 14:02:11 -0400');
    expect(source.text).toContain('We agreed to defer runout.');
  });

  it('refuses a file that is not a compound file, and names the format that is', async () => {
    const notAMessage = new File([new Uint8Array([0x46, 0x72, 0x6f, 0x6d])], 'note.msg');

    await expect(readOutlookMessageSource(notAMessage, [], readerFor([])))
      .rejects.toThrow(/saved as .eml or .txt is a different format/);
  });

  it('refuses a message with no subject and no readable body', async () => {
    await expect(readOutlookMessageSource(messageFile(), [], readerFor([unicodeEntry('0E04', 'Smith, Mike')])))
      .rejects.toThrow(OutlookMessageReadError);
  });

  it('reports a container failure against the file that caused it', async () => {
    const failingReader: CompoundFileReader = async () => {
      throw new Error('bad sector count');
    };

    await expect(readOutlookMessageSource(messageFile('broken.msg'), [], failingReader))
      .rejects.toThrow(/"broken.msg" could not be read as an Outlook message: bad sector count/);
  });

  it('mints an id that does not collide with material already in the workspace', async () => {
    const existing = [{
      kind: 'email' as const,
      id: 'email-1',
      fileName: 'a.msg',
      subject: 's',
      senderName: 'n',
      sentDate: '',
      text: 't',
    }];

    const source = await readOutlookMessageSource(messageFile(), existing, readerFor([unicodeEntry('0037', 'Subject')]));

    expect(source.id).toBe('email-2');
  });
});
