/**
 * Login page component
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { authApi } from '../api';
import './AuthPages.css';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Admin 2FA state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  
  const navigate = useNavigate();
  const { login } = useAuth();

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
        is_admin: false
      };
      
      login(response.access_token, user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Please try again.');
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
        is_admin: true
      };
      
      login(response.access_token, user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Admin 2FA verification screen
  if (showVerification) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>🃏 Poker Platform</h1>
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

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>🃏 Poker Platform</h1>
        <h2>Login</h2>
        
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

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="auth-link">
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </div>
    </div>
  );
};
