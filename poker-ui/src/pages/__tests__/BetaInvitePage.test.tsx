import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

const {
  lookupBetaInviteMock,
  acceptBetaInviteMock,
} = vi.hoisted(() => ({
  lookupBetaInviteMock: vi.fn(),
  acceptBetaInviteMock: vi.fn(),
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      lookupBetaInvite: lookupBetaInviteMock,
      acceptBetaInvite: acceptBetaInviteMock,
    },
  };
});

vi.mock('../../ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../LoginPage', () => ({
  LoginPage: () => <div>Login Page</div>,
}));

vi.mock('../RegisterPage', () => ({
  RegisterPage: () => <div>Register Page</div>,
}));

vi.mock('../WelcomeGatePage', () => ({
  WelcomeGatePage: () => <div>Welcome Gate</div>,
}));

vi.mock('../WelcomeChipGatePage', () => ({
  WelcomeChipGatePage: () => <div>Welcome Chip Gate</div>,
}));

vi.mock('../WelcomeChipFlipGatePage', () => ({
  WelcomeChipFlipGatePage: () => <div>Welcome Chip Flip Gate</div>,
}));

vi.mock('../WelcomeDealRevealPage', () => ({
  WelcomeDealRevealPage: () => <div>Welcome Deal Reveal</div>,
}));

vi.mock('../DashboardPage', () => ({
  DashboardPage: () => <div>Dashboard Page</div>,
}));

vi.mock('../CommunityLobbyPage', () => ({
  default: () => <div>Community Lobby Page</div>,
}));

vi.mock('../GameTablePage', () => ({
  GameTablePage: () => <div>Game Table Page</div>,
}));

vi.mock('../MarketplacePage', () => ({
  MarketplacePage: () => <div>Marketplace Page</div>,
}));

vi.mock('../SkinsPage', () => ({
  SkinsPage: () => <div>Skins Page</div>,
}));

vi.mock('../MessagesPage', () => ({
  MessagesPage: () => <div>Messages Page</div>,
}));

vi.mock('../TournamentsPage', () => ({
  TournamentsPage: () => <div>Tournaments Page</div>,
}));

vi.mock('../FeedbackPage', () => ({
  FeedbackPage: () => <div>Feedback Page</div>,
}));

vi.mock('../LearningPage', () => ({
  LearningPage: () => <div>Learning Page</div>,
}));

vi.mock('../TutorialPage', () => ({
  TutorialPage: () => <div>Tutorial Page</div>,
}));

vi.mock('../../components/RulesScrollHelp', () => ({
  default: () => null,
}));

describe('Beta invite acceptance route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.cookie = 'dormstacks_seen=1; path=/';
    lookupBetaInviteMock.mockResolvedValue({
      email: 'beta@example.com',
      expires_at: '2026-06-15T02:16:51.025696Z',
    });
    acceptBetaInviteMock.mockResolvedValue({
      success: true,
      message: 'Account created from beta invite',
      access_token: 'beta-token',
      token_type: 'bearer',
      user: {
        id: 22,
        username: 'newbetauser',
        email: 'beta@example.com',
        created_at: '2026-06-08T02:16:51.025696Z',
        is_admin: false,
        is_banned: false,
        is_test_user: false,
      },
    });
  });

  it('renders the dedicated beta invite page for /invite/:token links', async () => {
    window.history.pushState({}, '', '/invite/test-token');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /beta invite/i })).toBeInTheDocument();
    });

    expect(lookupBetaInviteMock).toHaveBeenCalledWith('test-token');
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('accepts a valid beta invite and routes the new user into the app', async () => {
    window.history.pushState({}, '', '/invite/test-token');
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('beta@example.com')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'newbetauser');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(acceptBetaInviteMock).toHaveBeenCalledWith('test-token', 'newbetauser', 'password123');
    });

    await waitFor(() => {
      expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    });
  });

  it('shows an invite-specific error when lookup fails', async () => {
    lookupBetaInviteMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 410',
      response: {
        data: {
          detail: 'Beta invite has expired',
        },
      },
    });
    window.history.pushState({}, '', '/invite/bad-token');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/beta invite has expired/i)).toBeInTheDocument();
    });
  });
});
