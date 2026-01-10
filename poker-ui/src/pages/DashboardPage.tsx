/**
 * Dashboard/Lobby page - shows leagues, communities, wallets, inbox
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { communitiesApi, walletsApi, leaguesApi, inboxApi } from '../api';
import type { Community, Wallet, League, InboxMessage, AdminUser } from '../types';
import UserMenu from '../components/UserMenu';
import './Dashboard.css';

export const DashboardPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Expanded leagues state
  const [expandedLeagues, setExpandedLeagues] = useState<Set<number>>(new Set());
  
  // Modal states
  const [showCreateCommunityModal, setShowCreateCommunityModal] = useState(false);
  const [showCreateLeagueModal, setShowCreateLeagueModal] = useState(false);
  const [showJoinRequestModal, setShowJoinRequestModal] = useState(false);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [showLeagueSettingsModal, setShowLeagueSettingsModal] = useState(false);
  const [showCommunitySettingsModal, setShowCommunitySettingsModal] = useState(false);
  const [showLeagueJoinModal, setShowLeagueJoinModal] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);
  const [selectedLeagueForJoin, setSelectedLeagueForJoin] = useState<League | null>(null);
  const [createCommunityForLeague, setCreateCommunityForLeague] = useState<number | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  
  // Inbox state
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Form states
  const [newCommunityName, setNewCommunityName] = useState('');
  const [newCommunityDescription, setNewCommunityDescription] = useState('');
  const [newCommunityBalance, setNewCommunityBalance] = useState(1000);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newLeagueDescription, setNewLeagueDescription] = useState('');
  const [joinRequestMessage, setJoinRequestMessage] = useState('');
  const [leagueJoinMessage, setLeagueJoinMessage] = useState('');
  const [leagueAdminInvite, setLeagueAdminInvite] = useState('');
  const [communityAdminInvite, setCommunityAdminInvite] = useState('');

  // Admin list state
  const [leagueAdmins, setLeagueAdmins] = useState<AdminUser[]>([]);
  const [leagueOwner, setLeagueOwner] = useState<AdminUser | null>(null);
  const [communityAdmins, setCommunityAdmins] = useState<AdminUser[]>([]);
  const [communityCommissioner, setCommunityCommissioner] = useState<AdminUser | null>(null);
  
  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<InboxMessage | null>(null);
  const [customBalance, setCustomBalance] = useState<number | undefined>(undefined);
  
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
    loadUnreadCount();
  }, []);
  
  // Auto-expand leagues when loaded
  useEffect(() => {
    if (leagues.length > 0 && expandedLeagues.size === 0) {
      setExpandedLeagues(new Set(leagues.map(l => l.id)));
    }
  }, [leagues]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      
      const [communitiesData, walletsData, leaguesData] = await Promise.all([
        communitiesApi.getAll(),
        walletsApi.getAll(),
        leaguesApi.getAll(),
      ]);
      
      setCommunities(communitiesData);
      setWallets(walletsData);
      setLeagues(leaguesData);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const data = await inboxApi.getUnreadCount();
      setUnreadCount(data.unread_count);
    } catch (err) {
      console.error('Failed to load unread count:', err);
    }
  };

  const loadInbox = async () => {
    try {
      const messages = await inboxApi.getMessages();
      setInboxMessages(messages);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to load inbox');
    }
  };

  const handleJoinGame = (communityId: number) => {
    navigate(`/community/${communityId}`);
  };

  const getWalletBalance = (communityId: number): string => {
    const wallet = wallets.find(w => w.community_id === communityId);
    if (!wallet) return 'Not joined';
    return `$${parseFloat(wallet.balance.toString()).toFixed(2)}`;
  };

  const hasWallet = (communityId: number): boolean => {
    return wallets.some(w => w.community_id === communityId);
  };
  
  const getCommunitiesForLeague = (leagueId: number): Community[] => {
    return communities.filter(c => c.league_id === leagueId);
  };

  const isLeagueMember = (league: League): boolean => {
    if (!user) return false;
    if (league.owner_id === user.id) {
      return true;
    }
    if (league.is_member !== undefined && league.is_member !== null) {
      return league.is_member;
    }
    return false;
  };

  const openLeagueSettings = async (league: League) => {
    try {
      setLeagueAdmins([]);
      setLeagueOwner(null);
      setLeagueAdminInvite('');
      const data = await leaguesApi.getAdmins(league.id);
      setLeagueOwner(data.owner || null);
      setLeagueAdmins(data.admins || []);
      setSelectedLeague(league);
      setShowLeagueSettingsModal(true);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to load league settings');
    }
  };

  const openCommunitySettings = async (community: Community) => {
    try {
      setCommunityAdmins([]);
      setCommunityCommissioner(null);
      setCommunityAdminInvite('');
      const data = await communitiesApi.getAdmins(community.id);
      setCommunityCommissioner(data.commissioner || null);
      setCommunityAdmins(data.admins || []);
      setSelectedCommunity(community);
      setShowCommunitySettingsModal(true);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to load community settings');
    }
  };

  const closeLeagueSettings = () => {
    setShowLeagueSettingsModal(false);
    setSelectedLeague(null);
    setLeagueAdmins([]);
    setLeagueOwner(null);
    setLeagueAdminInvite('');
  };

  const closeCommunitySettings = () => {
    setShowCommunitySettingsModal(false);
    setSelectedCommunity(null);
    setCommunityAdmins([]);
    setCommunityCommissioner(null);
    setCommunityAdminInvite('');
  };

  const inviteLeagueAdmin = async () => {
    if (!selectedLeague) return;
    const trimmed = leagueAdminInvite.trim();
    if (!trimmed) {
      alert('Enter a username or email');
      return;
    }
    try {
      const payload = trimmed.includes('@') ? { email: trimmed } : { username: trimmed };
      await leaguesApi.inviteAdmin(selectedLeague.id, payload);
      const data = await leaguesApi.getAdmins(selectedLeague.id);
      setLeagueOwner(data.owner || null);
      setLeagueAdmins(data.admins || []);
      setLeagueAdminInvite('');
      alert('League admin invited successfully');
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to invite league admin');
    }
  };

  const canInviteLeagueAdmins =
    !!user &&
    !!selectedLeague &&
    (selectedLeague.owner_id === user.id || leagueAdmins.some((admin) => admin.id === user.id));

  const canInviteCommunityAdmins =
    !!user &&
    !!selectedCommunity &&
    (communityCommissioner?.id === user.id || communityAdmins.some((admin) => admin.id === user.id));

  const inviteCommunityAdmin = async () => {
    if (!selectedCommunity) return;
    const trimmed = communityAdminInvite.trim();
    if (!trimmed) {
      alert('Enter a username or email');
      return;
    }
    try {
      const payload = trimmed.includes('@') ? { email: trimmed } : { username: trimmed };
      await communitiesApi.inviteAdmin(selectedCommunity.id, payload);
      const data = await communitiesApi.getAdmins(selectedCommunity.id);
      setCommunityCommissioner(data.commissioner || null);
      setCommunityAdmins(data.admins || []);
      setCommunityAdminInvite('');
      alert('Community admin invited successfully');
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to invite community admin');
    }
  };
  
  const toggleLeague = (leagueId: number) => {
    const newExpanded = new Set(expandedLeagues);
    if (newExpanded.has(leagueId)) {
      newExpanded.delete(leagueId);
    } else {
      newExpanded.add(leagueId);
    }
    setExpandedLeagues(newExpanded);
  };

  const handleRequestToJoin = async (community: Community) => {
    setSelectedCommunity(community);
    setJoinRequestMessage('');
    setShowJoinRequestModal(true);
  };

  const handleRequestToJoinLeague = (league: League) => {
    setSelectedLeagueForJoin(league);
    setLeagueJoinMessage('');
    setShowLeagueJoinModal(true);
  };

  const submitJoinRequest = async () => {
    if (!selectedCommunity) return;
    
    try {
      await communitiesApi.requestToJoin(selectedCommunity.id, joinRequestMessage || undefined);
      alert('Join request submitted! The commissioner will review it.');
      setShowJoinRequestModal(false);
      setJoinRequestMessage('');
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to submit request');
    }
  };

  const submitLeagueJoinRequest = async () => {
    if (!selectedLeagueForJoin) return;

    try {
      await leaguesApi.requestToJoin(selectedLeagueForJoin.id, leagueJoinMessage || undefined);
      alert('League join request submitted!');
      closeLeagueJoinModal();
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to submit league join request');
    }
  };

  const closeLeagueJoinModal = () => {
    setShowLeagueJoinModal(false);
    setSelectedLeagueForJoin(null);
    setLeagueJoinMessage('');
  };
  
  const openCreateCommunityModal = (leagueId: number) => {
    setCreateCommunityForLeague(leagueId);
    setShowCreateCommunityModal(true);
  };

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!createCommunityForLeague) {
      alert('Please select a league first');
      return;
    }
    
    try {
      await communitiesApi.create(
        createCommunityForLeague,
        newCommunityName,
        newCommunityDescription,
        newCommunityBalance
      );
      
      setShowCreateCommunityModal(false);
      setNewCommunityName('');
      setNewCommunityDescription('');
      setNewCommunityBalance(1000);
      setCreateCommunityForLeague(null);
      await loadData();
      alert('Community created successfully! You are the commissioner.');
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to create community');
    }
  };

  const handleCreateLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const newLeague = await leaguesApi.create(newLeagueName, newLeagueDescription);
      setShowCreateLeagueModal(false);
      setNewLeagueName('');
      setNewLeagueDescription('');
      await loadData();
      // Expand the new league
      setExpandedLeagues(prev => new Set([...prev, newLeague.id]));
      alert('League created successfully!');
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to create league');
    }
  };

  const openInbox = async () => {
    await loadInbox();
    setShowInboxModal(true);
  };

  const handleMarkAsRead = async (messageId: number) => {
    try {
      await inboxApi.markAsRead(messageId);
      await loadInbox();
      await loadUnreadCount();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to mark as read');
    }
  };

  const openReviewModal = (message: InboxMessage) => {
    setReviewMessage(message);
    const communityId = message.metadata?.community_id as number | undefined;
    const community = communities.find(c => c.id === communityId);
    if (communityId && community) {
      setCustomBalance(parseFloat(community.starting_balance.toString()));
    } else {
      setCustomBalance(undefined);
    }
    setShowReviewModal(true);
  };

  const handleReviewAction = async (action: 'approve' | 'deny') => {
    if (!reviewMessage) return;
    
    try {
      const isCommunityRequest = !!reviewMessage.metadata?.community_id;
      await inboxApi.takeAction(
        reviewMessage.id,
        action,
        action === 'approve' && isCommunityRequest ? customBalance : undefined
      );
      
      setShowReviewModal(false);
      setReviewMessage(null);
      await loadInbox();
      await loadUnreadCount();
      alert(`Request ${action === 'approve' ? 'approved' : 'denied'} successfully!`);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to process action');
    }
  };

  const reviewCommunityName = reviewMessage?.metadata?.community_name as string | undefined;
  const reviewLeagueName = reviewMessage?.metadata?.league_name as string | undefined;
  const reviewTargetLabel = reviewCommunityName ? 'Community' : 'League';
  const reviewTargetName = reviewCommunityName || reviewLeagueName || 'Unknown';
  const reviewUsesBalance = !!reviewMessage?.metadata?.community_id;

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>🃏 Poker Platform</h1>
        <div className="user-info">
          <button onClick={openInbox} className="btn-icon inbox-btn">
            📬 Inbox {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
          </button>
          <UserMenu username={user?.username || 'User'} />
        </div>
      </header>

      {error && <div className="error-message">{error}</div>}

      <main className="dashboard-main">
        <section className="leagues-section">
          <div className="section-header">
            <h2>Leagues</h2>
            <button 
              onClick={() => setShowCreateLeagueModal(true)} 
              className="btn-primary"
            >
              + Create League
            </button>
          </div>
          
          {leagues.length === 0 ? (
            <p className="empty-state">
              "No leagues available. Create one to get started!"
            </p>
          ) : (
            <div className="leagues-list">
              {leagues.map((league) => {
                const leagueCommunities = getCommunitiesForLeague(league.id);
                const isExpanded = expandedLeagues.has(league.id);
                const isMember = isLeagueMember(league);
                const canCreateCommunity = isMember;
                const canViewLeagueSettings = isMember;
                
                return (
                  <div key={league.id} className="league-card">
                    <div 
                      className="league-header"
                      onClick={() => toggleLeague(league.id)}
                    >
                      <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                      <h3>{league.name}</h3>
                      <span className="community-count">
                        {leagueCommunities.length} {leagueCommunities.length === 1 ? 'community' : 'communities'}
                      </span>
                    </div>
                    
                    {league.description && (
                      <p className="league-description">{league.description}</p>
                    )}
                    
                    {isExpanded && (
                      <div className="league-communities">
                        {!isMember ? (
                          <div className="league-join-panel">
                            <p className="empty-state">
                              Join this league to view communities and create your own.
                            </p>
                            <div className="league-join-actions">
                              {league.has_pending_request ? (
                                <button className="btn-secondary" disabled>
                                  Pending Approval
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRequestToJoinLeague(league);
                                  }}
                                  className="btn-secondary"
                                >
                                  Request to Join
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="league-communities-header">
                              {canViewLeagueSettings && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openLeagueSettings(league);
                                  }}
                                  className="btn-secondary btn-small"
                                >
                                  Settings
                                </button>
                              )}
                              {canCreateCommunity && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openCreateCommunityModal(league.id);
                                  }}
                                  className="btn-secondary btn-small"
                                >
                                  + Create Community
                                </button>
                              )}
                            </div>
                            
                            {leagueCommunities.length === 0 ? (
                              <p className="empty-state">No communities in this league yet.</p>
                            ) : (
                              <div className="communities-grid">
                                {leagueCommunities.map((community) => (
                                  <div key={community.id} className="community-card">
                                    <h4>{community.name}</h4>
                                    <p className="description">{community.description}</p>
                                    
                                    <div className="community-info">
                                      {hasWallet(community.id) && (
                                        <div className="info-item">
                                          <span className="label">Your Balance:</span>
                                          <span className="value balance">{getWalletBalance(community.id)}</span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="card-actions">
                                      {hasWallet(community.id) ? (
                                        <button
                                          onClick={() => handleJoinGame(community.id)}
                                          className="btn-primary"
                                        >
                                          View Lobby
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => handleRequestToJoin(community)}
                                          className="btn-secondary"
                                        >
                                          Request to Join
                                        </button>
                                      )}
                                      {(hasWallet(community.id) || community.commissioner_id === user?.id) && (
                                        <button
                                          onClick={() => openCommunitySettings(community)}
                                          className="btn-secondary"
                                        >
                                          Settings
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Create Community Modal */}
      {showCreateCommunityModal && createCommunityForLeague && (
        <div className="modal-overlay" onClick={() => setShowCreateCommunityModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Community</h2>
            <p className="modal-subtitle">
              In league: {leagues.find(l => l.id === createCommunityForLeague)?.name}
            </p>
            <form onSubmit={handleCreateCommunity}>
              <div className="form-group">
                <label>Community Name</label>
                <input
                  type="text"
                  value={newCommunityName}
                  onChange={(e) => setNewCommunityName(e.target.value)}
                  placeholder="Friday Night Poker"
                  required
                  minLength={3}
                  maxLength={100}
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newCommunityDescription}
                  onChange={(e) => setNewCommunityDescription(e.target.value)}
                  placeholder="A friendly poker community"
                  maxLength={500}
                />
              </div>
              
              <div className="form-group">
                <label>Default Starting Balance (chips)</label>
                <input
                  type="number"
                  value={newCommunityBalance}
                  onChange={(e) => setNewCommunityBalance(Number(e.target.value))}
                  min={0}
                  required
                />
                <p className="helper-text">This is hidden from players. You can customize per player when approving.</p>
              </div>
              
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateCommunityModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Community
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create League Modal */}
      {showCreateLeagueModal && (
        <div className="modal-overlay" onClick={() => setShowCreateLeagueModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New League</h2>
            <form onSubmit={handleCreateLeague}>
              <div className="form-group">
                <label>League Name</label>
                <input
                  type="text"
                  value={newLeagueName}
                  onChange={(e) => setNewLeagueName(e.target.value)}
                  placeholder="My Poker League"
                  required
                  minLength={3}
                  maxLength={100}
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newLeagueDescription}
                  onChange={(e) => setNewLeagueDescription(e.target.value)}
                  placeholder="A top-level organization for my poker communities"
                  maxLength={500}
                />
              </div>
              
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateLeagueModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create League
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* League Join Request Modal */}
      {showLeagueJoinModal && selectedLeagueForJoin && (
        <div className="modal-overlay" onClick={closeLeagueJoinModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Request to Join: {selectedLeagueForJoin.name}</h2>
            <p>Your request will be sent to the league admins for approval.</p>

            <div className="form-group">
              <label>Message to Admins (optional)</label>
              <textarea
                value={leagueJoinMessage}
                onChange={(e) => setLeagueJoinMessage(e.target.value.slice(0, 250))}
                placeholder="Tell the admins about yourself..."
                maxLength={250}
              />
              <p className="helper-text">{leagueJoinMessage.length}/250 characters</p>
            </div>

            <div className="modal-actions">
              <button onClick={closeLeagueJoinModal} className="btn-secondary">
                Cancel
              </button>
              <button onClick={submitLeagueJoinRequest} className="btn-primary">
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* League Settings Modal */}
      {showLeagueSettingsModal && selectedLeague && (
        <div className="modal-overlay" onClick={closeLeagueSettings}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>League Settings</h2>
            <p className="modal-subtitle">{selectedLeague.name}</p>

            <div className="settings-section">
              <h3>Admins</h3>
              {leagueOwner ? (
                <div className="admin-row">
                  <span className="admin-role">Owner</span>
                  <span className="admin-user">
                    {leagueOwner.username} ({leagueOwner.email})
                  </span>
                </div>
              ) : (
                <p className="settings-empty">No owner assigned.</p>
              )}
              {leagueAdmins.length > 0 ? (
                <div className="admin-list">
                  {leagueAdmins.map((admin) => (
                    <div key={admin.id} className="admin-row">
                      <span className="admin-role">Admin</span>
                      <span className="admin-user">
                        {admin.username} ({admin.email})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="settings-empty">No additional admins yet.</p>
              )}
            </div>

            <form
              className="settings-section"
              onSubmit={(e) => {
                e.preventDefault();
                inviteLeagueAdmin();
              }}
            >
              <h3>Invite Admin</h3>
              <div className="form-group">
                <label>Username or Email</label>
                <input
                  type="text"
                  value={leagueAdminInvite}
                  onChange={(e) => setLeagueAdminInvite(e.target.value)}
                  placeholder="username or email"
                  disabled={!canInviteLeagueAdmins}
                />
              </div>
              {!canInviteLeagueAdmins && (
                <p className="settings-note">Only league owners or admins can invite new admins.</p>
              )}
              <div className="modal-actions">
                <button type="button" onClick={closeLeagueSettings} className="btn-secondary">
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={!canInviteLeagueAdmins}>
                  Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Community Settings Modal */}
      {showCommunitySettingsModal && selectedCommunity && (
        <div className="modal-overlay" onClick={closeCommunitySettings}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Community Settings</h2>
            <p className="modal-subtitle">{selectedCommunity.name}</p>

            <div className="settings-section">
              <h3>Admins</h3>
              {communityCommissioner ? (
                <div className="admin-row">
                  <span className="admin-role">Commissioner</span>
                  <span className="admin-user">
                    {communityCommissioner.username} ({communityCommissioner.email})
                  </span>
                </div>
              ) : (
                <p className="settings-empty">No commissioner assigned.</p>
              )}
              {communityAdmins.length > 0 ? (
                <div className="admin-list">
                  {communityAdmins.map((admin) => (
                    <div key={admin.id} className="admin-row">
                      <span className="admin-role">Admin</span>
                      <span className="admin-user">
                        {admin.username} ({admin.email})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="settings-empty">No additional admins yet.</p>
              )}
            </div>

            <form
              className="settings-section"
              onSubmit={(e) => {
                e.preventDefault();
                inviteCommunityAdmin();
              }}
            >
              <h3>Invite Admin</h3>
              <div className="form-group">
                <label>Username or Email</label>
                <input
                  type="text"
                  value={communityAdminInvite}
                  onChange={(e) => setCommunityAdminInvite(e.target.value)}
                  placeholder="username or email"
                  disabled={!canInviteCommunityAdmins}
                />
              </div>
              {!canInviteCommunityAdmins && (
                <p className="settings-note">Only community commissioners or admins can invite new admins.</p>
              )}
              <div className="modal-actions">
                <button type="button" onClick={closeCommunitySettings} className="btn-secondary">
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={!canInviteCommunityAdmins}>
                  Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Request Modal */}
      {showJoinRequestModal && selectedCommunity && (
        <div className="modal-overlay" onClick={() => setShowJoinRequestModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Request to Join: {selectedCommunity.name}</h2>
            <p>Your request will be sent to the commissioner for approval.</p>
            
            <div className="form-group">
              <label>Message to Commissioner (optional)</label>
              <textarea
                value={joinRequestMessage}
                onChange={(e) => setJoinRequestMessage(e.target.value.slice(0, 250))}
                placeholder="Tell the commissioner about yourself..."
                maxLength={250}
              />
              <p className="helper-text">{joinRequestMessage.length}/250 characters</p>
            </div>
            
            <div className="modal-actions">
              <button onClick={() => setShowJoinRequestModal(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={submitJoinRequest} className="btn-primary">
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inbox Modal */}
      {showInboxModal && (
        <div className="modal-overlay" onClick={() => setShowInboxModal(false)}>
          <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>📬 Inbox</h2>
            
            {inboxMessages.length === 0 ? (
              <p className="empty-state">No messages</p>
            ) : (
              <div className="inbox-list">
                {inboxMessages.map((message) => (
                  <div 
                    key={message.id} 
                    className={`inbox-message ${!message.is_read ? 'unread' : ''}`}
                    onClick={() => !message.is_read && handleMarkAsRead(message.id)}
                  >
                    <div className="message-header">
                      <strong>{message.title}</strong>
                      <span className="message-date">
                        {new Date(message.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="message-content">{message.content}</p>
                    <div className="message-from">From: {message.sender_username || 'System'}</div>
                    
                    {message.is_actionable && !message.action_taken && (
                      <div className="message-actions">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            openReviewModal(message);
                          }}
                          className="btn-primary btn-small"
                        >
                          Review
                        </button>
                      </div>
                    )}
                    
                    {message.action_taken && (
                      <div className="action-taken">
                        Action taken: {message.action_taken}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <div className="modal-actions">
              <button onClick={() => setShowInboxModal(false)} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Join Request Modal */}
      {showReviewModal && reviewMessage && (
        <div className="modal-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Review Join Request</h2>
            <p><strong>From:</strong> {reviewMessage.metadata?.username as string}</p>
            <p><strong>{reviewTargetLabel}:</strong> {reviewTargetName}</p>
            
            {reviewMessage.content.includes('Message:') && (
              <div className="user-message">
                <strong>Their message:</strong>
                <p>{reviewMessage.content.split('Message:')[1]}</p>
              </div>
            )}
            
            {reviewUsesBalance && (
              <div className="form-group">
                <label>Starting Chips (leave blank for community default)</label>
                <input
                  type="number"
                  value={customBalance || ''}
                  onChange={(e) => setCustomBalance(e.target.value ? Number(e.target.value) : undefined)}
                  min={0}
                  placeholder="Community default"
                />
              </div>
            )}
            
            <div className="modal-actions">
              <button 
                onClick={() => setShowReviewModal(false)} 
                className="btn-secondary"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleReviewAction('deny')} 
                className="btn-danger"
              >
                Deny
              </button>
              <button 
                onClick={() => handleReviewAction('approve')} 
                className="btn-primary"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
