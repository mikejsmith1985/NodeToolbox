// wizardInstall.test.ts — Proves the Wizard window template has every mark the loader fills, and that boot data can
// never end the page's script early.

import { describe, expect, it } from 'vitest';

import { assembleWizardHtml, buildWizardWindowTemplate, encodeBootJson, INSTALL_STORE_CONFIG, WIZARD_WINDOW_PAGE } from './wizardInstall.ts';

describe('buildWizardWindowTemplate', () => {
  it('is the Wizard window page with one mark each for boot data, look and code', () => {
    const template = buildWizardWindowTemplate();
    expect(template).toContain(`<title>${WIZARD_WINDOW_PAGE.title}</title>`);
    for (const placeholder of [INSTALL_STORE_CONFIG.bootPlaceholder, INSTALL_STORE_CONFIG.stylePlaceholder, INSTALL_STORE_CONFIG.appPlaceholder]) {
      expect(template.split(placeholder).length - 1).toBe(1);
    }
  });

  it('assembles into a page that carries the code, look and boot data', () => {
    const pageHtml = assembleWizardHtml(buildWizardWindowTemplate(), { version: 'v1', appSource: 'run()', styleSource: 'b{}' }, encodeBootJson({ token: 't' }), INSTALL_STORE_CONFIG);
    expect(pageHtml).toContain('<script>run()</script>');
    expect(pageHtml).toContain('<style>b{}</style>');
    expect(pageHtml).toContain('window.__SNOW_WIZARD_BOOT__={"token":"t"};');
  });
});

describe('encodeBootJson', () => {
  it('turns every "<" into its JSON escape so the boot data can never close the script', () => {
    const bootJson = encodeBootJson({ token: 'a</script>b' });
    expect(bootJson).not.toContain('<');
    expect(JSON.parse(bootJson)).toEqual({ token: 'a</script>b' });
  });
});
