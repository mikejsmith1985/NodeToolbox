// test/unit/generate-embedded-client.test.js — Validates the embedded-client
// generator produces a usable JS module that contains every file under a
// given client-dist root as base64 Buffer values.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT      = path.join(__dirname, '..', '..');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts', 'generate-embedded-client.js');

describe('scripts/generate-embedded-client.js', () => {
  it('exists and contains the expected structure', () => {
    expect(fs.existsSync(GENERATOR_PATH)).toBe(true);
    const generatorSource = fs.readFileSync(GENERATOR_PATH, 'utf8');

    // Must read from client/dist/, write to src/embeddedClient.js,
    // and emit base64-encoded Buffer literals for each file.
    expect(generatorSource).toMatch(/client[\\/]+dist/);
    expect(generatorSource).toMatch(/embeddedClient\.js/);
    expect(generatorSource).toMatch(/Buffer\.from/);
    expect(generatorSource).toMatch(/['"]base64['"]/);
  });

  it('produces a require()-able module with file paths as keys and Buffers as values', () => {
    // Smoke test: run the actual generator end-to-end against a fake
    // client/dist/ tree and confirm the emitted module exports the expected
    // shape — keys are forward-slash-separated relative paths, values are
    // Buffers whose contents round-trip back to the original bytes.
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-client-test-'));
    try {
      const fakeRepoRoot      = sandboxDir;
      const fakeClientDistDir = path.join(fakeRepoRoot, 'client', 'dist');
      const fakeSrcDir        = path.join(fakeRepoRoot, 'src');
      const fakeAssetsDir     = path.join(fakeClientDistDir, 'assets');
      fs.mkdirSync(fakeAssetsDir, { recursive: true });
      fs.mkdirSync(fakeSrcDir,    { recursive: true });

      const indexHtmlContent = '<!doctype html><html><body>hi</body></html>';
      const assetJsContent   = 'console.log("asset");';
      fs.writeFileSync(path.join(fakeClientDistDir, 'index.html'),       indexHtmlContent);
      fs.writeFileSync(path.join(fakeAssetsDir,     'app-AbCd1234.js'),  assetJsContent);

      // Copy the real generator into the sandbox so its __dirname resolves
      // against the sandbox repo root (the generator computes paths relative
      // to its own location).
      const sandboxScriptsDir = path.join(fakeRepoRoot, 'scripts');
      fs.mkdirSync(sandboxScriptsDir, { recursive: true });
      const sandboxedGeneratorPath = path.join(sandboxScriptsDir, 'generate-embedded-client.js');
      fs.copyFileSync(GENERATOR_PATH, sandboxedGeneratorPath);

      execFileSync(process.execPath, [sandboxedGeneratorPath], { stdio: 'pipe' });

      const generatedModulePath = path.join(fakeSrcDir, 'embeddedClient.js');
      expect(fs.existsSync(generatedModulePath)).toBe(true);

      // Require the freshly-generated module and validate its contents.
      // Use a unique cache-busting key so repeated test runs reload the file.
      const embeddedClientFiles = require(generatedModulePath);

      expect(Object.keys(embeddedClientFiles).sort()).toEqual([
        'assets/app-AbCd1234.js',
        'index.html',
      ]);

      expect(Buffer.isBuffer(embeddedClientFiles['index.html'])).toBe(true);
      expect(embeddedClientFiles['index.html'].toString('utf8')).toBe(indexHtmlContent);
      expect(embeddedClientFiles['assets/app-AbCd1234.js'].toString('utf8')).toBe(assetJsContent);
    } finally {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  });
});
