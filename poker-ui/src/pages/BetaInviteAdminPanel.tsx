import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as apiModule from '../api';
import type { BetaInviteAdmin, BetaInviteStatus } from '../types';
import { getApiErrorMessage } from '../utils/error';

const STATUS_LABELS: Record<BetaInviteStatus, string> = {
  pending: 'Pending',
  expired: 'Expired',
  redeemed: 'Redeemed',
  revoked: 'Revoked',
};

const formatTimestamp = (value?: string | null): string => {
  if (!value) {
    return 'Not available';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const canResendInvite = (invite: BetaInviteAdmin): boolean =>
  invite.status === 'pending' || invite.status === 'expired';

const canRevokeInvite = (invite: BetaInviteAdmin): boolean =>
  invite.status === 'pending' || invite.status === 'expired';

const inviteActionMessage = (
  invite: BetaInviteAdmin,
  action: 'create' | 'resend' | 'revoke'
): string => {
  if (action === 'revoke') {
    return `Invite for ${invite.email} revoked.`;
  }
  if (invite.delivery_status === 'manual_required') {
    return `Manual delivery required for ${invite.email}. Copy the link below and send it directly.`;
  }
  return `${action === 'create' ? 'Created' : 'Resent'} invite for ${invite.email}.`;
};

export const BetaInviteAdminPanel: React.FC = () => {
  const [invites, setInvites] = useState<BetaInviteAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNotes, setInviteNotes] = useState('');
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [activeInviteAction, setActiveInviteAction] = useState<{
    inviteId: number;
    action: 'resend' | 'revoke';
  } | null>(null);
  const [manualDeliveryLink, setManualDeliveryLink] = useState<{
    email: string;
    inviteUrl: string;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState('');

  const loadInvites = useCallback(async (preserveCurrentState: boolean = false) => {
    try {
      if (!preserveCurrentState) {
        setLoading(true);
      }
      setError('');
      const response = await apiModule.betaInvitesApi.list();
      setInvites(response.items);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load beta invites'));
    } finally {
      if (!preserveCurrentState) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const inviteCountSummary = useMemo(() => {
    const pendingCount = invites.filter((invite) => invite.status === 'pending').length;
    const manualCount = invites.filter((invite) => invite.delivery_status === 'manual_required').length;
    return { pendingCount, manualCount };
  }, [invites]);

  const syncInvitesAfterAction = useCallback(async (
    result: BetaInviteAdmin,
    action: 'create' | 'resend' | 'revoke'
  ) => {
    setManualDeliveryLink(
      action !== 'revoke' && result.delivery_status === 'manual_required' && result.invite_url
        ? { email: result.email, inviteUrl: result.invite_url }
        : null
    );
    setActionMessage(inviteActionMessage(result, action));
    setCopyFeedback('');
    await loadInvites(true);
  }, [loadInvites]);

  const handleCreateInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const trimmedNotes = inviteNotes.trim();

    if (!normalizedEmail) {
      return;
    }

    try {
      setIsCreatingInvite(true);
      const createdInvite = await apiModule.betaInvitesApi.create(normalizedEmail, trimmedNotes || undefined);
      setInviteEmail('');
      setInviteNotes('');
      await syncInvitesAfterAction(createdInvite, 'create');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create beta invite'));
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleResendInvite = async (inviteId: number) => {
    try {
      setActiveInviteAction({ inviteId, action: 'resend' });
      const updatedInvite = await apiModule.betaInvitesApi.resend(inviteId);
      await syncInvitesAfterAction(updatedInvite, 'resend');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to resend beta invite'));
    } finally {
      setActiveInviteAction(null);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    try {
      setActiveInviteAction({ inviteId, action: 'revoke' });
      const updatedInvite = await apiModule.betaInvitesApi.revoke(inviteId);
      await syncInvitesAfterAction(updatedInvite, 'revoke');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to revoke beta invite'));
    } finally {
      setActiveInviteAction(null);
    }
  };

  const handleCopyManualLink = async () => {
    if (!manualDeliveryLink?.inviteUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(manualDeliveryLink.inviteUrl);
      setCopyFeedback('Copied invite link.');
    } catch {
      setCopyFeedback('Copy failed. Select and copy the link manually.');
    }
  };

  return (
    <section className="beta-invites-panel" aria-label="Beta invite admin panel">
      <div className="section-header beta-invites-header">
        <h2>Beta Invites</h2>
        <p className="beta-invites-summary">
          {inviteCountSummary.pendingCount} pending
          {inviteCountSummary.manualCount > 0 ? ` • ${inviteCountSummary.manualCount} need manual delivery` : ''}
        </p>
      </div>

      <div className="beta-invites-layout">
        <form className="beta-invite-create-card" onSubmit={handleCreateInvite}>
          <h3>Create Invite</h3>
          <div className="form-group">
            <label htmlFor="beta-invite-email">Invite Email</label>
            <input
              id="beta-invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="tester@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="beta-invite-notes">Notes</label>
            <textarea
              id="beta-invite-notes"
              value={inviteNotes}
              onChange={(event) => setInviteNotes(event.target.value)}
              placeholder="Optional context for this tester"
              maxLength={500}
            />
          </div>
          <div className="beta-invite-actions">
            <button type="submit" className="btn-primary" disabled={isCreatingInvite}>
              {isCreatingInvite ? 'Creating…' : 'Create Invite'}
            </button>
          </div>
        </form>

        <div className="beta-invite-side-column">
          {actionMessage && (
            <div className="beta-invite-notice" role="status">
              <p>{actionMessage}</p>
              {manualDeliveryLink && (
                <div className="beta-invite-manual-link">
                  <label htmlFor="beta-invite-manual-link">Manual delivery required</label>
                  <div className="beta-invite-manual-link-controls">
                    <input
                      id="beta-invite-manual-link"
                      type="text"
                      readOnly
                      value={manualDeliveryLink.inviteUrl}
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-small"
                      onClick={handleCopyManualLink}
                    >
                      Copy Link
                    </button>
                  </div>
                  {copyFeedback && <p className="beta-invite-copy-feedback">{copyFeedback}</p>}
                </div>
              )}
            </div>
          )}

          {error && <div className="beta-invite-error">{error}</div>}

          <div className="beta-invite-list-card">
            <div className="beta-invite-list-header">
              <h3>Recent Invites</h3>
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => void loadInvites()}
                disabled={loading}
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <p className="settings-empty">Loading beta invites…</p>
            ) : invites.length === 0 ? (
              <p className="settings-empty">No beta invites yet.</p>
            ) : (
              <div className="beta-invite-list">
                {invites.map((invite) => {
                  const isActionBusy = activeInviteAction?.inviteId === invite.id;
                  return (
                    <article
                      key={invite.id}
                      className="beta-invite-row"
                      data-testid={`beta-invite-row-${invite.id}`}
                    >
                      <div className="beta-invite-row-header">
                        <div>
                          <div className="beta-invite-email">{invite.email}</div>
                          {invite.notes && <p className="beta-invite-notes">{invite.notes}</p>}
                        </div>
                        <div className={`beta-invite-status beta-invite-status-${invite.status}`}>
                          {STATUS_LABELS[invite.status]}
                        </div>
                      </div>

                      <dl className="beta-invite-meta">
                        <div>
                          <dt>Created</dt>
                          <dd>{formatTimestamp(invite.created_at)}</dd>
                        </div>
                        <div>
                          <dt>Expires</dt>
                          <dd>{formatTimestamp(invite.expires_at)}</dd>
                        </div>
                        <div>
                          <dt>Sent</dt>
                          <dd>{formatTimestamp(invite.sent_at)}</dd>
                        </div>
                        <div>
                          <dt>Redeemed</dt>
                          <dd>{formatTimestamp(invite.used_at)}</dd>
                        </div>
                        <div>
                          <dt>Revoked</dt>
                          <dd>{formatTimestamp(invite.revoked_at)}</dd>
                        </div>
                      </dl>

                      <div className="beta-invite-delivery">
                        Delivery: {invite.delivery_status === 'manual_required' ? 'Manual required' : 'Sent'}
                      </div>

                      {(canResendInvite(invite) || canRevokeInvite(invite)) && (
                        <div className="beta-invite-row-actions">
                          {canResendInvite(invite) && (
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              onClick={() => void handleResendInvite(invite.id)}
                              disabled={isActionBusy}
                              aria-label={`Resend ${invite.email}`}
                            >
                              {isActionBusy && activeInviteAction?.action === 'resend' ? 'Resending…' : 'Resend'}
                            </button>
                          )}
                          {canRevokeInvite(invite) && (
                            <button
                              type="button"
                              className="btn-danger btn-small"
                              onClick={() => void handleRevokeInvite(invite.id)}
                              disabled={isActionBusy}
                              aria-label={`Revoke ${invite.email}`}
                            >
                              {isActionBusy && activeInviteAction?.action === 'revoke' ? 'Revoking…' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BetaInviteAdminPanel;
