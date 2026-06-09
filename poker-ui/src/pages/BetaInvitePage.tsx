/**
 * Beta invite acceptance page component.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { authApi } from '../api';
import './AuthPages.css';
import { getApiErrorMessage } from '../utils/error';
import { consumePostSignupTutorialPending, markDormstacksSeen } from '../utils/visitorState';

type InviteLookup = {
  email: string;
  expires_at: string;
};

export const BetaInvitePage: React.FC = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const brandHeading = (
    <h1 className="brand-title">
      <img src="/assets/brand-book-embossed.svg" alt="" className="brand-logo-icon" />
      <span>DormStacks</span>
    </h1>
  );

  useEffect(() => {
    let isCancelled = false;

    const loadInvite = async () => {
      if (!token) {
        setError('Missing beta invite token');
        setLoadingInvite(false);
        return;
      }

      try {
        const response = await authApi.lookupBetaInvite(token);
        if (isCancelled) {
          return;
        }
        setInvite(response);
      } catch (err: unknown) {
        if (isCancelled) {
          return;
        }
        setError(getApiErrorMessage(err, 'Unable to load this beta invite.'));
      } finally {
        if (!isCancelled) {
          setLoadingInvite(false);
        }
      }
    };

    void loadInvite();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!invite) {
      setError('This beta invite is no longer available.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);

    try {
      const response = await authApi.acceptBetaInvite(token, username, password);
      login(response.access_token, response.user);
      markDormstacksSeen();
      const shouldShowTutorial = consumePostSignupTutorialPending();
      navigate(shouldShowTutorial ? '/tutorial' : '/dashboard', { replace: true });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Unable to accept this beta invite.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInvite) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          {brandHeading}
          <h2>Beta Invite</h2>
          <p className="verification-info">Loading your beta invite...</p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          {brandHeading}
          <h2>Beta Invite</h2>
          {error && <div className="error-message">{error}</div>}
          <p className="auth-link">
            Already have an account? <Link to="/login">Login here</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {brandHeading}
        <h2>Accept Your Beta Invite</h2>

        <p className="verification-info">
          Create your account for:
        </p>
        <p className="auth-static-value">{invite.email}</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={submitting}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting}
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              disabled={submitting}
              autoComplete="new-password"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Login here</Link>
        </p>
      </div>
    </div>
  );
};
