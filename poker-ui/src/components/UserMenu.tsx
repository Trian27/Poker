import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { profileApi } from '../api';
import './UserMenu.css';

interface UserMenuProps {
  username: string;
}

export default function UserMenu({ username }: UserMenuProps) {
  const { user, logout, setUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Profile edit state
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingChanges, setPendingChanges] = useState<{ username?: string; email?: string } | null>(null);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setVerificationCode('');
      setPendingChanges(null);
      setAwaitingVerification(false);
      setError(null);
      setSuccess(null);
    }
  }, [showProfileModal, user]);

  const handleRequestUpdate = async () => {
    setError(null);
    setSuccess(null);
    
    // Check if anything changed
    const usernameChanged = newUsername !== user?.username;
    const emailChanged = newEmail !== user?.email;
    
    if (!usernameChanged && !emailChanged) {
      setError('No changes detected');
      return;
    }

    setLoading(true);
    try {
      const response = await profileApi.requestUpdate(
        usernameChanged ? newUsername : undefined,
        emailChanged ? newEmail : undefined
      );
      
      setPendingChanges({
        username: usernameChanged ? newUsername : undefined,
        email: emailChanged ? newEmail : undefined,
      });
      setAwaitingVerification(true);
      setSuccess(`Verification code sent to ${response.verification_sent_to}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to request update');
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
      const response = await profileApi.verifyUpdate(
        verificationCode,
        pendingChanges?.username,
        pendingChanges?.email
      );
      
      // Update local user state
      if (response.user && setUser) {
        setUser(response.user);
        localStorage.setItem('user', JSON.stringify(response.user));
      }
      
      // Update token if email changed
      if (response.access_token) {
        localStorage.setItem('token', response.access_token);
      }
      
      setSuccess('Profile updated successfully!');
      setAwaitingVerification(false);
      setPendingChanges(null);
      setVerificationCode('');
      
      // Close modal after short delay
      setTimeout(() => {
        setShowProfileModal(false);
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid verification code');
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
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Profile</h2>
              <button className="close-button" onClick={() => setShowProfileModal(false)}>×</button>
            </div>
            
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            {!awaitingVerification ? (
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

                <p className="verification-note">
                  ℹ️ Changes require email verification for security
                </p>

                <div className="modal-actions">
                  <button 
                    type="button" 
                    onClick={() => setShowProfileModal(false)}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="primary"
                    disabled={loading || (newUsername === user?.username && newEmail === user?.email)}
                  >
                    {loading ? 'Sending...' : 'Send Verification Code'}
                  </button>
                </div>
              </form>
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

                <div className="modal-actions">
                  <button 
                    type="button" 
                    onClick={() => {
                      setAwaitingVerification(false);
                      setPendingChanges(null);
                      setVerificationCode('');
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
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="close-button" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            
            <div className="settings-placeholder">
              <p>🚧 Settings coming soon!</p>
              <p>This is where you'll be able to customize your experience.</p>
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowSettingsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
