/**
 * Register page component
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { authApi } from '../api';
import './AuthPages.css';

export const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Email verification state
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await authApi.register(username, email, password);
      
      // Check if email verification is required (production mode)
      if (response.requires_verification) {
        setPendingEmail(response.email || email);
        setAwaitingVerification(true);
        setSuccess(`Verification code sent to ${response.email || email}`);
      } else {
        // Dev mode: user created immediately, log in
        const loginResponse = await authApi.login(username, password);
        login(loginResponse.access_token, response);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (verificationCode.length !== 6) {
      setError('Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);

    try {
      const response = await authApi.verifyEmail(pendingEmail, verificationCode);
      
      if (response.success && response.access_token) {
        // Use user info from response if available, otherwise construct from local state
        const userInfo = response.user || {
          id: response.user_id,
          username: username,
          email: pendingEmail,
          created_at: new Date().toISOString(),
          is_admin: false
        };
        login(response.access_token, userInfo);
        navigate('/dashboard');
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setLoading(true);

    try {
      await authApi.resendVerification(pendingEmail);
      setSuccess('Verification code resent to your email');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  // Verification code entry screen
  if (awaitingVerification) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>🃏 Poker Platform</h1>
          <h2>Verify Your Email</h2>
          
          <p className="verification-info">
            We've sent a 6-digit code to <strong>{pendingEmail}</strong>
          </p>
          
          <form onSubmit={handleVerify}>
            <div className="form-group">
              <label htmlFor="verificationCode">Verification Code</label>
              <input
                id="verificationCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                disabled={loading}
                placeholder="Enter 6-digit code"
                maxLength={6}
                className="verification-input"
                autoFocus
              />
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <button type="submit" disabled={loading || verificationCode.length !== 6} className="btn-primary">
              {loading ? 'Verifying...' : 'Verify & Create Account'}
            </button>
          </form>

          <div className="verification-actions">
            <button 
              type="button" 
              onClick={handleResendCode} 
              disabled={loading}
              className="btn-link"
            >
              Resend Code
            </button>
            <button 
              type="button" 
              onClick={() => {
                setAwaitingVerification(false);
                setVerificationCode('');
                setError('');
                setSuccess('');
              }} 
              disabled={loading}
              className="btn-link"
            >
              Back to Registration
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>🃏 Poker Platform</h1>
        <h2>Register</h2>
        
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
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
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
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Creating account...' : 'Register'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Login here</Link>
        </p>
      </div>
    </div>
  );
};
