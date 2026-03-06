/**
 * Login page component
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { authApi, tablesApi } from '../api';
import './AuthPages.css';
import { getApiErrorMessage, getApiErrorStatus } from '../utils/error';
import { clearAutoRejoinSuppression, isAutoRejoinSuppressed } from '../utils/activeSeatRejoin';
import { hasSeenDormstacks, markDormstacksSeen } from '../utils/visitorState';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [isReturningVisitor, setIsReturningVisitor] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRejoiningTable, setIsRejoiningTable] = useState(false);
  
  // Admin 2FA state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [recoveryCodeSent, setRecoveryCodeSent] = useState(false);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveredUsername, setRecoveredUsername] = useState('');
  
  const navigate = useNavigate();
  const { login, isAuthenticated, isReady } = useAuth();
  const hasAutoRedirectedRef = useRef(false);
  const brandHeading = (
    <h1 className="brand-title">
      <img src="/assets/brand-book-embossed.svg" alt="" className="brand-logo-icon" />
      <span>DormStacks</span>
    </h1>
  );

  useEffect(() => {
    setIsReturningVisitor(hasSeenDormstacks());
  }, []);

  const navigateAfterLogin = useCallback(async () => {
    if (isAutoRejoinSuppressed()) {
      clearAutoRejoinSuppression();
      navigate('/dashboard', { replace: true });
      return;
    }

    setIsRejoiningTable(true);
    try {
      const activeSeat = await tablesApi.getMyActiveSeat();
      if (activeSeat?.active && activeSeat.table_id) {
        const communityParam = activeSeat.community_id ? `?communityId=${activeSeat.community_id}` : '';
        navigate(`/game/${activeSeat.table_id}${communityParam}`, { replace: true });
        return;
      }
    } catch (err) {
      console.error('Failed to fetch active seat after login:', err);
    } finally {
      setIsRejoiningTable(false);
    }

    navigate('/dashboard', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || showVerification || showRecovery || hasAutoRedirectedRef.current) {
      return;
    }
    hasAutoRedirectedRef.current = true;
    void navigateAfterLogin();
  }, [isReady, isAuthenticated, showVerification, showRecovery, navigateAfterLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login(username, password);
      
      // Check if this is an admin requiring 2FA
      if (response.requires_2fa) {
        setAdminEmail(response.email);
        setShowVerification(true);
        setLoading(false);
        return;
      }
      
      // Normal login - use user info from response
      const user = response.user || {
        id: 0,
        username,
        email: '',
        created_at: new Date().toISOString(),
        is_admin: false,
        is_banned: false
      };
      
      login(response.access_token, user, { persist: staySignedIn });
      markDormstacksSeen();
      await navigateAfterLogin();
    } catch (err: unknown) {
      if (getApiErrorStatus(err) === 401) {
        const generic = 'Incorrect username or password.';
        setError(generic);
        window.alert(generic);
      } else {
        setError(getApiErrorMessage(err, 'Login failed. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.verifyAdminLogin(adminEmail, verificationCode);
      
      const user = response.user || {
        id: 0,
        username,
        email: adminEmail,
        created_at: new Date().toISOString(),
        is_admin: true,
        is_banned: false
      };
      
      login(response.access_token, user, { persist: staySignedIn });
      markDormstacksSeen();
      await navigateAfterLogin();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Verification failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecoveryMessage('');
    setLoading(true);
    try {
      const response = await authApi.requestAccountRecovery(recoveryEmail);
      setRecoveryCodeSent(true);
      setRecoveryMessage(response.message || 'If an account exists for that email, a verification code has been sent.');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to request account recovery.'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecoveryMessage('');

    if (recoveryCode.length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    if (recoveryNewPassword.length > 0 && recoveryNewPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (recoveryNewPassword.length > 0 && recoveryNewPassword !== recoveryConfirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.verifyAccountRecovery(
        recoveryEmail,
        recoveryCode,
        recoveryNewPassword || undefined
      );
      setRecoveredUsername(response.username || '');
      setRecoveryMessage(response.message || 'Account recovery verified.');
      setRecoveryComplete(true);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Recovery verification failed.'));
    } finally {
      setLoading(false);
    }
  };

  // Admin 2FA verification screen
  if (showVerification) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          {brandHeading}
          <h2>Admin Verification</h2>
          <p className="verification-info">
            A verification code has been sent to your email.
            Please enter it below to complete login.
          </p>
          
          <form onSubmit={handleVerifyAdmin}>
            <div className="form-group">
              <label htmlFor="verificationCode">Verification Code</label>
              <input
                id="verificationCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter 6-digit code"
                maxLength={6}
                pattern="[0-9]{6}"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" disabled={loading || verificationCode.length !== 6} className="btn-primary">
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>
          </form>

          <p className="auth-link">
            <button 
              type="button" 
              className="link-button"
              onClick={() => {
                setShowVerification(false);
                setVerificationCode('');
                setError('');
              }}
            >
              ← Back to Login
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (showRecovery) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          {brandHeading}
          <h2>Recover Account</h2>

          {recoveryMessage && <div className="success-message">{recoveryMessage}</div>}
          {error && <div className="error-message">{error}</div>}

          {!recoveryCodeSent && !recoveryComplete && (
            <form onSubmit={handleRequestRecovery}>
              <div className="form-group">
                <label htmlFor="recoveryEmail">Account Email</label>
                <input
                  id="recoveryEmail"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Sending Code...' : 'Send Verification Code'}
              </button>
            </form>
          )}

          {recoveryCodeSent && !recoveryComplete && (
            <form onSubmit={handleVerifyRecovery}>
              <div className="form-group">
                <label htmlFor="recoveryCode">Verification Code</label>
                <input
                  id="recoveryCode"
                  type="text"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                />
              </div>

              <div className="form-group">
                <label htmlFor="recoveryNewPassword">New Password (Optional)</label>
                <input
                  id="recoveryNewPassword"
                  type="password"
                  value={recoveryNewPassword}
                  onChange={(e) => setRecoveryNewPassword(e.target.value)}
                  disabled={loading}
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Leave blank to recover username only"
                />
              </div>

              <div className="form-group">
                <label htmlFor="recoveryConfirmPassword">Confirm New Password</label>
                <input
                  id="recoveryConfirmPassword"
                  type="password"
                  value={recoveryConfirmPassword}
                  onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                  disabled={loading || !recoveryNewPassword}
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" disabled={loading || recoveryCode.length !== 6} className="btn-primary">
                {loading ? 'Verifying...' : 'Verify Recovery'}
              </button>
            </form>
          )}

          {recoveryComplete && (
            <div>
              {recoveredUsername && (
                <p className="verification-info">
                  Your username is: <strong>{recoveredUsername}</strong>
                </p>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (recoveredUsername) {
                    setUsername(recoveredUsername);
                  }
                  setShowRecovery(false);
                  setRecoveryCodeSent(false);
                  setRecoveryComplete(false);
                  setRecoveryCode('');
                  setRecoveryNewPassword('');
                  setRecoveryConfirmPassword('');
                  setError('');
                  setRecoveryMessage('');
                }}
              >
                Back to Login
              </button>
            </div>
          )}

          <p className="auth-link">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setShowRecovery(false);
                setRecoveryCodeSent(false);
                setRecoveryComplete(false);
                setRecoveryCode('');
                setRecoveryNewPassword('');
                setRecoveryConfirmPassword('');
                setRecoveryMessage('');
                setError('');
              }}
            >
              ← Back to Login
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {brandHeading}
        <h2>Login</h2>
        {isReturningVisitor && <p className="verification-info">Welcome back.</p>}

        {isRejoiningTable && (
          <div className="rejoin-banner auth-rejoin-banner">
            Rejoining your active table...
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <label className="checkbox-row" htmlFor="staySignedIn">
            <input
              id="staySignedIn"
              type="checkbox"
              checked={staySignedIn}
              onChange={(e) => setStaySignedIn(e.target.checked)}
              disabled={loading}
            />
            Stay signed in
          </label>
          <p className="auth-helper-text">Global admin accounts always require re-login.</p>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="auth-link">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setShowRecovery(true);
              setError('');
              setRecoveryEmail('');
              setRecoveryCode('');
              setRecoveryNewPassword('');
              setRecoveryConfirmPassword('');
              setRecoveryCodeSent(false);
              setRecoveryComplete(false);
              setRecoveryMessage('');
              setRecoveredUsername('');
            }}
          >
            Forgot username or password?
          </button>
        </p>

        <p className="auth-link">
          Don&apos;t have an account? <Link to="/register">Register here</Link>
        </p>
      </div>
    </div>
  );
};
