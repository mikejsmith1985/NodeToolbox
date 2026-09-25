// reportMarkup.test.ts — A report pasted into Jira showed its own hashes and asterisks, because Jira Data Center
// renders wiki markup rather than Markdown. These pin the characters each destination actually needs.

import { describe, expect, it } from 'vitest';

import { buildReportMarkup, escapeTableCell, FLAVOUR_LABELS } from './reportMarkup.ts';

describe('Jira wiki markup', () => {
  const jira = buildReportMarkup('jira');

  it('writes headings as Jira writes them', () => {
    expect(jira.heading(1, 'Readiness review')).toBe('h1. Readiness review');
    expect(jira.heading(3, 'Business Readiness')).toBe('h3. Business Readiness');
  });

  it('emphasises with one asterisk, not two', () => {
    expect(jira.bold('Business objective')).toBe('*Business objective*');
  });

  it('nests bullets by repeating the marker, since Jira ignores indentation', () => {
    expect(jira.bullet(1, 'Major dependencies are identified')).toBe('* Major dependencies are identified');
    expect(jira.bullet(2, 'Still needed: name them')).toBe('** Still needed: name them');
  });

  it('writes a table Jira renders, with no separator row', () => {
    expect(jira.tableHeader(['Epic', 'Summary'])).toBe('||Epic||Summary||');
    expect(jira.tableRow(['DENP-1', 'A summary'])).toBe('|DENP-1|A summary|');
    expect(jira.tableSeparator(2)).toEqual([]);
  });

  it('shows a JQL query as text rather than as markup', () => {
    expect(jira.code('project = DENP')).toBe('{{project = DENP}}');
  });
});

describe('Markdown', () => {
  const markdown = buildReportMarkup('markdown');

  it('writes what Teams, Confluence and GitHub read', () => {
    expect(markdown.heading(2, 'Definition of Ready')).toBe('## Definition of Ready');
    expect(markdown.bold('Business objective')).toBe('**Business objective**');
    expect(markdown.bullet(2, 'Still needed: name them')).toBe('  - Still needed: name them');
    expect(markdown.code('project = DENP')).toBe('`project = DENP`');
  });

  it('follows a table header with the separator row Markdown requires', () => {
    expect(markdown.tableSeparator(3)).toEqual(['| --- | --- | --- |']);
  });
});

describe('escapeTableCell', () => {
  it('keeps a pipe in a summary from shifting every column after it', () => {
    expect(escapeTableCell('Enrollment | Transformers')).toBe('Enrollment \\| Transformers');
  });

  it('flattens a newline, which would otherwise end the row', () => {
    expect(escapeTableCell('First line\nSecond line')).toBe('First line Second line');
  });
});

describe('the copy buttons', () => {
  it('name where each copy is going', () => {
    expect(FLAVOUR_LABELS.jira).toBe('Copy for Jira');
    expect(FLAVOUR_LABELS.markdown).toBe('Copy as Markdown');
  });
});
