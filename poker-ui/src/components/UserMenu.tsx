import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth-context';
import { authApi, profileApi } from '../api';
import './UserMenu.css';
import { getApiErrorMessage } from '../utils/error';

interface UserMenuProps {
  username: string;
}

export default function UserMenu({ username }: UserMenuProps) {
  const { user, logout, setUser, setToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Profile edit state
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingChanges, setPendingChanges] = useState<{ username?: string; email?: string; password?: boolean } | null>(null);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [profileMode, setProfileMode] = useState<'details' | 'edit'>('details');
  const [recoveryEmail, setRecoveryEmail] = useState(user?.email || '');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (showProfileModal && user) {
      setNewUsername(user.username);
      setNewEmail(user.email);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setVerificationCode('');
      setPendingChanges(null);
      setAwaitingVerification(false);
      setProfileMode('details');
      setError(null);
      setSuccess(null);
      setShowRecoveryPanel(false);
      setRecoveryEmail(user.email);
      setRecoveryCode('');
      setRecoveryNewPassword('');
      setRecoveryRequested(false);
      setRecoveryLoading(false);
      setRecoveryError(null);
      setRecoverySuccess(null);
    }
  }, [showProfileModal, user]);

  const handleRequestRecovery = async () => {
    if (!recoveryEmail) {
      setRecoveryError('Email is required');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const response = await authApi.requestAccountRecovery(recoveryEmail);
      setRecoveryRequested(true);
      setRecoverySuccess(response.message || 'Recovery code sent. Check your email.');
    } catch (err: unknown) {
      setRecoveryError(getApiErrorMessage(err, 'Failed to send recovery email'));
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleVerifyRecovery = async () => {
    if (!recoveryCode || recoveryCode.length !== 6) {
      setRecoveryError('Please enter the 6-digit recovery code');
      return;
    }
    if (!recoveryNewPassword || recoveryNewPassword.length < 8) {
      setRecoveryError('New password must be at least 8 characters');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const response = await authApi.verifyAccountRecovery(
        recoveryEmail,
        recoveryCode,
        recoveryNewPassword
      );
      setCurrentPassword(recoveryNewPassword);
      setRecoverySuccess(response.message || 'Password reset complete. You can continue profile updates now.');
      setShowRecoveryPanel(false);
      setRecoveryRequested(false);
      setRecoveryCode('');
      setRecoveryNewPassword('');
    } catch (err: unknown) {
      setRecoveryError(getApiErrorMessage(err, 'Failed to verify recovery code'));
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleRequestUpdate = async () => {
    setError(null);
    setSuccess(null);
    
    // Check if anything changed
    const usernameChanged = newUsername !== user?.username;
    const emailChanged = newEmail !== user?.email;
    const passwordChanged = newPassword.length > 0;
    
    if (!usernameChanged && !emailChanged && !passwordChanged) {
      setError('No changes detected');
      return;
    }

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (passwordChanged && newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (passwordChanged && newPassword !== confirmNewPassword) {
      setError('New password and confirmation do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await profileApi.requestUpdate(
        currentPassword,
        usernameChanged ? newUsername : undefined,
        emailChanged ? newEmail : undefined,
        passwordChanged ? newPassword : undefined,
      );
      
      setPendingChanges({
        username: usernameChanged ? newUsername : undefined,
        email: emailChanged ? newEmail : undefined,
        password: passwordChanged,
      });
      setAwaitingVerification(true);
      setProfileMode('edit');
      setSuccess(`Verification code sent to ${response.verification_sent_to}`);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to request update'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyUpdate = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await profileApi.verifyUpdate(verificationCode);
      
      // Update local user state
      if (response.user && setUser) {
        setUser(response.user);
      }
      
      // Update token if email changed
      if (response.access_token) {
        setToken(response.access_token);
      }
      
      setSuccess('Profile updated successfully!');
      setAwaitingVerification(false);
      setPendingChanges(null);
      setVerificationCode('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      
      // Close modal after short delay
      setTimeout(() => {
        setShowProfileModal(false);
      }, 1500);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Invalid verification code'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button 
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="user-avatar">👤</span>
        <span className="user-name">{username}</span>
        <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <button 
            className="menu-item"
            onClick={() => {
              setShowSettingsModal(true);
              setIsOpen(false);
            }}
          >
            ⚙️ Settings
          </button>
          <button 
            className="menu-item"
            onClick={() => {
              setShowProfileModal(true);
              setIsOpen(false);
            }}
          >
            👤 Profile
          </button>
          <div className="menu-divider" />
          <button 
            className="menu-item logout"
            onClick={handleLogout}
          >
            🚪 Logout
          </button>
        </div>
      )}

      {/* Profile Modal */}
      {showProfileModal && (
        <div className="user-menu-modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="user-menu-modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="user-menu-modal-header">
              <h2>{awaitingVerification ? 'Verify Profile Changes' : (profileMode === 'details' ? 'Profile Details' : 'Edit Profile')}</h2>
              <button className="close-button" onClick={() => setShowProfileModal(false)}>×</button>
            </div>
            
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            {!awaitingVerification ? (
              profileMode === 'details' ? (
                <div className="profile-details">
                  <div className="profile-detail-row">
                    <span className="profile-detail-label">Username</span>
                    <span className="profile-detail-value">{user?.username || '-'}</span>
                  </div>
                  <div className="profile-detail-row">
                    <span className="profile-detail-label">Email</span>
                    <span className="profile-detail-value">{user?.email || '-'}</span>
                  </div>
                  <div className="profile-detail-row">
                    <span className="profile-detail-label">Account Created</span>
                    <span className="profile-detail-value">
                      {user?.created_at ? new Date(user.created_at).toLocaleString() : 'Unknown'}
                    </span>
                  </div>
                  <div className="profile-detail-row">
                    <span className="profile-detail-label">Role</span>
                    <span className="profile-detail-value">{user?.is_admin ? 'Global Admin' : 'Player'}</span>
                  </div>
                  <div className="user-menu-modal-actions">
                    <button type="button" onClick={() => setShowProfileModal(false)}>Close</button>
                    <button type="button" className="primary" onClick={() => setProfileMode('edit')}>
                      Edit Details
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); handleRequestUpdate(); }}>
                  <div className="form-group">
                    <label>Username</label>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Enter new username"
                      minLength={3}
                      maxLength={50}
                      required
                    />
                    {newUsername !== user?.username && (
                      <span className="field-hint">Will be changed</span>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Enter new email"
                      required
                    />
                    {newEmail !== user?.email && (
                      <span className="field-hint">Will be changed</span>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="inline-link-button"
                      onClick={() => {
                        setShowRecoveryPanel((previous) => !previous);
                        setRecoveryError(null);
                        setRecoverySuccess(null);
                      }}
                    >
                      Forgot current password? Reset via email
                    </button>
                  </div>

                  {showRecoveryPanel && (
                    <div className="recovery-panel">
                      <h4>Password Recovery</h4>
                      {recoveryError && <div className="alert alert-error">{recoveryError}</div>}
                      {recoverySuccess && <div className="alert alert-success">{recoverySuccess}</div>}

                      <div className="form-group">
                        <label>Recovery Email</label>
                        <input
                          type="email"
                          value={recoveryEmail}
                          onChange={(e) => setRecoveryEmail(e.target.value)}
                          placeholder="Enter account email"
                          required
                        />
                      </div>

                      {!recoveryRequested ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={handleRequestRecovery}
                          disabled={recoveryLoading || !recoveryEmail}
                        >
                          {recoveryLoading ? 'Sending...' : 'Send Recovery Code'}
                        </button>
                      ) : (
                        <>
                          <div className="form-group">
                            <label>Recovery Code</label>
                            <input
                              type="text"
                              value={recoveryCode}
                              onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder="Enter 6-digit code"
                              maxLength={6}
                              pattern="\d{6}"
                              required
                            />
                          </div>
                          <div className="form-group">
                            <label>New Password</label>
                            <input
                              type="password"
                              value={recoveryNewPassword}
                              onChange={(e) => setRecoveryNewPassword(e.target.value)}
                              placeholder="Enter new password"
                              minLength={8}
                              required
                            />
                          </div>
                          <div className="recovery-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setRecoveryRequested(false);
                                setRecoveryCode('');
                                setRecoveryNewPassword('');
                                setRecoveryError(null);
                                setRecoverySuccess(null);
                              }}
                              disabled={recoveryLoading}
                            >
                              Back
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleVerifyRecovery}
                              disabled={recoveryLoading || recoveryCode.length !== 6 || recoveryNewPassword.length < 8}
                            >
                              {recoveryLoading ? 'Verifying...' : 'Verify & Reset Password'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="form-group">
                    <label>New Password (Optional)</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Leave blank to keep current password"
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </div>

                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      minLength={8}
                      autoComplete="new-password"
                      disabled={!newPassword}
                    />
                  </div>

                  <p className="verification-note">
                    Profile changes require your current password and email verification.
                  </p>

                  <div className="user-menu-modal-actions">
                    <button
                      type="button"
                      onClick={() => setProfileMode('details')}
                      disabled={loading}
                    >
                      Back to Details
                    </button>
                    <button
                      type="submit"
                      className="primary"
                      disabled={
                        loading
                        || !currentPassword
                        || (newUsername === user?.username && newEmail === user?.email && newPassword.length === 0)
                        || (newPassword.length > 0 && (newPassword.length < 8 || newPassword !== confirmNewPassword))
                      }
                    >
                      {loading ? 'Sending...' : 'Send Verification Code'}
                    </button>
                  </div>
                </form>
              )
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); handleVerifyUpdate(); }}>
                <div className="pending-changes">
                  <h4>Pending Changes:</h4>
                  {pendingChanges?.username && (
                    <p>Username: <strong>{user?.username}</strong> → <strong>{pendingChanges.username}</strong></p>
                  )}
                  {pendingChanges?.email && (
                    <p>Email: <strong>{user?.email}</strong> → <strong>{pendingChanges.email}</strong></p>
                  )}
                  {pendingChanges?.password && (
                    <p>Password: <strong>Will be updated after verification</strong></p>
                  )}
                </div>

                <div className="form-group">
                  <label>Verification Code</label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    pattern="\d{6}"
                    required
                    autoFocus
                    className="verification-input"
                  />
                </div>

                <div className="user-menu-modal-actions">
                  <button 
                    type="button" 
                    onClick={() => {
                      setAwaitingVerification(false);
                      setPendingChanges(null);
                      setVerificationCode('');
                      setProfileMode('edit');
                    }}
                    disabled={loading}
                  >
                    Back
                  </button>
                  <button 
                    type="submit" 
                    className="primary"
                    disabled={loading || verificationCode.length !== 6}
                  >
                    {loading ? 'Verifying...' : 'Verify & Update'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="user-menu-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="user-menu-modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="user-menu-modal-header">
              <h2>Settings</h2>
              <button className="close-button" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            
            <div className="settings-placeholder">
              <p>🚧 Settings coming soon!</p>
              <p>This is where you&apos;ll be able to customize your experience.</p>
            </div>

            <div className="user-menu-modal-actions">
              <button onClick={() => setShowSettingsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
