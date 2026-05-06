// AdminHubView.test.tsx — Unit tests for the Admin Hub view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    proxyUrls: {
      jiraProxyUrl: 'http://jira.example.com',
      snowProxyUrl: '',
      githubProxyUrl: '',
    },
    artSettings: {
      piFieldId: 'customfield_10301',
      sprintPointsFieldId: '',
      featureLinkField: '',
      piName: 'PI 26.2',
      piStartDate: '',
      piEndDate: '',
    },
    featureFlags: {
      isSnowIntegrationEnabled: false,
      isAiEnabled: false,
    },
    isAdminUnlocked: false,
    adminPinInput: '',
    proxySaveStatus: null as string | null,
    artSaveStatus: null as string | null,
  },
  mockActions: {
    setProxyUrl: vi.fn(),
    saveProxyUrls: vi.fn(),
    setArtField: vi.fn(),
    saveArtSettings: vi.fn(),
    toggleFeatureFlag: vi.fn(),
    setAdminPinInput: vi.fn(),
    tryUnlock: vi.fn(),
    lock: vi.fn(),
  },
}));

vi.mock('./hooks/useAdminHubState.ts', () => ({
  useAdminHubState: () => ({ state: mockState, actions: mockActions }),
}));

const { mockProxyStatus } = vi.hoisted(() => ({ mockProxyStatus: null as null | object }));

vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: (
    selector: (storeState: { proxyStatus: typeof mockProxyStatus }) => unknown,
  ) => selector({ proxyStatus: mockProxyStatus }),
}));

import AdminHubView from './AdminHubView.tsx';

describe('AdminHubView', () => {
  beforeEach(() => {
    mockState.isAdminUnlocked = false;
    mockState.adminPinInput = '';
    vi.clearAllMocks();
  });

  it('renders the Proxy & Server Setup section', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/proxy & server setup/i)).toBeInTheDocument();
  });

  it('renders the ART Settings section', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/art settings/i)).toBeInTheDocument();
  });

  it('renders the Admin Access section with PIN input when locked', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/admin access/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter pin/i)).toBeInTheDocument();
  });

  it('shows the unlocked admin panel when isAdminUnlocked is true', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/admin access is active/i)).toBeInTheDocument();
  });

  it('shows the Advanced Feature Controls toggles when unlocked', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/advanced feature controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/snow integration/i)).toBeInTheDocument();
  });

  it('shows the Developer Utilities when unlocked', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/developer utilities/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset onboarding/i })).toBeInTheDocument();
  });
});
