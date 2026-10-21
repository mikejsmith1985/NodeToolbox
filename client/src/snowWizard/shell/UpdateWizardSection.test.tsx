// UpdateWizardSection.test.tsx — Proves Settings → Update installs a new Wizard from its release file with a clear
// ✓/✗, refuses any other file, and restarts this window into the new version.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UpdateWizardSection, { type WizardUpdateDependencies } from './UpdateWizardSection.tsx';

const BOOT = { instanceOrigin: 'https://acme.service-now.com', userToken: 'tok', channelName: 'snowWizard' };

function buildReleaseFile(version: string): File {
  const payload = JSON.stringify({ kind: 'snowWizardInstall', version, appSource: 'startNewWizard()', styleSource: 'p{}' });
  return new File([`<html><body><script type="application/json" id="snow-wizard-install">${payload}</script></body></html>`], 'snow-hub-wizard.html', { type: 'text/html' });
}

function renderSection(dependencies: Partial<WizardUpdateDependencies> = {}) {
  const fullDependencies: WizardUpdateDependencies = { saveInstalledWizard: vi.fn(async () => undefined), openPage: vi.fn(), ...dependencies };
  render(<UpdateWizardSection boot={BOOT} appVersion="v0.315.3" dependencies={fullDependencies} />);
  return fullDependencies;
}

function chooseFile(chosenFile: File): void {
  fireEvent.change(screen.getByLabelText('The new snow-hub-wizard.html'), { target: { files: [chosenFile] } });
}

describe('UpdateWizardSection', () => {
  it('installs the chosen release, says so, and restarts this window into it', async () => {
    const dependencies = renderSection();
    expect(screen.getByText(/This is v0\.315\.3/)).toBeTruthy();
    chooseFile(buildReleaseFile('v0.316.0'));

    expect(await screen.findByText(/✓ SNow Wizard v0\.316\.0 is installed/)).toBeTruthy();
    expect(dependencies.saveInstalledWizard).toHaveBeenCalledWith({ version: 'v0.316.0', appSource: 'startNewWizard()', styleSource: 'p{}' });
    fireEvent.click(screen.getByRole('button', { name: 'Restart now with v0.316.0' }));
    const openedPage = vi.mocked(dependencies.openPage).mock.calls[0][0];
    expect(openedPage).toContain('<script>startNewWizard()</script>');
    expect(openedPage).toContain('"userToken":"tok"');
  });

  it('refuses a file that is not the SNow Wizard and changes nothing', async () => {
    const dependencies = renderSection();
    chooseFile(new File(['<html>hello</html>'], 'notes.html', { type: 'text/html' }));
    expect(await screen.findByText(/✗ That is not the SNow Wizard file/)).toBeTruthy();
    expect(dependencies.saveInstalledWizard).not.toHaveBeenCalled();
  });

  it('says plainly when the browser would not keep the new version', async () => {
    renderSection({ saveInstalledWizard: vi.fn(async () => { throw new Error('storage is full'); }) });
    chooseFile(buildReleaseFile('v0.316.0'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('✗ Not installed — storage is full'));
    expect(screen.queryByRole('button', { name: /Restart now/ })).toBeNull();
  });
});
