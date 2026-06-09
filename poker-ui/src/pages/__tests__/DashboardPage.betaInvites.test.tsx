import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import type { BetaInviteAdmin } from '../../types';
import { DashboardPage } from '../DashboardPage';

const {
  resetInviteRows,
  getCommunitiesMock,
  getWalletsMock,
  getLeaguesMock,
  getUnreadCountMock,
  getMessagesMock,
  getMyActiveSeatMock,
  listBetaInvitesMock,
  createBetaInviteMock,
  resendBetaInviteMock,
  revokeBetaInviteMock,
} = vi.hoisted(() => ({
  resetInviteRows: vi.fn(),
  getCommunitiesMock: vi.fn(async () => []),
  getWalletsMock: vi.fn(async () => []),
  getLeaguesMock: vi.fn(async () => []),
  getUnreadCountMock: vi.fn(async () => ({ unread_count: 0 })),
  getMessagesMock: vi.fn(async () => []),
  getMyActiveSeatMock: vi.fn(async () => ({ active: false })),
  listBetaInvitesMock: vi.fn(),
  createBetaInviteMock: vi.fn(),
  resendBetaInviteMock: vi.fn(),
  revokeBetaInviteMock: vi.fn(),
}));

const INITIAL_INVITES: BetaInviteAdmin[] = [
  {
    id: 42,
    email: 'pending@example.com',
    notes: 'priority tester',
    created_by_user_id: 7,
    redeemed_by_user_id: null,
    created_at: '2026-06-01T12:00:00Z',
    expires_at: '2026-06-08T12:00:00Z',
    sent_at: '2026-06-01T12:05:00Z',
    used_at: null,
    revoked_at: null,
    status: 'pending',
    invite_url: null,
    delivery_status: 'sent',
  },
  {
    id: 43,
    email: 'redeemed@example.com',
    notes: null,
    created_by_user_id: 7,
    redeemed_by_user_id: 19,
    created_at: '2026-05-20T12:00:00Z',
    expires_at: '2026-05-27T12:00:00Z',
    sent_at: '2026-05-20T12:00:00Z',
    used_at: '2026-05-21T15:00:00Z',
    revoked_at: null,
    status: 'redeemed',
    invite_url: null,
    delivery_status: 'sent',
  },
];

let inviteRows: BetaInviteAdmin[] = INITIAL_INVITES.map((invite) => ({ ...invite }));

resetInviteRows.mockImplementation(() => {
  inviteRows = INITIAL_INVITES.map((invite) => ({ ...invite }));
});

listBetaInvitesMock.mockImplementation(async () => ({
  items: inviteRows.map((invite) => ({ ...invite, invite_url: null })),
}));

createBetaInviteMock.mockImplementation(async (email: string, notes?: string) => {
  const createdInvite: BetaInviteAdmin = {
    id: 99,
    email,
    notes: notes || null,
    created_by_user_id: 7,
    redeemed_by_user_id: null,
    created_at: '2026-06-07T12:00:00Z',
    expires_at: '2026-06-14T12:00:00Z',
    sent_at: null,
    used_at: null,
    revoked_at: null,
    status: 'pending',
    invite_url: 'https://beta.example.com/invite/manual-token',
    delivery_status: 'manual_required',
  };
  inviteRows = [createdInvite, ...inviteRows];
  return createdInvite;
});

resendBetaInviteMock.mockImplementation(async (inviteId: number) => {
  const updatedInvite: BetaInviteAdmin = {
    ...inviteRows.find((invite) => invite.id === inviteId)!,
    expires_at: '2026-06-14T12:00:00Z',
    sent_at: null,
    invite_url: 'https://beta.example.com/invite/reissued-token',
    delivery_status: 'manual_required',
  };
  inviteRows = inviteRows.map((invite) => invite.id === inviteId ? updatedInvite : invite);
  return updatedInvite;
});

revokeBetaInviteMock.mockImplementation(async (inviteId: number) => {
  const updatedInvite: BetaInviteAdmin = {
    ...inviteRows.find((invite) => invite.id === inviteId)!,
    revoked_at: '2026-06-07T14:00:00Z',
    status: 'revoked',
    invite_url: null,
    delivery_status: 'sent',
  };
  inviteRows = inviteRows.map((invite) => invite.id === inviteId ? updatedInvite : invite);
  return updatedInvite;
});

vi.mock('../../api', () => ({
  communitiesApi: {
    getAll: getCommunitiesMock,
  },
  walletsApi: {
    getAll: getWalletsMock,
  },
  leaguesApi: {
    getAll: getLeaguesMock,
  },
  inboxApi: {
    getUnreadCount: getUnreadCountMock,
    getMessages: getMessagesMock,
  },
  tablesApi: {
    getMyActiveSeat: getMyActiveSeatMock,
  },
  betaInvitesApi: {
    list: listBetaInvitesMock,
    create: createBetaInviteMock,
    resend: resendBetaInviteMock,
    revoke: revokeBetaInviteMock,
  },
}));

const adminAuthValue: AuthContextType = {
  user: {
    id: 7,
    username: 'global-admin',
    email: 'admin@example.com',
    created_at: '2026-01-01T00:00:00Z',
    is_admin: true,
  },
  token: 'test-token',
  login: vi.fn(),
  logout: vi.fn(),
  setToken: vi.fn(),
  setUser: vi.fn(),
  isAuthenticated: true,
  isReady: true,
  refreshUser: vi.fn(async () => undefined),
};

const memberAuthValue: AuthContextType = {
  ...adminAuthValue,
  user: {
    id: 8,
    username: 'member-user',
    email: 'member@example.com',
    created_at: '2026-01-01T00:00:00Z',
    is_admin: false,
  },
};

const renderDashboard = (authValue: AuthContextType) => render(
  <StrictMode>
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  </StrictMode>
);

describe('DashboardPage beta invite admin panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInviteRows();
    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation(() => []);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('shows beta invite management for global admins and loads invite details', async () => {
    renderDashboard(adminAuthValue);

    expect(await screen.findByRole('heading', { name: /beta invites/i })).toBeInTheDocument();

    const pendingRow = await screen.findByTestId('beta-invite-row-42');
    expect(listBetaInvitesMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(within(pendingRow).getByText('pending@example.com')).toBeInTheDocument();
    expect(within(pendingRow).getByText(/priority tester/i)).toBeInTheDocument();
    expect(within(pendingRow).getByText(/^Pending$/, { selector: '.beta-invite-status' })).toBeInTheDocument();
    expect(within(pendingRow).getByText(/^Created$/, { selector: 'dt' })).toBeInTheDocument();
    expect(within(pendingRow).getByText(/^Sent$/, { selector: 'dt' })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: /resend/i })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: /revoke/i })).toBeInTheDocument();

    const redeemedRow = screen.getByTestId('beta-invite-row-43');
    expect(within(redeemedRow).getByText(/^Redeemed$/, { selector: '.beta-invite-status' })).toBeInTheDocument();
    expect(within(redeemedRow).queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
    expect(within(redeemedRow).queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
  });

  it('creates beta invites and surfaces manual-link fallback when delivery needs intervention', async () => {
    renderDashboard(adminAuthValue);

    await screen.findByRole('heading', { name: /beta invites/i });

    fireEvent.change(screen.getByLabelText(/invite email/i), {
      target: { value: 'manual@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'manual send needed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(createBetaInviteMock).toHaveBeenCalledWith('manual@example.com', 'manual send needed');
    });

    expect(await screen.findByText(/manual delivery required for manual@example.com/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://beta.example.com/invite/manual-token')).toBeInTheDocument();
  });

  it('resends and revokes pending invites from the admin panel', async () => {
    renderDashboard(adminAuthValue);

    const pendingRow = await screen.findByTestId('beta-invite-row-42');

    fireEvent.click(within(pendingRow).getByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(resendBetaInviteMock).toHaveBeenCalledWith(42);
    });
    expect(await screen.findByDisplayValue('https://beta.example.com/invite/reissued-token')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /revoke pending@example.com/i }));
    await waitFor(() => {
      expect(revokeBetaInviteMock).toHaveBeenCalledWith(42);
    });

    const revokedRow = await screen.findByTestId('beta-invite-row-42');
    expect(within(revokedRow).getByText(/^Revoked$/, { selector: '.beta-invite-status' })).toBeInTheDocument();
  });

  it('keeps beta invite controls hidden for non-admin users', async () => {
    renderDashboard(memberAuthValue);

    await screen.findByText(/no leagues available/i);

    expect(screen.queryByRole('heading', { name: /beta invites/i })).not.toBeInTheDocument();
    expect(listBetaInvitesMock).not.toHaveBeenCalled();
  });
});
