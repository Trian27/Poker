import { useCallback, useEffect, useMemo, useState } from 'react';
import { communitiesApi } from '../api';
import type { AdminUser, Community, CommunityWalletSummary, User } from '../types';
import { getApiErrorMessage } from '../utils/error';
import './CommunitySettingsModal.css';

interface CommunitySettingsModalProps {
  isOpen: boolean;
  community: Community | null;
  user: User | null;
  onClose: () => void;
  onDeleted?: () => Promise<void> | void;
}

const idsEqual = (left?: number | null, right?: number | null): boolean =>
  Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right);

export default function CommunitySettingsModal({
  isOpen,
  community,
  user,
  onClose,
  onDeleted,
}: CommunitySettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [communityAdmins, setCommunityAdmins] = useState<AdminUser[]>([]);
  const [communityCommissioner, setCommunityCommissioner] = useState<AdminUser | null>(null);
  const [communityAdminInvite, setCommunityAdminInvite] = useState('');
  const [communityWallets, setCommunityWallets] = useState<CommunityWalletSummary[]>([]);
  const [walletAdjustAmountByUser, setWalletAdjustAmountByUser] = useState<Record<number, string>>({});
  const communityId = community?.id ?? null;
  const currentUserId = user?.id ?? null;
  const currentUserIsAdmin = Boolean(user?.is_admin);

  const commissionerId = communityCommissioner?.id ?? community?.commissioner_id;
  const canDeleteCommunity = !!(user && community && (user.is_admin || idsEqual(commissionerId, user.id)));
  const canInviteCommunityAdmins = !!(
    user
    && (idsEqual(commissionerId, user.id) || communityAdmins.some((admin) => idsEqual(admin.id, user.id)))
  );
  const canManageBalances = !!(user && community && (user.is_admin || idsEqual(commissionerId, user.id)));

  const loadSettings = useCallback(async () => {
    if (!communityId) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    setCommunityAdmins([]);
    setCommunityCommissioner(null);
    setCommunityWallets([]);
    setWalletAdjustAmountByUser({});

    try {
      const data = await communitiesApi.getAdmins(communityId);
      const commissioner = data.commissioner || null;
      const admins = data.admins || [];
      setCommunityCommissioner(commissioner);
      setCommunityAdmins(admins);

      const effectiveCommissionerId = commissioner?.id ?? community?.commissioner_id;
      const canLoadWallets = currentUserIsAdmin || idsEqual(effectiveCommissionerId, currentUserId);
      if (canLoadWallets) {
        const walletRows = await communitiesApi.getWallets(communityId);
        setCommunityWallets(walletRows || []);
      }
    } catch (err: unknown) {
      setLoadError(getApiErrorMessage(err, 'Failed to load community settings'));
    } finally {
      setLoading(false);
    }
  }, [communityId, community?.commissioner_id, currentUserId, currentUserIsAdmin]);

  useEffect(() => {
    if (!isOpen || !communityId) {
      return;
    }
    void loadSettings();
  }, [isOpen, communityId, loadSettings]);

  const updateWalletAdjustAmount = (targetUserId: number, value: string) => {
    setWalletAdjustAmountByUser((previous) => ({
      ...previous,
      [targetUserId]: value,
    }));
  };

  const applyWalletAdjustment = async (targetUserId: number, operation: 'set' | 'add' | 'subtract') => {
    if (!community || !canManageBalances) {
      return;
    }
    const rawAmount = walletAdjustAmountByUser[targetUserId] ?? '';
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      window.alert('Enter a valid non-negative amount.');
      return;
    }

    try {
      await communitiesApi.adjustWalletBalance(community.id, targetUserId, { operation, amount });
      const walletRows = await communitiesApi.getWallets(community.id);
      setCommunityWallets(walletRows || []);
      setWalletAdjustAmountByUser((previous) => ({
        ...previous,
        [targetUserId]: '',
      }));
      window.alert('Balance updated successfully.');
    } catch (err: unknown) {
      window.alert(getApiErrorMessage(err, 'Failed to update balance'));
    }
  };

  const inviteCommunityAdmin = async () => {
    if (!community) {
      return;
    }
    const trimmed = communityAdminInvite.trim();
    if (!trimmed) {
      window.alert('Enter a username or email');
      return;
    }
    try {
      const payload = trimmed.includes('@') ? { email: trimmed } : { username: trimmed };
      await communitiesApi.inviteAdmin(community.id, payload);
      setCommunityAdminInvite('');
      await loadSettings();
      window.alert('Community admin invited successfully');
    } catch (err: unknown) {
      window.alert(getApiErrorMessage(err, 'Failed to invite community admin'));
    }
  };

  const deleteCommunity = async () => {
    if (!community || !canDeleteCommunity) {
      return;
    }
    const confirmed = window.confirm(
      `Delete community "${community.name}"? This deletes its tables and wallets.`
    );
    if (!confirmed) {
      return;
    }
    try {
      await communitiesApi.delete(community.id);
      if (onDeleted) {
        await onDeleted();
      } else {
        onClose();
      }
    } catch (err: unknown) {
      window.alert(getApiErrorMessage(err, 'Failed to delete community'));
    }
  };

  const hasCommunity = useMemo(() => Boolean(isOpen && community), [isOpen, community]);
  if (!hasCommunity || !community) {
    return null;
  }

  return (
    <div className="community-settings-overlay" onClick={onClose}>
      <div className="community-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="community-settings-header">
          <h2>Community Settings</h2>
          <button type="button" className="close-button" onClick={onClose}>×</button>
        </div>
        <p className="community-settings-subtitle">{community.name}</p>

        {loading && <p className="community-settings-note">Loading settings...</p>}
        {loadError && <div className="community-settings-error">{loadError}</div>}

        <div className="community-settings-section">
          <h3>Admins</h3>
          {communityCommissioner ? (
            <div className="community-settings-row">
              <span className="community-settings-role">Commissioner</span>
              <span className="community-settings-user">
                {communityCommissioner.username} ({communityCommissioner.email})
              </span>
            </div>
          ) : (
            <p className="community-settings-empty">No commissioner assigned.</p>
          )}
          {communityAdmins.length > 0 ? (
            <div className="community-settings-list">
              {communityAdmins.map((admin) => (
                <div key={admin.id} className="community-settings-row">
                  <span className="community-settings-role">Admin</span>
                  <span className="community-settings-user">
                    {admin.username} ({admin.email})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="community-settings-empty">No additional admins yet.</p>
          )}
        </div>

        {canManageBalances && (
          <div className="community-settings-section">
            <h3>Member Balances</h3>
            {communityWallets.length === 0 ? (
              <p className="community-settings-empty">No member wallets found.</p>
            ) : (
              <div className="community-wallet-list">
                {communityWallets.map((walletRow) => (
                  <div key={walletRow.user_id} className="community-wallet-row">
                    <div className="community-wallet-user">
                      <strong>{walletRow.username}</strong>
                      <span>{Number(walletRow.balance).toFixed(2)} chips</span>
                    </div>
                    <div className="community-wallet-controls">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={walletAdjustAmountByUser[walletRow.user_id] ?? ''}
                        onChange={(event) => updateWalletAdjustAmount(walletRow.user_id, event.target.value)}
                        placeholder="Amount"
                      />
                      <button type="button" className="community-settings-secondary" onClick={() => applyWalletAdjustment(walletRow.user_id, 'set')}>
                        Set
                      </button>
                      <button type="button" className="community-settings-secondary" onClick={() => applyWalletAdjustment(walletRow.user_id, 'add')}>
                        Add
                      </button>
                      <button type="button" className="community-settings-secondary" onClick={() => applyWalletAdjustment(walletRow.user_id, 'subtract')}>
                        Subtract
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <form
          className="community-settings-section"
          onSubmit={(event) => {
            event.preventDefault();
            void inviteCommunityAdmin();
          }}
        >
          <h3>Invite Admin</h3>
          <div className="community-settings-field">
            <label>Username or Email</label>
            <input
              type="text"
              value={communityAdminInvite}
              onChange={(event) => setCommunityAdminInvite(event.target.value)}
              placeholder="username or email"
              disabled={!canInviteCommunityAdmins}
            />
          </div>
          {!canInviteCommunityAdmins && (
            <p className="community-settings-note">Only community commissioners or admins can invite new admins.</p>
          )}
          <div className="community-settings-actions">
            <button type="submit" className="community-settings-primary" disabled={!canInviteCommunityAdmins}>
              Invite
            </button>
          </div>
        </form>

        <div className="community-settings-footer">
          {canDeleteCommunity ? (
            <div className="community-settings-section danger-zone community-settings-footer-danger">
              <button type="button" className="community-settings-danger" onClick={() => void deleteCommunity()}>
                Delete Community
              </button>
            </div>
          ) : (
            <div />
          )}
          <button type="button" className="community-settings-secondary community-settings-footer-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
