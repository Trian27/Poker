import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthContextType } from '../../auth-context';
import { RegisterPage } from '../RegisterPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const authContextValue: AuthContextType = {
  user: null,
  token: null,
  login: vi.fn(),
  logout: vi.fn(),
  setToken: vi.fn(),
  setUser: vi.fn(),
  isAuthenticated: false,
  isReady: true,
  refreshUser: vi.fn(async () => undefined),
};

const renderRegisterPage = () => {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthContext.Provider value={authContextValue}>
        <RegisterPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
};

describe('RegisterPage beta invite-only mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    navigateMock.mockReset();
    window.localStorage.clear();
    document.cookie = 'dormstacks_seen=1; path=/';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.cookie = 'dormstacks_seen=; Max-Age=0; path=/';
  });

  it('shows an invite-required state when beta invite-only mode is enabled', async () => {
    vi.stubEnv('VITE_INVITE_ONLY_REGISTRATION', 'true');

    renderRegisterPage();

    expect(screen.getByRole('heading', { name: /invite required/i })).toBeInTheDocument();
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument();
  });

  it('does not redirect fresh visitors away from the invite-required screen in beta mode', async () => {
    vi.stubEnv('VITE_INVITE_ONLY_REGISTRATION', 'true');
    document.cookie = 'dormstacks_seen=; Max-Age=0; path=/';

    renderRegisterPage();

    expect(screen.getByRole('heading', { name: /invite required/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('renders the normal registration form when beta invite-only mode is disabled', async () => {
    vi.stubEnv('VITE_INVITE_ONLY_REGISTRATION', 'false');

    renderRegisterPage();

    expect(screen.getByRole('heading', { name: /^register$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^register$/i })).toBeInTheDocument();
  });
});
