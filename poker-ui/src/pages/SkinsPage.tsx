import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { marketplaceApi, skinsApi } from '../api';
import { useAuth } from '../auth-context';
import type { CreatorEarnings, CreatorPayoutRequest, SkinCatalogItem, SkinSubmission, UserSkin } from '../types';
import './FeatureHub.css';
import { getApiErrorMessage } from '../utils/error';

interface AdminDraft {
  reviewNotes: string;
  publishPrice: string;
  publishPreviewUrl: string;
  proposedDesignSpecJson: string;
}

interface AdminPayoutDraft {
  processorNote: string;
  payoutReference: string;
}

const workflowLabel = (state: SkinSubmission['workflow_state']) => {
  switch (state) {
    case 'pending_admin_review':
      return 'Pending Admin Review';
    case 'admin_accepted_waiting_creator':
      return 'Admin Proposal Waiting for You';
    case 'admin_declined':
      return 'Declined by Admin';
    case 'creator_accepted_published':
      return 'Published';
    case 'creator_declined':
      return 'Declined by Creator (Needs Rework)';
    default:
      return state;
  }
};

export const SkinsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [mySkins, setMySkins] = useState<UserSkin[]>([]);
  const [catalog, setCatalog] = useState<SkinCatalogItem[]>([]);
  const [mySubmissions, setMySubmissions] = useState<SkinSubmission[]>([]);
  const [adminSubmissions, setAdminSubmissions] = useState<SkinSubmission[]>([]);
  const [creatorEarnings, setCreatorEarnings] = useState<CreatorEarnings | null>(null);
  const [myPayoutRequests, setMyPayoutRequests] = useState<CreatorPayoutRequest[]>([]);
  const [adminPayoutRequests, setAdminPayoutRequests] = useState<CreatorPayoutRequest[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [payoutEmailInput, setPayoutEmailInput] = useState('');
  const [payoutAmountInput, setPayoutAmountInput] = useState('');

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'cards' | 'table' | 'avatar' | 'emote' | 'other'>('cards');
  const [desiredPrice, setDesiredPrice] = useState(500);
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const [submitterNotes, setSubmitterNotes] = useState('');
  const [advancedDesignSpecJson, setAdvancedDesignSpecJson] = useState('');

  const [adminDrafts, setAdminDrafts] = useState<Record<number, AdminDraft>>({});
  const [creatorComments, setCreatorComments] = useState<Record<number, string>>({});
  const [adminPayoutDrafts, setAdminPayoutDrafts] = useState<Record<number, AdminPayoutDraft>>({});

  const reviewableAdminSubmissions = useMemo(
    () => adminSubmissions.filter((submission) =>
      submission.workflow_state === 'pending_admin_review' || submission.workflow_state === 'creator_declined' || submission.workflow_state === 'admin_accepted_waiting_creator'
    ),
    [adminSubmissions]
  );

  const pendingAdminPayoutRequests = useMemo(
    () => adminPayoutRequests.filter((request) => request.status === 'pending'),
    [adminPayoutRequests]
  );

  const formatUsd = (cents: number | undefined | null) => {
    const value = Number(cents || 0);
    return `$${(value / 100).toFixed(2)}`;
  };

  const loadData = useCallback(async () => {
    try {
      setError('');
      const [owned, available, mine, earnings, payoutRequests] = await Promise.all([
        skinsApi.getMySkins(),
        skinsApi.getCatalog(),
        skinsApi.getMySubmissions(),
        marketplaceApi.getCreatorEarnings(),
        marketplaceApi.listMyCreatorPayoutRequests(),
      ]);
      setMySkins(owned);
      setCatalog(available);
      setMySubmissions(mine);
      setCreatorEarnings(earnings);
      setPayoutEmailInput(earnings.payout_email || '');
      setMyPayoutRequests(payoutRequests);

      if (user?.is_admin) {
        const [submissions, adminPayouts] = await Promise.all([
          skinsApi.listSubmissions(),
          marketplaceApi.listCreatorPayoutRequestsAsAdmin('pending'),
        ]);
        setAdminSubmissions(submissions);
        setAdminPayoutRequests(adminPayouts);
        setAdminDrafts((previous) => {
          const next = { ...previous };
          for (const submission of submissions) {
            if (!next[submission.id]) {
              next[submission.id] = {
                reviewNotes: submission.admin_comment || '',
                publishPrice: String(
                  submission.admin_proposed_price_gold_coins
                  ?? submission.desired_price_gold_coins
                  ?? 0
                ),
                publishPreviewUrl: submission.admin_rendered_image_url || submission.reference_image_url || '',
                proposedDesignSpecJson: JSON.stringify(
                  submission.admin_proposed_design_spec || submission.design_spec || {},
                  null,
                  2
                ),
              };
            }
          }
          return next;
        });
        setAdminPayoutDrafts((previous) => {
          const next = { ...previous };
          for (const request of adminPayouts) {
            if (!next[request.id]) {
              next[request.id] = {
                processorNote: '',
                payoutReference: '',
              };
            }
          }
          return next;
        });
      } else {
        setAdminSubmissions([]);
        setAdminPayoutRequests([]);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load skins'));
    }
  }, [user?.is_admin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setEquipped = async (skinId: number, equip: boolean) => {
    try {
      setError('');
      await skinsApi.equip(skinId, equip);
      await loadData();
      setInfo(equip ? 'Skin equipped.' : 'Skin unequipped.');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update equipped skin'));
    }
  };

  const submitDesign = async () => {
    try {
      setError('');
      setInfo('');

      let parsedDesignSpec: Record<string, unknown> | undefined;
      if (advancedDesignSpecJson.trim().length > 0) {
        parsedDesignSpec = JSON.parse(advancedDesignSpecJson);
      }

      await skinsApi.submitDesign({
        name,
        category,
        desired_price_gold_coins: desiredPrice,
        reference_image_url: referenceImageUrl.trim() || undefined,
        submitter_notes: submitterNotes.trim() || undefined,
        design_spec: parsedDesignSpec,
      });

      setName('');
      setDesiredPrice(500);
      setReferenceImageUrl('');
      setSubmitterNotes('');
      setAdvancedDesignSpecJson('');
      setInfo('Submission sent to global admins for review.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Invalid skin submission payload'));
    }
  };

  const updateAdminDraft = (submissionId: number, partial: Partial<AdminDraft>) => {
    setAdminDrafts((previous) => ({
      ...previous,
      [submissionId]: {
        ...(previous[submissionId] ?? {
          reviewNotes: '',
          publishPrice: '0',
          publishPreviewUrl: '',
          proposedDesignSpecJson: '{}',
        }),
        ...partial,
      } as AdminDraft,
    }));
  };

  const reviewSubmission = async (submission: SkinSubmission, action: 'accept' | 'decline') => {
    const draft = adminDrafts[submission.id];
    if (!draft) {
      setError('Missing admin draft data for this submission.');
      return;
    }

    try {
      setError('');
      setInfo('');

      const payload: {
        action: 'accept' | 'decline';
        review_notes?: string;
        publish_price_gold_coins?: number;
        publish_preview_url?: string;
        proposed_design_spec?: Record<string, unknown>;
      } = {
        action,
        review_notes: draft.reviewNotes.trim() || undefined,
      };

      if (action === 'accept') {
        payload.publish_price_gold_coins = Math.max(0, Number(draft.publishPrice) || 0);
        payload.publish_preview_url = draft.publishPreviewUrl.trim() || undefined;
        payload.proposed_design_spec = JSON.parse(draft.proposedDesignSpecJson || '{}');
      }

      await skinsApi.reviewSubmission(submission.id, payload);
      setInfo(action === 'accept' ? 'Proposal sent to creator.' : 'Submission declined with notes.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to review submission'));
    }
  };

  const creatorDecision = async (submissionId: number, accept: boolean) => {
    try {
      setError('');
      setInfo('');
      await skinsApi.creatorDecision(submissionId, accept, creatorComments[submissionId]?.trim() || undefined);
      setCreatorComments((previous) => ({ ...previous, [submissionId]: '' }));
      setInfo(accept ? 'Accepted and published to marketplace.' : 'Declined and feedback sent to admin.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to send creator decision'));
    }
  };

  const savePayoutProfile = async () => {
    try {
      setError('');
      setInfo('');
      await marketplaceApi.updateCreatorPayoutProfile(payoutEmailInput.trim());
      setInfo('Creator payout email updated.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update payout profile'));
    }
  };

  const requestPayout = async () => {
    try {
      setError('');
      setInfo('');
      const amountDollars = payoutAmountInput.trim().length > 0 ? Number(payoutAmountInput) : NaN;
      const amountCents = Number.isFinite(amountDollars) && amountDollars > 0
        ? Math.round(amountDollars * 100)
        : undefined;
      await marketplaceApi.requestCreatorPayout(amountCents);
      setPayoutAmountInput('');
      setInfo('Payout request submitted for admin processing.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to request payout'));
    }
  };

  const updateAdminPayoutDraft = (requestId: number, partial: Partial<AdminPayoutDraft>) => {
    setAdminPayoutDrafts((previous) => ({
      ...previous,
      [requestId]: {
        ...(previous[requestId] ?? { processorNote: '', payoutReference: '' }),
        ...partial,
      } as AdminPayoutDraft,
    }));
  };

  const processAdminPayoutRequest = async (request: CreatorPayoutRequest, action: 'mark_paid' | 'reject') => {
    const draft = adminPayoutDrafts[request.id] ?? { processorNote: '', payoutReference: '' };
    try {
      setError('');
      setInfo('');
      await marketplaceApi.processCreatorPayoutRequestAsAdmin(request.id, {
        action,
        processor_note: draft.processorNote.trim() || undefined,
        payout_reference: draft.payoutReference.trim() || undefined,
      });
      setInfo(action === 'mark_paid' ? 'Payout marked as paid.' : 'Payout request rejected.');
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to process payout request'));
    }
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h1>Skin Library</h1>
        <button className="secondary" onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}
      {info && <div className="feature-card">{info}</div>}

      <div className="feature-grid">
        <div className="feature-card">
          <h3>Owned Skins</h3>
          <div className="feature-list">
            {mySkins.map((entry) => (
              <div key={entry.skin_id} className="feature-card">
                <h3>{entry.skin.name}</h3>
                <div className="feature-meta">{entry.skin.category}</div>
                <div className="feature-row" style={{ marginTop: 6 }}>
                  <button type="button" onClick={() => setEquipped(entry.skin_id, true)}>
                    Equip
                  </button>
                  <button type="button" className="secondary" onClick={() => setEquipped(entry.skin_id, false)}>
                    Unequip
                  </button>
                </div>
                <div className="feature-meta">{entry.is_equipped ? 'Equipped' : 'Not equipped'}</div>
              </div>
            ))}
            {mySkins.length === 0 && <div className="feature-meta">No owned skins yet.</div>}
          </div>
        </div>

        <div className="feature-card">
          <h3>Creator Earnings (Cash)</h3>
          <div className="feature-meta">Pending: {formatUsd(creatorEarnings?.pending_cents)}</div>
          <div className="feature-meta">Paid: {formatUsd(creatorEarnings?.paid_cents)}</div>
          <div className="feature-meta">Total: {formatUsd(creatorEarnings?.total_cents)}</div>
          <div className="feature-meta" style={{ marginTop: 8 }}>
            Royalties are tracked in USD based on peg rate (1 gold coin ~= 1 cent) at 5% per sale.
          </div>

          <input
            value={payoutEmailInput}
            onChange={(event) => setPayoutEmailInput(event.target.value)}
            placeholder="Payout email (PayPal or transfer contact)"
            style={{ marginTop: 8 }}
          />
          <div className="feature-row" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={savePayoutProfile}>
              Save Payout Email
            </button>
          </div>

          <input
            type="number"
            min={0}
            step="0.01"
            value={payoutAmountInput}
            onChange={(event) => setPayoutAmountInput(event.target.value)}
            placeholder="Payout amount in USD (blank = full pending)"
            style={{ marginTop: 8 }}
          />
          <button type="button" style={{ marginTop: 8 }} onClick={requestPayout}>
            Request Payout
          </button>
          <div className="feature-meta" style={{ marginTop: 6 }}>
            Minimum request: $10.00.
          </div>
        </div>

        <div className="feature-card">
          <h3>Submit Skin Concept</h3>
          <div className="feature-meta" style={{ marginBottom: 8 }}>
            Submit an image concept and desired price. Admins can propose final render JSON + listing details.
          </div>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Skin name" />
          <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} style={{ marginTop: 8 }}>
            <option value="cards">Cards</option>
            <option value="table">Table</option>
            <option value="avatar">Avatar</option>
            <option value="emote">Emote</option>
            <option value="other">Other</option>
          </select>
          <input
            type="number"
            min={1}
            value={desiredPrice}
            onChange={(event) => setDesiredPrice(Math.max(1, Number(event.target.value) || 1))}
            placeholder="Desired price (gold coins)"
            style={{ marginTop: 8 }}
          />
          <input
            value={referenceImageUrl}
            onChange={(event) => setReferenceImageUrl(event.target.value)}
            placeholder="Reference image URL (required unless design JSON provided)"
            style={{ marginTop: 8 }}
          />
          <textarea
            value={submitterNotes}
            onChange={(event) => setSubmitterNotes(event.target.value)}
            rows={4}
            placeholder="Notes for admin/reviewer"
            style={{ marginTop: 8 }}
          />
          <textarea
            value={advancedDesignSpecJson}
            onChange={(event) => setAdvancedDesignSpecJson(event.target.value)}
            rows={6}
            placeholder="Optional advanced design_spec JSON"
            style={{ marginTop: 8 }}
          />
          <button type="button" style={{ marginTop: 8 }} onClick={submitDesign}>
            Submit Concept
          </button>
        </div>

        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>My Skin Submissions</h3>
          <div className="feature-grid">
            {mySubmissions.map((submission) => (
              <div key={submission.id} className="feature-card">
                <h3>{submission.name}</h3>
                <div className="feature-meta">Category: {submission.category}</div>
                <div className="feature-meta">Requested price: {submission.desired_price_gold_coins} GC</div>
                <div className="feature-meta">Workflow: {workflowLabel(submission.workflow_state)}</div>
                {submission.reference_image_url && (
                  <img
                    src={submission.reference_image_url}
                    alt={`${submission.name} concept`}
                    style={{ width: '100%', borderRadius: 8, marginTop: 8, border: '1px solid #dbeafe' }}
                  />
                )}
                {submission.submitter_notes && (
                  <p style={{ marginTop: 8 }}>{submission.submitter_notes}</p>
                )}

                {submission.workflow_state === 'admin_accepted_waiting_creator' && (
                  <>
                    <div className="feature-meta" style={{ marginTop: 8 }}>
                      Admin proposed price: {submission.admin_proposed_price_gold_coins ?? 0} GC
                    </div>
                    {submission.admin_rendered_image_url && (
                      <img
                        src={submission.admin_rendered_image_url}
                        alt={`${submission.name} admin render`}
                        style={{ width: '100%', borderRadius: 8, marginTop: 8, border: '1px solid #dbeafe' }}
                      />
                    )}
                    {submission.admin_comment && (
                      <div className="feature-meta" style={{ marginTop: 8 }}>
                        Admin notes: {submission.admin_comment}
                      </div>
                    )}
                    <textarea
                      rows={3}
                      style={{ marginTop: 8 }}
                      placeholder="Comment back to admin"
                      value={creatorComments[submission.id] || ''}
                      onChange={(event) => setCreatorComments((previous) => ({ ...previous, [submission.id]: event.target.value }))}
                    />
                    <div className="feature-row" style={{ marginTop: 8 }}>
                      <button type="button" onClick={() => creatorDecision(submission.id, false)} className="secondary">
                        Decline Proposal
                      </button>
                      <button type="button" onClick={() => creatorDecision(submission.id, true)}>
                        Accept & Publish
                      </button>
                    </div>
                  </>
                )}

                {submission.admin_proposed_design_spec && (
                  <details style={{ marginTop: 8 }}>
                    <summary>Proposed JSON</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {JSON.stringify(submission.admin_proposed_design_spec, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
            {mySubmissions.length === 0 && <div className="feature-meta">No submissions yet.</div>}
          </div>
        </div>

        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>My Payout Requests</h3>
          <div className="feature-grid">
            {myPayoutRequests.map((request) => (
              <div key={request.id} className="feature-card">
                <h3>Request #{request.id}</h3>
                <div className="feature-meta">Amount: {formatUsd(request.amount_cents)}</div>
                <div className="feature-meta">Status: {request.status}</div>
                <div className="feature-meta">Email: {request.payout_email}</div>
                <div className="feature-meta">Requested: {new Date(request.requested_at).toLocaleString()}</div>
                {request.processed_at && (
                  <div className="feature-meta">Processed: {new Date(request.processed_at).toLocaleString()}</div>
                )}
                {request.payout_reference && (
                  <div className="feature-meta">Reference: {request.payout_reference}</div>
                )}
                {request.processor_note && (
                  <div className="feature-meta">Note: {request.processor_note}</div>
                )}
              </div>
            ))}
            {myPayoutRequests.length === 0 && (
              <div className="feature-meta">No payout requests yet.</div>
            )}
          </div>
        </div>

        {user?.is_admin && (
          <>
            <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
              <h3>Admin Creator Payout Queue</h3>
              <div className="feature-grid">
                {pendingAdminPayoutRequests.map((request) => {
                  const draft = adminPayoutDrafts[request.id] ?? { processorNote: '', payoutReference: '' };
                  return (
                    <div key={request.id} className="feature-card">
                      <h3>Request #{request.id}</h3>
                      <div className="feature-meta">Amount: {formatUsd(request.amount_cents)}</div>
                      <div className="feature-meta">Payout Email: {request.payout_email}</div>
                      <div className="feature-meta">Requested: {new Date(request.requested_at).toLocaleString()}</div>

                      <input
                        value={draft.payoutReference}
                        onChange={(event) => updateAdminPayoutDraft(request.id, { payoutReference: event.target.value })}
                        placeholder="External payout reference"
                        style={{ marginTop: 8 }}
                      />
                      <textarea
                        rows={3}
                        value={draft.processorNote}
                        onChange={(event) => updateAdminPayoutDraft(request.id, { processorNote: event.target.value })}
                        placeholder="Admin payout note"
                        style={{ marginTop: 8 }}
                      />
                      <div className="feature-row" style={{ marginTop: 8 }}>
                        <button type="button" className="secondary" onClick={() => processAdminPayoutRequest(request, 'reject')}>
                          Reject
                        </button>
                        <button type="button" onClick={() => processAdminPayoutRequest(request, 'mark_paid')}>
                          Mark Paid
                        </button>
                      </div>
                    </div>
                  );
                })}
                {pendingAdminPayoutRequests.length === 0 && (
                  <div className="feature-meta">No pending payout requests.</div>
                )}
              </div>
            </div>

            <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
              <h3>Admin Skin Review Queue</h3>
              <div className="feature-grid">
                {reviewableAdminSubmissions.map((submission) => {
                  const draft = adminDrafts[submission.id] || {
                    reviewNotes: '',
                    publishPrice: String(submission.desired_price_gold_coins || 0),
                    publishPreviewUrl: submission.reference_image_url || '',
                    proposedDesignSpecJson: JSON.stringify(submission.design_spec || {}, null, 2),
                  };

                  return (
                    <div key={submission.id} className="feature-card">
                      <h3>{submission.name}</h3>
                      <div className="feature-meta">Creator: {submission.username}</div>
                      <div className="feature-meta">Workflow: {workflowLabel(submission.workflow_state)}</div>
                      <div className="feature-meta">Requested price: {submission.desired_price_gold_coins} GC</div>
                      {submission.reference_image_url && (
                        <img
                          src={submission.reference_image_url}
                          alt={`${submission.name} concept`}
                          style={{ width: '100%', borderRadius: 8, marginTop: 8, border: '1px solid #dbeafe' }}
                        />
                      )}
                      {submission.submitter_notes && <p style={{ marginTop: 8 }}>{submission.submitter_notes}</p>}

                      <textarea
                        rows={3}
                        style={{ marginTop: 8 }}
                        placeholder="Admin notes to creator"
                        value={draft.reviewNotes}
                        onChange={(event) => updateAdminDraft(submission.id, { reviewNotes: event.target.value })}
                      />

                      <input
                        type="number"
                        min={0}
                        value={draft.publishPrice}
                        onChange={(event) => updateAdminDraft(submission.id, { publishPrice: event.target.value })}
                        placeholder="Marketplace price (GC)"
                        style={{ marginTop: 8 }}
                      />

                      <input
                        value={draft.publishPreviewUrl}
                        onChange={(event) => updateAdminDraft(submission.id, { publishPreviewUrl: event.target.value })}
                        placeholder="Rendered image URL"
                        style={{ marginTop: 8 }}
                      />

                      <textarea
                        rows={7}
                        style={{ marginTop: 8 }}
                        value={draft.proposedDesignSpecJson}
                        onChange={(event) => updateAdminDraft(submission.id, { proposedDesignSpecJson: event.target.value })}
                        placeholder="Proposed design_spec JSON"
                      />

                      <div className="feature-row" style={{ marginTop: 8 }}>
                        <button type="button" className="secondary" onClick={() => reviewSubmission(submission, 'decline')}>
                          Decline
                        </button>
                        <button type="button" onClick={() => reviewSubmission(submission, 'accept')}>
                          Send Accept Proposal
                        </button>
                      </div>
                    </div>
                  );
                })}
                {reviewableAdminSubmissions.length === 0 && (
                  <div className="feature-meta">No pending skin reviews right now.</div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>Catalog Preview</h3>
          <div className="feature-grid">
            {catalog.map((item) => (
              <div key={item.id} className="feature-card">
                <h3>{item.name}</h3>
                <div className="feature-meta">{item.category}</div>
                <div className="feature-meta">{item.price_gold_coins} GC</div>
                <p>{item.description || 'No description'}</p>
                {item.preview_url && (
                  <img
                    src={item.preview_url}
                    alt={`${item.name} preview`}
                    style={{ width: '100%', borderRadius: 8, border: '1px solid #dbeafe' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
