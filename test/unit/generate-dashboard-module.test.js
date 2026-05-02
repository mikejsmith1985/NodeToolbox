// test/unit/generate-dashboard-module.test.js — Verifies that
// scripts/generate-dashboard-module.js produces a valid JavaScript module
// containing the full toolbox.html content as a string export.
//
// This generator runs automatically inside local-release.ps1 before the pkg
// build step. Its output (src/generated/dashboardHtmlContent.js) is compiled
// into the pkg snapshot, guaranteeing the HTML is always available inside the
// bundled .exe regardless of what the user's filesystem looks like.

'use strict';

const path          = require('path');
const fs            = require('fs');
const { execSync }  = require('child_process');

const PROJECT_ROOT            = path.join(__dirname, '..', '..');
const GENERATOR_SCRIPT_PATH   = path.join(PROJECT_ROOT, 'scripts', 'generate-dashboard-module.js');
const GENERATED_OUTPUT_PATH   = path.join(PROJECT_ROOT, 'src', 'generated', 'dashboardHtmlContent.js');
const ORIGINAL_TOOLBOX_HTML   = path.join(PROJECT_ROOT, 'public', 'toolbox.html');

describe('generate-dashboard-module.js — generator script existence and correctness', () => {
  it('generator script exists at scripts/generate-dashboard-module.js', () => {
    // The script must exist before local-release.ps1 can call it.
    expect(fs.existsSync(GENERATOR_SCRIPT_PATH)).toBe(true);
  });

  describe('generated output', () => {
    beforeAll(() => {
      // Run the generator so subsequent assertions have fresh output to inspect.
      execSync('node ' + GENERATOR_SCRIPT_PATH, { cwd: PROJECT_ROOT });
    });

    it('creates src/generated/dashboardHtmlContent.js', () => {
      expect(fs.existsSync(GENERATED_OUTPUT_PATH)).toBe(true);
    });

    it('generated file exports a non-empty string', () => {
      // Clear require cache so we always get the freshly generated content.
      jest.resetModules();
      const exportedHtml = require(GENERATED_OUTPUT_PATH);
      expect(typeof exportedHtml).toBe('string');
      expect(exportedHtml.length).toBeGreaterThan(0);
    });

    it('generated HTML contains <!DOCTYPE html>', () => {
      jest.resetModules();
      const exportedHtml = require(GENERATED_OUTPUT_PATH);
      expect(exportedHtml).toMatch(/<!DOCTYPE html>/i);
    });

    it('generated HTML matches the source public/toolbox.html byte-for-byte', () => {
      // Proves the generator does not truncate or corrupt the HTML.
      const sourceHtml    = fs.readFileSync(ORIGINAL_TOOLBOX_HTML, 'utf-8');
      jest.resetModules();
      const exportedHtml  = require(GENERATED_OUTPUT_PATH);
      expect(exportedHtml).toBe(sourceHtml);
    });

    it('generated module header explains it is auto-generated and must not be edited', () => {
      // Guards against accidental manual edits that would be overwritten by the generator.
      const fileContents = fs.readFileSync(GENERATED_OUTPUT_PATH, 'utf-8');
      expect(fileContents).toMatch(/auto-generated/i);
    });
  });
});
