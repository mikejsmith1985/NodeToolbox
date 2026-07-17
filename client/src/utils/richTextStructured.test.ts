// richTextStructured.test.ts — Unit tests for the structure-preserving description parser.

import { describe, expect, it } from 'vitest';

import { parseStructuredText } from './richTextStructured.ts';

describe('parseStructuredText', () => {
  it('parses the reporter-screenshot shape: run-in headings with paragraph steps', () => {
    const rawDescription = [
      'Steps to Reproduce:',
      'Using a NON migrated member',
      'Day one:',
      'Member is enrolled into Plan A effective 5/1/2025',
      'Export to Facets',
    ].join('\n');

    expect(parseStructuredText(rawDescription)).toEqual([
      { kind: 'heading', text: 'Steps to Reproduce:' },
      { kind: 'paragraph', text: 'Using a NON migrated member' },
      { kind: 'heading', text: 'Day one:' },
      { kind: 'paragraph', text: 'Member is enrolled into Plan A effective 5/1/2025' },
      { kind: 'paragraph', text: 'Export to Facets' },
    ]);
  });

  it('parses Jira-wiki bold lines as headings, stripping the asterisks', () => {
    expect(parseStructuredText('*Steps:*\nDo the thing')).toEqual([
      { kind: 'heading', text: 'Steps:' },
      { kind: 'paragraph', text: 'Do the thing' },
    ]);
  });

  it('parses -, * and # lines as list items, with doubled markers as level 2', () => {
    const rawDescription = ['- first', '* second', '# third', '** nested', '-- also nested'].join('\n');

    expect(parseStructuredText(rawDescription)).toEqual([
      { kind: 'listItem', text: 'first', level: 1 },
      { kind: 'listItem', text: 'second', level: 1 },
      { kind: 'listItem', text: 'third', level: 1 },
      { kind: 'listItem', text: 'nested', level: 2 },
      { kind: 'listItem', text: 'also nested', level: 2 },
    ]);
  });

  it('does not mistake a bold lead line for a list item', () => {
    expect(parseStructuredText('*Steps to Reproduce:*')).toEqual([
      { kind: 'heading', text: 'Steps to Reproduce:' },
    ]);
  });

  it('degrades arbitrary text to one paragraph per line — never emptier than the flat rendering', () => {
    const rawDescription = 'Just a long sentence without any structure whatsoever spanning ideas\nand a second line';
    expect(parseStructuredText(rawDescription)).toEqual([
      { kind: 'paragraph', text: 'Just a long sentence without any structure whatsoever spanning ideas' },
      { kind: 'paragraph', text: 'and a second line' },
    ]);
  });

  it('does not treat a long colon-terminated sentence as a heading', () => {
    const longColonLine = 'This is a very long sentence that happens to end with a colon and should stay prose:';
    expect(parseStructuredText(longColonLine)).toEqual([{ kind: 'paragraph', text: longColonLine }]);
  });

  it('returns an empty list for blank or non-text input', () => {
    expect(parseStructuredText('')).toEqual([]);
    expect(parseStructuredText(null)).toEqual([]);
    expect(parseStructuredText(undefined)).toEqual([]);
  });
});
