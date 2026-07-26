// rewriteBatchExport.ts — Pure before/after export builders for a re-write batch (spec 030). Two forms:
// Markdown (pastes into email/Teams/Confluence) and a self-contained HTML file (side-by-side, opens in
// any browser). The proposals are already AI-attribution-stripped; the export adds none. No DOM/clock/I/O.

import type { BatchExportInput } from './rewriteBatchModel';

/** Escapes the five HTML-significant characters so issue content can't break the document. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders the batch as a Markdown before/after document. */
export function buildMarkdownExport(items: BatchExportInput[]): string {
  const sections = items.map((item) => [
    `## ${item.jiraKey}`,
    '',
    '### Before',
    `**Summary:** ${item.original.summary}`,
    '',
    item.original.description,
    '',
    `**Acceptance Criteria:**`,
    item.original.acceptanceCriteria,
    '',
    '### After (proposed description + acceptance criteria)',
    item.proposed.description,
    '',
    `**Acceptance Criteria:**`,
    item.proposed.acceptanceCriteria,
  ].join('\n'));
  return ['# Feature re-write — before / after', '', sections.join('\n\n---\n\n')].join('\n');
}

/** Renders the batch as a self-contained HTML document with a side-by-side before/after per issue. */
export function buildHtmlExport(items: BatchExportInput[], title = 'Feature re-write — before / after'): string {
  const rows = items.map((item) => `
    <section class="issue">
      <h2>${escapeHtml(item.jiraKey)}</h2>
      <div class="cols">
        <div class="col">
          <h3>Before</h3>
          <p class="label">Summary</p><p>${escapeHtml(item.original.summary)}</p>
          <pre>${escapeHtml(item.original.description)}</pre>
          <p class="label">Acceptance Criteria</p><pre>${escapeHtml(item.original.acceptanceCriteria)}</pre>
        </div>
        <div class="col">
          <h3>After (proposed description + acceptance criteria)</h3>
          <pre>${escapeHtml(item.proposed.description)}</pre>
          <p class="label">Acceptance Criteria</p><pre>${escapeHtml(item.proposed.acceptanceCriteria)}</pre>
        </div>
      </div>
    </section>`).join('\n');
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:24px;color:#111;background:#fff}',
    'h1{font-size:20px} h2{font-size:16px;margin-top:28px;border-top:1px solid #ddd;padding-top:16px}',
    '.cols{display:flex;gap:24px} .col{flex:1;min-width:0}',
    '.label{font-weight:600;margin:8px 0 2px;color:#555;font-size:12px;text-transform:uppercase}',
    'pre{white-space:pre-wrap;word-wrap:break-word;background:#f6f6f6;padding:10px;border-radius:6px;font-family:inherit}',
    '</style></head><body>',
    `<h1>${escapeHtml(title)}</h1>`,
    rows,
    '</body></html>',
  ].join('\n');
}
