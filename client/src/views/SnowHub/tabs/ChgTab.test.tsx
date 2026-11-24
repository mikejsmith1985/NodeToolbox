// ChgTab.test.tsx — Tests for the CHG Generator tab: the guided flow (the SNow Wizard's own change flow) by default,
// with the classic Create/Modify screens one click away and the choice remembered.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import ChgTab, { CHG_GENERATOR_VIEW_STORAGE_KEY } from './ChgTab.tsx';

vi.mock('./CreateChgTab.tsx', () => ({
  default: () => <div data-testid="create-chg-tab">Create CHG Tab</div>,
}));

vi.mock('./ModifyChgTab.tsx', () => ({
  default: () => <div data-testid="modify-chg-tab">Modify CHG Tab</div>,
}));

const changeWizardProps = vi.fn();
vi.mock('../../../snowWizard/change/ChangeWizard.tsx', () => ({
  default: (props: Record<string, unknown>) => {
    changeWizardProps(props);
    return <div data-testid="guided-change-flow">Guided change flow</div>;
  },
}));

/** Switches to the classic screens, the way a user does. */
async function openClassicScreens(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Classic screens/i }));
}

beforeEach(() => {
  localStorage.clear();
  changeWizardProps.mockClear();
});

describe('ChgTab — guided flow', () => {
  it('opens on the guided flow, the same change flow the SNow Wizard runs', () => {
    render(<ChgTab />);
    expect(screen.getByTestId('guided-change-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('create-chg-tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guided/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('mounts the guided flow with no way home, because SNow Hub is its home', () => {
    render(<ChgTab />);
    expect(changeWizardProps).toHaveBeenCalled();
    expect(changeWizardProps.mock.calls[0][0].onExit).toBeUndefined();
  });

  it('remembers the classic screens once chosen', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChgTab />);
    await openClassicScreens(user);
    expect(localStorage.getItem(CHG_GENERATOR_VIEW_STORAGE_KEY)).toBe('classic');
    unmount();
    render(<ChgTab />);
    expect(screen.getByTestId('create-chg-tab')).toBeInTheDocument();
  });

  it('still opens when browser storage is unavailable', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ChgTab />);
    expect(screen.getByTestId('guided-change-flow')).toBeInTheDocument();
    getItemSpy.mockRestore();
  });
});

describe('ChgTab — classic screens', () => {
  it('labels the modes with explicit new/existing wording so Modify is discoverable', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);
    await openClassicScreens(user);
    expect(screen.getByRole('button', { name: 'Create New CHG' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modify Existing CHG' })).toBeInTheDocument();
    expect(screen.queryByTestId('guided-change-flow')).not.toBeInTheDocument();
  });

  it('displays the Create tab first', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);
    await openClassicScreens(user);
    expect(screen.getByTestId('create-chg-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('modify-chg-tab')).not.toBeInTheDocument();
  });

  it('switches between Create and Modify and marks the active one', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);
    await openClassicScreens(user);
    const createButton = screen.getByRole('button', { name: 'Create New CHG' });
    const modifyButton = screen.getByRole('button', { name: 'Modify Existing CHG' });
    expect(createButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(modifyButton);
    expect(screen.getByTestId('modify-chg-tab')).toBeInTheDocument();
    expect(modifyButton).toHaveAttribute('aria-pressed', 'true');
    expect(createButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(createButton);
    expect(screen.getByTestId('create-chg-tab')).toBeInTheDocument();
  });

  it('goes back to the guided flow', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);
    await openClassicScreens(user);
    await user.click(screen.getByRole('button', { name: /Guided/i }));
    expect(screen.getByTestId('guided-change-flow')).toBeInTheDocument();
    expect(localStorage.getItem(CHG_GENERATOR_VIEW_STORAGE_KEY)).toBe('guided');
  });
});
