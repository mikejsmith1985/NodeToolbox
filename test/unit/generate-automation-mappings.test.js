// Unit tests for the automation-mappings docs generator.

'use strict';

const { generateMarkdown, buildSystemPrompt } = require('../../scripts/generate-automation-mappings');
const { listSurfaces } = require('../../src/services/reportSurfaceRegistry');

describe('generate-automation-mappings', () => {
  const markdown = generateMarkdown(listSurfaces());

  test('includes a section for every report surface', () => {
    for (const surface of listSurfaces()) {
      expect(markdown).toContain(surface.label);
      expect(markdown).toContain(`\`${surface.id}\``);
    }
    const sectionCount = (markdown.match(/^## /gm) || []).length;
    expect(sectionCount).toBe(listSurfaces().length);
  });

  test('references the payloadContext smart values for Rovo', () => {
    expect(markdown).toContain('{{webhookData.payloadContext.source}}');
    expect(markdown).toContain('{{webhookData.payloadContext.report}}');
    expect(markdown).toContain('payloadContext');
  });

  test('system prompt names the surface label', () => {
    const [firstSurface] = listSurfaces();
    expect(buildSystemPrompt(firstSurface)).toContain(firstSurface.label);
  });
});
