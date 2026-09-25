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

// ── HTML: what this Jira's rich-text editor actually stores (GH #387) ──

describe('HTML', () => {
  const html = buildReportMarkup('html');

  it('writes real elements, not characters that look like markup', () => {
    expect(html.heading(2, 'Definition of Ready')).toBe('<h2>Definition of Ready</h2>');
    expect(html.bold('Business objective')).toBe('<strong>Business objective</strong>');
  });

  it('gathers a run of bullets into one list', () => {
    const document = html.finalize([
      html.heading(2, 'Definition of Ready'),
      html.bullet(1, 'Major dependencies are identified'),
      html.bullet(1, 'Scope is understood'),
    ]);

    expect(document).toBe('<h2>Definition of Ready</h2><ul><li>Major dependencies are identified</li>'
      + '<li>Scope is understood</li></ul>');
  });

  it('nests a deeper bullet inside its own list, and closes both', () => {
    const document = html.finalize([
      html.bullet(1, 'Major dependencies are identified'),
      html.bullet(2, 'Still needed: name them'),
      html.heading(3, 'Team Commitment'),
    ]);

    expect(document).toBe('<ul><li>Major dependencies are identified</li><ul><li>Still needed: name them</li>'
      + '</ul></ul><h3>Team Commitment</h3>');
  });

  it('gathers table rows into one table', () => {
    const document = html.finalize([html.tableHeader(['Epic', 'Summary']), html.tableRow(['DENP-1', 'A summary'])]);

    expect(document).toBe('<table><tr><th>Epic</th><th>Summary</th></tr><tr><td>DENP-1</td><td>A summary</td></tr></table>');
  });

  it('wraps plain prose in a paragraph and drops blank lines', () => {
    expect(html.finalize(['Definition of Ready: NOT MET', ''])).toBe('<p>Definition of Ready: NOT MET</p>');
  });

  it('escapes text that would otherwise be read as markup inside the description', () => {
    expect(html.heading(2, 'Scope <script> & more')).toBe('<h2>Scope &lt;script&gt; &amp; more</h2>');
  });
});
