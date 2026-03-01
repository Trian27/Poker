import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { communitiesApi, tablesApi, walletsApi, inboxApi } from '../api';
import { useAuth } from '../auth-context';
import type { Community, Table, Wallet, TableSeat, TableTournamentDetails, InboxMessage } from '../types';
import UserMenu from '../components/UserMenu';
import './CommunityLobby.css';
import { getApiErrorMessage, getApiErrorStatus } from '../utils/error';

const MAX_TABLE_SEATS = 8;
const LOBBY_REFRESH_INTERVAL_MS = 3000;
const INBOX_REFRESH_INTERVAL_MS = 5000;
const TOURNAMENT_PLAYER_LIMIT_OPTIONS = [2, 4, 8];
const UNREAD_COUNT_STORAGE_KEY = 'poker-inbox-unread-count';

export default function CommunityLobbyPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [community, setCommunity] = useState<Community | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [tableSeatCounts, setTableSeatCounts] = useState<Record<number, number>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [seats, setSeats] = useState<TableSeat[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [showTournamentModal, setShowTournamentModal] = useState(false);
  const [tournamentDetails, setTournamentDetails] = useState<TableTournamentDetails | null>(null);
  const [tournamentPayoutEditInput, setTournamentPayoutEditInput] = useState('');
  const [tournamentPayoutEditIsPercentage, setTournamentPayoutEditIsPercentage] = useState(true);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<InboxMessage | null>(null);
  const [customBalance, setCustomBalance] = useState<number | undefined>(undefined);
  
  // Create table form state
  const [tableName, setTableName] = useState('');
  const [gameType, setGameType] = useState<'cash' | 'tournament'>('cash');
  const [maxSeats, setMaxSeats] = useState(MAX_TABLE_SEATS);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [buyIn, setBuyIn] = useState(1000);
  const [agentsAllowed, setAgentsAllowed] = useState(true);
  const [tournamentStartTime, setTournamentStartTime] = useState('');
  const [tournamentStartingStack, setTournamentStartingStack] = useState(1000);
  const [tournamentSecurityDeposit, setTournamentSecurityDeposit] = useState(100);
  const [tournamentConfirmationWindowSeconds, setTournamentConfirmationWindowSeconds] = useState(60);
  const [tournamentBlindIntervalMinutes, setTournamentBlindIntervalMinutes] = useState(10);
  const [tournamentBlindProgressionPercent, setTournamentBlindProgressionPercent] = useState(50);
  const [tournamentPayoutIsPercentage, setTournamentPayoutIsPercentage] = useState(true);
  const [tournamentPayoutInput, setTournamentPayoutInput] = useState('');
  
  // Join table state
  const [buyInAmount, setBuyInAmount] = useState(1000);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  const parsedCommunityId = Number(communityId);
  const canUseFixedTournamentPayout = !!(user && community && (user.is_admin || community.commissioner_id === user.id));
  const canDeleteCommunity = !!(user && community && (user.is_admin || community.commissioner_id === user.id));

  const loadUnreadCount = useCallback(async () => {
    try {
      const data = await inboxApi.getUnreadCount();
      const nextCount = Number(data?.unread_count || 0);
      setUnreadCount(nextCount);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(UNREAD_COUNT_STORAGE_KEY, String(nextCount));
      }
      window.dispatchEvent(new CustomEvent('inbox-unread-updated', { detail: { count: nextCount } }));
    } catch {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const cachedCount = Number(window.localStorage.getItem(UNREAD_COUNT_STORAGE_KEY));
    if (Number.isFinite(cachedCount) && cachedCount >= 0) {
      setUnreadCount(cachedCount);
    }
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      const messages = await inboxApi.getMessages();
      setInboxMessages(Array.isArray(messages) ? messages : []);
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to load inbox'));
    }
  }, []);

  const loadData = useCallback(async (options: { showLoader?: boolean; silent?: boolean } = {}) => {
    const { showLoader = false, silent = false } = options;

    if (!Number.isFinite(parsedCommunityId) || parsedCommunityId <= 0) {
      setError('Invalid community');
      if (showLoader) {
        setLoading(false);
      }
      return;
    }

    try {
      if (showLoader) {
        setLoading(true);
      }
      if (!silent) {
        setError(null);
      }

      const [communities, wallets, tablesData] = await Promise.all([
        communitiesApi.getAll(),
        walletsApi.getAll(),
        tablesApi.getByCommunity(parsedCommunityId),
      ]);

      const comm = communities.find((c: Community) => c.id === parsedCommunityId);
      if (!comm) {
        setError('Community not found');
        setCommunity(null);
        setTables([]);
        setWallet(null);
        setTableSeatCounts({});
        return;
      }

      setCommunity(comm);
      setTables(tablesData);

      if (tablesData.length > 0) {
        const seatCountsEntries = await Promise.all(
          tablesData.map(async (table: Table) => {
            try {
              const seatsData = await tablesApi.getSeats(table.id);
              const occupiedCount = seatsData.filter((seat: TableSeat) => seat.user_id !== null).length;
              return [table.id, occupiedCount] as const;
            } catch (error) {
              console.error(`Failed to load seat count for table ${table.id}:`, error);
              return [table.id, 0] as const;
            }
          })
        );

        setTableSeatCounts(Object.fromEntries(seatCountsEntries));
      } else {
        setTableSeatCounts({});
      }

      const userWallet = wallets.find((w: Wallet) => w.community_id === parsedCommunityId);
      setWallet(userWallet || null);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to load community data');
      if (silent) {
        console.error('Background community refresh failed:', message);
      } else {
        console.error('Error loading community data:', err);
        setError(message);
      }
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [parsedCommunityId]);

  useEffect(() => {
    loadData({ showLoader: true });
  }, [loadData]);

  useEffect(() => {
    loadUnreadCount();
  }, [loadUnreadCount]);

  useEffect(() => {
    const onUnreadUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ count?: number }>;
      const nextCount = Number(customEvent.detail?.count);
      if (Number.isFinite(nextCount)) {
        setUnreadCount(nextCount);
      }
    };
    const onStorageUpdate = (event: StorageEvent) => {
      if (event.key !== UNREAD_COUNT_STORAGE_KEY || event.newValue === null) {
        return;
      }
      const nextCount = Number(event.newValue);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        setUnreadCount(nextCount);
      }
    };

    window.addEventListener('inbox-unread-updated', onUnreadUpdate as EventListener);
    window.addEventListener('storage', onStorageUpdate);
    return () => {
      window.removeEventListener('inbox-unread-updated', onUnreadUpdate as EventListener);
      window.removeEventListener('storage', onStorageUpdate);
    };
  }, []);

  useEffect(() => {
    if (!showJoinModal || !selectedTable) {
      return;
    }

    const updatedSelectedTable = tables.find((table) => table.id === selectedTable.id);
    if (!updatedSelectedTable) {
      setShowJoinModal(false);
      setSelectedTable(null);
      setSelectedSeat(null);
      setSeats([]);
      alert('This table is no longer available.');
      return;
    }

    // Keep modal table details in sync with server updates without triggering fetch loops.
    if (updatedSelectedTable !== selectedTable) {
      setSelectedTable(updatedSelectedTable);
    }
  }, [showJoinModal, selectedTable, tables]);

  useEffect(() => {
    if (!Number.isFinite(parsedCommunityId) || parsedCommunityId <= 0) {
      return;
    }

    const refreshLobbyState = () => {
      loadData({ silent: true });
    };

    const intervalId = window.setInterval(refreshLobbyState, LOBBY_REFRESH_INTERVAL_MS);
    const onWindowFocus = () => {
      refreshLobbyState();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshLobbyState();
      }
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [parsedCommunityId, loadData]);

  useEffect(() => {
    const refreshUnreadCount = () => {
      loadUnreadCount();
    };

    const intervalId = window.setInterval(refreshUnreadCount, INBOX_REFRESH_INTERVAL_MS);
    const onWindowFocus = () => {
      refreshUnreadCount();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshUnreadCount();
      }
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadUnreadCount]);

  useEffect(() => {
    if (gameType === 'tournament' && !TOURNAMENT_PLAYER_LIMIT_OPTIONS.includes(maxSeats)) {
      setMaxSeats(8);
    }
  }, [gameType, maxSeats]);

  useEffect(() => {
    if (gameType === 'tournament') {
      setTournamentSecurityDeposit(Math.max(0, Math.ceil((buyIn || 0) * 0.1)));
    }
  }, [buyIn, gameType]);

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedPayout = tournamentPayoutInput
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (gameType === 'tournament') {
      if (!tournamentStartTime) {
        alert('Tournament start time is required.');
        return;
      }
      const start = new Date(tournamentStartTime);
      if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
        alert('Tournament start time must be in the future.');
        return;
      }
      if (!TOURNAMENT_PLAYER_LIMIT_OPTIONS.includes(maxSeats)) {
        alert('Tournament player limit must be 2, 4, or 8.');
        return;
      }
      if (buyIn < 0) {
        alert('Tournament buy-in cannot be negative.');
        return;
      }
      if (bigBlind < smallBlind) {
        alert('Big blind must be greater than or equal to small blind.');
        return;
      }
      if (!tournamentPayoutIsPercentage && !canUseFixedTournamentPayout) {
        alert('Only the community commissioner or a global admin can set fixed payout amounts.');
        return;
      }
      if (tournamentPayoutIsPercentage && normalizedPayout.length > 0) {
        const totalPercentage = normalizedPayout.reduce((sum, value) => sum + value, 0);
        if (totalPercentage > 100) {
          alert('Payout percentages cannot exceed 100% total.');
          return;
        }
      }
      if (!tournamentPayoutIsPercentage && normalizedPayout.length === 0 && canUseFixedTournamentPayout) {
        alert('Provide at least one fixed payout amount or switch to percentage mode.');
        return;
      }
    } else {
      if (buyIn <= 0) {
        alert('Cash game buy-in must be greater than zero.');
        return;
      }
      if (bigBlind < smallBlind) {
        alert('Big blind must be greater than or equal to small blind.');
        return;
      }
    }
    
    try {
      await tablesApi.create(Number(communityId), {
        name: tableName,
        game_type: gameType,
        max_seats: maxSeats,
        small_blind: smallBlind,
        big_blind: bigBlind,
        buy_in: buyIn,
        agents_allowed: agentsAllowed,
        tournament_start_time: gameType === 'tournament' ? new Date(tournamentStartTime).toISOString() : undefined,
        tournament_starting_stack: gameType === 'tournament' ? tournamentStartingStack : undefined,
        tournament_security_deposit: gameType === 'tournament' ? Math.max(0, Math.floor(tournamentSecurityDeposit)) : undefined,
        tournament_confirmation_window_seconds: gameType === 'tournament'
          ? Math.max(30, Math.min(300, Math.floor(tournamentConfirmationWindowSeconds)))
          : undefined,
        tournament_blind_interval_minutes: gameType === 'tournament'
          ? Math.max(2, Math.min(120, Math.floor(tournamentBlindIntervalMinutes)))
          : undefined,
        tournament_blind_progression_percent: gameType === 'tournament'
          ? Math.max(10, Math.min(300, Math.floor(tournamentBlindProgressionPercent)))
          : undefined,
        tournament_payout: gameType === 'tournament' && normalizedPayout.length > 0
          ? normalizedPayout
          : undefined,
        tournament_payout_is_percentage: gameType === 'tournament' ? tournamentPayoutIsPercentage : undefined,
      });
      
      // Reset form
      setTableName('');
      setGameType('cash');
      setSmallBlind(10);
      setBigBlind(20);
      setBuyIn(1000);
      setMaxSeats(MAX_TABLE_SEATS);
      setAgentsAllowed(true);
      setTournamentStartTime('');
      setTournamentStartingStack(1000);
      setTournamentSecurityDeposit(100);
      setTournamentConfirmationWindowSeconds(60);
      setTournamentBlindIntervalMinutes(10);
      setTournamentBlindProgressionPercent(50);
      setTournamentPayoutIsPercentage(true);
      setTournamentPayoutInput('');
      setShowCreateModal(false);
      
      // Reload tables
      await loadData({ silent: true });
      
      alert('Table created successfully!');
    } catch (err: unknown) {
      console.error('Error creating table:', err);
      alert(getApiErrorMessage(err, 'Failed to create table'));
    }
  };

  const openInbox = async () => {
    await loadInbox();
    await loadUnreadCount();
    setShowInboxModal(true);
  };

  const handleMarkAsRead = async (messageId: number) => {
    try {
      await inboxApi.markAsRead(messageId);
      await loadInbox();
      await loadUnreadCount();
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to mark as read'));
    }
  };

  const handleDeleteCommunity = async () => {
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
      navigate('/dashboard');
      return;
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to delete community'));
    }
  };

  const openReviewModal = (message: InboxMessage) => {
    setReviewMessage(message);
    const metadataCommunityId = typeof message.metadata?.community_id === 'number'
      ? message.metadata.community_id
      : Number(message.metadata?.community_id);
    if (Number.isFinite(metadataCommunityId) && community && community.id === metadataCommunityId) {
      setCustomBalance(parseFloat(community.starting_balance.toString()));
    } else {
      setCustomBalance(undefined);
    }
    setShowReviewModal(true);
  };

  const handleReviewAction = async (action: 'approve' | 'deny') => {
    if (!reviewMessage) return;

    try {
      const metadataCommunityId = typeof reviewMessage.metadata?.community_id === 'number'
        ? reviewMessage.metadata.community_id
        : Number(reviewMessage.metadata?.community_id);
      const usesCustomBalance = Number.isFinite(metadataCommunityId);

      await inboxApi.takeAction(
        reviewMessage.id,
        action,
        action === 'approve' && usesCustomBalance ? customBalance : undefined
      );

      setShowReviewModal(false);
      setReviewMessage(null);
      await loadInbox();
      await loadUnreadCount();
      alert(`Request ${action === 'approve' ? 'approved' : 'denied'} successfully.`);
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to process request action'));
    }
  };

  const handleJoinTable = async () => {
    if (!selectedTable || selectedSeat === null) return;
    if (selectedTable.game_type !== 'tournament' && !wallet) return;
    const currentWallet = wallet;

    if (selectedTable.game_type !== 'tournament') {
      const walletBalance = typeof currentWallet!.balance === 'string'
        ? parseFloat(currentWallet!.balance)
        : currentWallet!.balance;

      if (buyInAmount > walletBalance) {
        alert(`Insufficient funds! You have ${walletBalance} chips but need ${buyInAmount}.`);
        return;
      }

      if (buyInAmount < selectedTable.buy_in) {
        alert(`Minimum buy-in is ${selectedTable.buy_in} chips.`);
        return;
      }
    } else {
      const tournamentState = selectedTable.tournament_state;
      if (tournamentState !== 'running') {
        alert(`Tournament is not running yet (current state: ${tournamentState || 'scheduled'}).`);
        return;
      }
      if (!selectedTable.tournament_is_registered) {
        alert('You must register for this tournament before joining.');
        return;
      }
    }
    
    try {
      const tournamentStack = selectedTable.tournament_starting_stack || 1000;
      const response = await tablesApi.join(
        selectedTable.id,
        selectedTable.game_type === 'tournament' ? tournamentStack : buyInAmount,
        selectedSeat
      );
      
      alert(response.message);
      setShowJoinModal(false);
      
      // Navigate to game table
      const communityQuery = Number.isFinite(parsedCommunityId) && parsedCommunityId > 0
        ? `?communityId=${parsedCommunityId}`
        : '';
      navigate(`/game/${selectedTable.id}${communityQuery}`);
      
    } catch (err: unknown) {
      console.error('Error joining table:', err);
      if (getApiErrorStatus(err) === 404) {
        setShowJoinModal(false);
        setSelectedTable(null);
        setSelectedSeat(null);
        setSeats([]);
        await loadData({ silent: true });
        alert('This table is no longer available.');
        return;
      }
      alert(getApiErrorMessage(err, 'Failed to join table'));
    }
  };

  const openJoinModal = async (table: Table) => {
    setSelectedTable(table);
    setBuyInAmount(table.game_type === 'tournament' ? (table.tournament_starting_stack || 1000) : table.buy_in);
    setSelectedSeat(null);
    setShowJoinModal(true);
    await loadSeats(table, true);
  };

  const handleRegisterTournament = async (table: Table) => {
    try {
      const response = await tablesApi.registerTournament(table.id);
      await loadData({ silent: true });
      if (response?.total_paid !== undefined) {
        alert(`Tournament registration complete. Charged ${response.total_paid} chips (entry + security deposit).`);
      } else {
        alert('Tournament registration complete.');
      }
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to register for tournament'));
    }
  };

  const handleConfirmTournament = async (table: Table) => {
    try {
      await tablesApi.confirmTournament(table.id);
      await loadData({ silent: true });
      alert('Tournament participation confirmed.');
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to confirm tournament entry'));
    }
  };

  const handleUnregisterTournament = async (table: Table) => {
    try {
      await tablesApi.unregisterTournament(table.id);
      await loadData({ silent: true });
      alert('Tournament registration canceled.');
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to cancel tournament registration'));
    }
  };

  const openTournamentDetails = async (table: Table) => {
    try {
      const details = await tablesApi.getTournamentDetails(table.id);
      setTournamentDetails(details);
      setTournamentPayoutEditInput(details.payout.join(','));
      setTournamentPayoutEditIsPercentage(details.payout_is_percentage);
      setShowTournamentModal(true);
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to load tournament details'));
    }
  };

  const handleUpdateTournamentPayout = async () => {
    if (!tournamentDetails || !tournamentDetails.can_set_payout) {
      return;
    }

    const normalized = tournamentPayoutEditInput
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    try {
      await tablesApi.updateTournamentPayout(tournamentDetails.table_id, normalized, tournamentPayoutEditIsPercentage);
      const refreshedDetails = await tablesApi.getTournamentDetails(tournamentDetails.table_id);
      setTournamentDetails(refreshedDetails);
      setTournamentPayoutEditInput(refreshedDetails.payout.join(','));
      setTournamentPayoutEditIsPercentage(refreshedDetails.payout_is_percentage);
      await loadData({ silent: true });
      alert('Tournament payout updated.');
    } catch (err: unknown) {
      alert(getApiErrorMessage(err, 'Failed to update tournament payout'));
    }
  };

  const formatDateTime = (iso?: string | null): string => {
    if (!iso) return 'Not scheduled';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Not scheduled';
    return date.toLocaleString();
  };

  const loadSeats = useCallback(async (table: Table, showLoading: boolean = false) => {
    if (showLoading) {
      setLoadingSeats(true);
    }

    try {
      const seatsData = await tablesApi.getSeats(table.id);
      const filteredSeats = seatsData
        .filter((seat: TableSeat) => seat.seat_number <= table.max_seats)
        .sort((a: TableSeat, b: TableSeat) => a.seat_number - b.seat_number);

      setSeats(filteredSeats);
      setTableSeatCounts((previous) => ({
        ...previous,
        [table.id]: filteredSeats.filter((seat: TableSeat) => seat.user_id !== null).length,
      }));

      if (selectedSeat !== null && !filteredSeats.some((seat: TableSeat) => seat.seat_number === selectedSeat && seat.user_id === null)) {
        setSelectedSeat(null);
      }
    } catch (err: unknown) {
      console.error('Error loading seats:', err);
      if (getApiErrorStatus(err) === 404) {
        setShowJoinModal(false);
        setSelectedTable(null);
        setSelectedSeat(null);
        setSeats([]);
        await loadData({ silent: true });
        alert('This table is no longer available.');
        return;
      }
      if (showLoading) {
        alert('Failed to load seat information');
      }
    } finally {
      if (showLoading) {
        setLoadingSeats(false);
      }
    }
  }, [loadData, selectedSeat]);

  useEffect(() => {
    if (!showJoinModal || !selectedTable) {
      return;
    }

    const refreshSeats = () => {
      loadSeats(selectedTable, false);
    };

    const intervalId = window.setInterval(refreshSeats, 3000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [showJoinModal, selectedTable, loadSeats]);

  const getSeatPositionStyle = (seatIndex: number, totalSeats: number): CSSProperties => {
    const normalizedSeats = Math.max(totalSeats, 2);
    const angle = (seatIndex / normalizedSeats) * (Math.PI * 2) - Math.PI / 2;
    const radiusXPercent = 40;
    const radiusYPercent = 36;

    return {
      left: `${50 + Math.cos(angle) * radiusXPercent}%`,
      top: `${50 + Math.sin(angle) * radiusYPercent}%`,
    };
  };

  const reviewCommunityName = typeof reviewMessage?.metadata?.community_name === 'string'
    ? reviewMessage.metadata.community_name
    : undefined;
  const reviewLeagueName = typeof reviewMessage?.metadata?.league_name === 'string'
    ? reviewMessage.metadata.league_name
    : undefined;
  const reviewTargetLabel = reviewCommunityName ? 'Community' : 'League';
  const reviewTargetName = reviewCommunityName || reviewLeagueName || 'Unknown';
  const reviewUsesBalance = typeof reviewMessage?.metadata?.community_id === 'number'
    || Number.isFinite(Number(reviewMessage?.metadata?.community_id));

  if (loading) {
    return (
      <div className="community-lobby">
        <div className="loading">Loading community...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="community-lobby">
        <div className="error">{error}</div>
        <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="community-lobby">
        <div className="error">Community not found</div>
        <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="community-lobby">
      <div className="lobby-header">
        <div className="lobby-header-top">
          <button className="back-button" onClick={() => navigate('/dashboard')}>
            ← Back
          </button>
          <div className="lobby-user-actions">
            <button onClick={openInbox} className="community-inbox-btn">
              📬 Inbox {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
            </button>
            <UserMenu username={user?.username || 'User'} />
          </div>
        </div>
        <h1>{community.name}</h1>
        <p>{community.description}</p>
        
        {wallet && (
          <div className="wallet-balance">
            💰 Balance: <strong>{typeof wallet.balance === 'string' ? wallet.balance : wallet.balance.toFixed(2)}</strong> chips
          </div>
        )}
        
        {!wallet && (
          <div className="no-wallet">
            <p>You haven't joined this community yet.</p>
            <button onClick={async () => {
              try {
                await communitiesApi.join(Number(communityId));
                await loadData();
                alert('Successfully joined community!');
              } catch (err: unknown) {
                alert(getApiErrorMessage(err, 'Failed to join community'));
              }
            }}>
              Join Community
            </button>
          </div>
        )}
      </div>

      <div className="lobby-actions">
        <button 
          className="create-table-button"
          onClick={() => setShowCreateModal(true)}
          disabled={!wallet}
        >
          + Create Table
        </button>
        {canDeleteCommunity && (
          <button
            className="delete-community-button"
            onClick={handleDeleteCommunity}
          >
            Delete Community
          </button>
        )}
      </div>

      <div className="tables-section">
        <h2>Available Tables ({tables.length})</h2>
        
        {tables.length === 0 ? (
          <div className="no-tables">
            <p>No tables available. Create one to get started!</p>
          </div>
        ) : (
          <div className="tables-grid">
            {tables.map((table) => (
              <div key={table.id} className={`table-card ${table.status}`}>
                <div className="table-header">
                  <h3>{table.name}</h3>
                  <span className={`table-type ${table.game_type}`}>
                    {table.game_type === 'cash' ? '💵 Cash Game' : '🏆 Tournament'}
                  </span>
                </div>
                
                <div className="table-info">
                  <div className="info-row">
                    <span>Blinds:</span>
                    <strong>{table.small_blind}/{table.big_blind}</strong>
                  </div>
                  <div className="info-row">
                    <span>Buy-in:</span>
                    <strong>{table.buy_in} chips</strong>
                  </div>
                  {table.game_type === 'tournament' && (
                    <>
                      <div className="info-row">
                        <span>Starts:</span>
                        <strong>{formatDateTime(table.tournament_start_time)}</strong>
                      </div>
                      <div className="info-row">
                        <span>Tournament:</span>
                        <span className={`community-status-badge ${table.tournament_state || 'waiting'}`}>
                          {table.tournament_state || 'scheduled'}
                        </span>
                      </div>
                      <div className="info-row">
                        <span>Registrations:</span>
                        <strong>{table.tournament_registration_count ?? 0}/{table.max_seats}</strong>
                      </div>
                      <div className="info-row">
                        <span>Security Deposit:</span>
                        <strong>{table.tournament_security_deposit ?? Math.ceil((table.buy_in || 0) * 0.1)} chips</strong>
                      </div>
                      <div className="info-row">
                        <span>Payout Mode:</span>
                        <strong>{table.tournament_payout_is_percentage === false ? 'Fixed chips' : 'Percentage'}</strong>
                      </div>
                      <div className="info-row">
                        <span>Prize Pool:</span>
                        <strong>{table.tournament_prize_pool ?? 0} chips</strong>
                      </div>
                    </>
                  )}
                  <div className="info-row">
                    <span>Seats:</span>
                    <strong>{tableSeatCounts[table.id] ?? 0}/{table.max_seats}</strong>
                  </div>
                  <div className="info-row">
                    <span>Agents:</span>
                    <span className={`agent-badge ${table.agents_allowed !== false ? 'allowed' : 'not-allowed'}`}>
                      {table.agents_allowed !== false ? '🤖 Allowed' : '🚫 Humans Only'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span>Status:</span>
                    <span className={`community-status-badge ${table.status}`}>
                      {table.status}
                    </span>
                  </div>
                </div>

                {table.game_type === 'tournament' ? (
                  <div className="tournament-actions">
                    <button
                      className="join-button secondary"
                      onClick={() => openTournamentDetails(table)}
                    >
                      View Tournament Details
                    </button>
                    {!table.tournament_is_registered && (table.tournament_state === 'scheduled' || table.tournament_state === 'waiting_for_players' || !table.tournament_state) && (
                      <button
                        className="join-button"
                        onClick={() => handleRegisterTournament(table)}
                        disabled={!wallet}
                      >
                        Register Tournament
                      </button>
                    )}
                    {table.tournament_is_registered && (table.tournament_state === 'scheduled' || table.tournament_state === 'waiting_for_players' || !table.tournament_state) && (
                      <button
                        className="join-button secondary"
                        onClick={() => handleUnregisterTournament(table)}
                        disabled={!wallet}
                      >
                        Cancel Registration
                      </button>
                    )}
                    {table.tournament_is_registered && table.tournament_state === 'awaiting_confirmations' && (
                      <button
                        className="join-button"
                        onClick={() => handleConfirmTournament(table)}
                        disabled={!wallet}
                      >
                        Confirm Entry
                      </button>
                    )}
                    {table.tournament_state === 'running' && (
                      <button
                        className="join-button"
                        onClick={() => openJoinModal(table)}
                        disabled={!wallet || !table.tournament_is_registered || table.status === 'finished'}
                      >
                        Enter Tournament
                      </button>
                    )}
                    {table.tournament_state === 'completed' && (
                      <button className="join-button" disabled>
                        Tournament Complete
                      </button>
                    )}
                    {table.tournament_state === 'canceled' && (
                      <button className="join-button" disabled>
                        Tournament Canceled
                      </button>
                    )}
                  </div>
                ) : (
                  <button 
                    className="join-button"
                    onClick={() => openJoinModal(table)}
                    disabled={!wallet || table.status === 'finished'}
                  >
                    {table.status === 'finished' ? 'Finished' : 'Join Table'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Table Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Table</h2>
              <button className="close-button" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleCreateTable}>
              <div className="form-group">
                <label>Table Name</label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="e.g., High Stakes Table"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Game Type</label>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      value="cash"
                      checked={gameType === 'cash'}
                      onChange={(e) => setGameType(e.target.value as 'cash')}
                    />
                    Cash Game
                  </label>
                  <label>
                    <input
                      type="radio"
                      value="tournament"
                      checked={gameType === 'tournament'}
                      onChange={(e) => setGameType(e.target.value as 'tournament')}
                    />
                    Tournament
                  </label>
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>{gameType === 'cash' ? 'Small Blind' : 'Starting Small Blind'}</label>
                  <input
                    type="number"
                    value={smallBlind}
                    onChange={(e) => setSmallBlind(Math.max(1, Number(e.target.value) || 1))}
                    min="1"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>{gameType === 'cash' ? 'Big Blind' : 'Starting Big Blind'}</label>
                  <input
                    type="number"
                    value={bigBlind}
                    onChange={(e) => setBigBlind(Math.max(1, Number(e.target.value) || 1))}
                    min="1"
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>{gameType === 'cash' ? 'Buy-in Amount' : 'Entry Fee (can be 0)'}</label>
                  <input
                    type="number"
                    value={buyIn}
                    onChange={(e) => setBuyIn(Number(e.target.value))}
                    min={gameType === 'cash' ? '1' : '0'}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>{gameType === 'cash' ? 'Max Seats' : 'Player Limit'}</label>
                  {gameType === 'cash' ? (
                    <input
                      type="number"
                      value={maxSeats}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isNaN(value)) {
                          return;
                        }
                        setMaxSeats(Math.max(2, Math.min(MAX_TABLE_SEATS, value)));
                      }}
                      min="2"
                      max={MAX_TABLE_SEATS}
                      required
                    />
                  ) : (
                    <select
                      value={maxSeats}
                      onChange={(e) => setMaxSeats(Number(e.target.value))}
                      required
                    >
                      {TOURNAMENT_PLAYER_LIMIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} players
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {gameType === 'tournament' && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Scheduled Start Time</label>
                      <input
                        type="datetime-local"
                        value={tournamentStartTime}
                        onChange={(e) => setTournamentStartTime(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Starting Stack</label>
                      <input
                        type="number"
                        value={tournamentStartingStack}
                        onChange={(e) => setTournamentStartingStack(Math.max(100, Number(e.target.value) || 1000))}
                        min="100"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Security Deposit</label>
                      <input
                        type="number"
                        value={tournamentSecurityDeposit}
                        onChange={(e) => setTournamentSecurityDeposit(Math.max(0, Number(e.target.value) || 0))}
                        min="0"
                        step="1"
                      />
                      <small>Default is 10% of buy-in.</small>
                    </div>
                    <div className="form-group">
                      <label>Final Confirmation Window (seconds)</label>
                      <input
                        type="number"
                        value={tournamentConfirmationWindowSeconds}
                        onChange={(e) => setTournamentConfirmationWindowSeconds(Math.max(30, Number(e.target.value) || 60))}
                        min="30"
                        max="300"
                        step="1"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Blind Level Interval (minutes)</label>
                      <input
                        type="number"
                        value={tournamentBlindIntervalMinutes}
                        onChange={(e) => setTournamentBlindIntervalMinutes(Math.max(2, Number(e.target.value) || 10))}
                        min="2"
                        max="120"
                        step="1"
                      />
                    </div>
                    <div className="form-group">
                      <label>Blind Increase (% per level)</label>
                      <input
                        type="number"
                        value={tournamentBlindProgressionPercent}
                        onChange={(e) => setTournamentBlindProgressionPercent(Math.max(10, Number(e.target.value) || 50))}
                        min="10"
                        max="300"
                        step="1"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Payout Mode</label>
                    <div className="radio-group">
                      <label>
                        <input
                          type="radio"
                          checked={tournamentPayoutIsPercentage}
                          onChange={() => setTournamentPayoutIsPercentage(true)}
                        />
                        Percentage of prize pool
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={!tournamentPayoutIsPercentage}
                          onChange={() => setTournamentPayoutIsPercentage(false)}
                          disabled={!canUseFixedTournamentPayout}
                        />
                        Fixed chip amounts
                      </label>
                    </div>
                    {!canUseFixedTournamentPayout && (
                      <small>Only community commissioners and global admins can use fixed chip payouts.</small>
                    )}
                  </div>

                  <div className="form-group">
                    <label>
                      Payout Structure (comma separated {tournamentPayoutIsPercentage ? 'percentages' : 'chip amounts'})
                    </label>
                    <input
                      type="text"
                      value={tournamentPayoutInput}
                      onChange={(e) => setTournamentPayoutInput(e.target.value)}
                      placeholder={tournamentPayoutIsPercentage ? 'e.g., 60,30,10' : 'e.g., 5000,3000,2000'}
                      disabled={!tournamentPayoutIsPercentage && !canUseFixedTournamentPayout}
                    />
                    <small>
                      {tournamentPayoutIsPercentage
                        ? 'Defaults to 60,30,10 if left blank.'
                        : 'Fixed payout total can exceed buy-ins only for commissioners/global admins.'}
                    </small>
                  </div>
                </>
              )}
              
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={agentsAllowed}
                    onChange={(e) => setAgentsAllowed(e.target.checked)}
                  />
                  <span className="checkbox-text">
                    🤖 Allow Autonomous Agents (Bots)
                  </span>
                </label>
                <p className="checkbox-hint">
                  When enabled, AI poker agents can join this table
                </p>
              </div>
              
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Create Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Table Modal */}
      {showJoinModal && selectedTable && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-content seat-selection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Join {selectedTable.name}</h2>
              <button className="close-button" onClick={() => setShowJoinModal(false)}>×</button>
            </div>
            
            <div className="join-info">
              <p><strong>Game Type:</strong> {selectedTable.game_type === 'cash' ? 'Cash Game' : 'Tournament'}</p>
              <p><strong>Blinds:</strong> {selectedTable.small_blind}/{selectedTable.big_blind}</p>
              {selectedTable.game_type === 'cash' ? (
                <p><strong>Minimum Buy-in:</strong> {selectedTable.buy_in} chips</p>
              ) : (
                <>
                  <p><strong>Entry Fee:</strong> {selectedTable.buy_in} chips</p>
                  <p><strong>Starting Stack:</strong> {selectedTable.tournament_starting_stack || 1000} chips</p>
                </>
              )}
              {wallet && (
                <p><strong>Your Balance:</strong> {typeof wallet.balance === 'string' ? wallet.balance : wallet.balance.toFixed(2)} chips</p>
              )}
            </div>
            
            {selectedTable.game_type === 'cash' && (
              <div className="form-group">
                <label>Buy-in Amount</label>
                <input
                  type="number"
                  value={buyInAmount}
                  onChange={(e) => setBuyInAmount(Number(e.target.value))}
                  min={selectedTable.buy_in}
                  max={wallet ? (typeof wallet.balance === 'string' ? parseFloat(wallet.balance) : wallet.balance) : 0}
                  step="1"
                />
                <small>Minimum: {selectedTable.buy_in} chips</small>
              </div>
            )}

            {/* Seat Selection */}
            <div className="seat-selection">
              <h3>Select Your Seat</h3>
              {loadingSeats ? (
                <div className="loading-seats">Loading available seats...</div>
              ) : (
                <div className="poker-table-visual">
                  <div className="table-felt">
                    {seats.map((seat, seatIndex) => {
                      const isTakenByMe = seat.user_id !== null && seat.user_id === user?.id;
                      const isOccupied = seat.user_id !== null && !isTakenByMe;
                      const isSelected = selectedSeat === seat.seat_number;
                      const seatPositionStyle = getSeatPositionStyle(seatIndex, seats.length);
                      
                      return (
                        <div key={seat.id} className="seat-slot" style={seatPositionStyle}>
                          <button
                            className={`seat-button ${isOccupied ? 'occupied' : 'available'} ${isTakenByMe ? 'yours' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => !isOccupied && setSelectedSeat(seat.seat_number)}
                            disabled={isOccupied}
                            title={
                              isOccupied
                                ? `Occupied by ${seat.username}`
                                : isTakenByMe
                                  ? `Seat ${seat.seat_number} - Your current seat`
                                  : `Seat ${seat.seat_number} - Available`
                            }
                          >
                            <div className="seat-number">{seat.seat_number}</div>
                            {isOccupied || isTakenByMe ? (
                              <div className="seat-player">
                                <div className="seat-player-avatar">👤</div>
                                <div className="seat-player-name">{isTakenByMe ? `${seat.username} (You)` : seat.username}</div>
                              </div>
                            ) : (
                              <div className="seat-empty">
                                {isSelected ? '✓' : '+'}
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedSeat !== null && (
                <div className="seat-selected-info">
                  ✅ Seat {selectedSeat} selected
                </div>
              )}
            </div>
            
            <div className="modal-actions">
              <button type="button" onClick={() => setShowJoinModal(false)}>
                Cancel
              </button>
                <button 
                  type="button" 
                  className="primary"
                  onClick={handleJoinTable}
                  disabled={selectedSeat === null || loadingSeats}
                >
                  {selectedSeat === null
                    ? 'Select a seat'
                    : selectedTable.game_type === 'tournament'
                      ? `Enter at Seat ${selectedSeat}`
                      : `Join at Seat ${selectedSeat} with ${buyInAmount} chips`}
                </button>
              </div>
            </div>
        </div>
      )}

      {showInboxModal && (
        <div className="community-inbox-overlay" onClick={() => setShowInboxModal(false)}>
          <div className="community-inbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="community-inbox-header">
              <h2>📬 Inbox</h2>
              <button className="close-button" onClick={() => setShowInboxModal(false)}>×</button>
            </div>
            {inboxMessages.length === 0 ? (
              <p className="community-inbox-empty">No messages</p>
            ) : (
              <div className="community-inbox-list">
                {inboxMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`community-inbox-message ${!message.is_read ? 'unread' : ''}`}
                    onClick={() => !message.is_read && handleMarkAsRead(message.id)}
                  >
                    <div className="community-inbox-title-row">
                      <strong>{message.title}</strong>
                      <span>{new Date(message.created_at).toLocaleDateString()}</span>
                    </div>
                    <p>{message.content}</p>
                    <div className="community-inbox-from">From: {message.sender_username || 'System'}</div>
                    {message.is_actionable && !message.action_taken && (
                      <div className="message-actions">
                        <button
                          type="button"
                          className="btn-primary btn-small"
                          onClick={(event) => {
                            event.stopPropagation();
                            openReviewModal(message);
                          }}
                        >
                          Review
                        </button>
                      </div>
                    )}
                    {message.action_taken && (
                      <div className="action-taken">Action taken: {message.action_taken}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showReviewModal && reviewMessage && (
        <div className="community-review-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="community-review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Review Join Request</h2>
              <button className="close-button" onClick={() => setShowReviewModal(false)}>×</button>
            </div>
            <div className="join-info">
              <p><strong>From:</strong> {String(reviewMessage.metadata?.username || reviewMessage.sender_username || 'Unknown')}</p>
              <p><strong>{reviewTargetLabel}:</strong> {reviewTargetName}</p>
              {reviewMessage.content.includes('Message:') && (
                <>
                  <p><strong>Their message:</strong></p>
                  <p>{reviewMessage.content.split('Message:')[1].trim()}</p>
                </>
              )}
            </div>

            {reviewUsesBalance && (
              <div className="form-group">
                <label>Starting Chips (leave blank for community default)</label>
                <input
                  type="number"
                  value={customBalance ?? ''}
                  onChange={(event) => setCustomBalance(event.target.value ? Number(event.target.value) : undefined)}
                  min={0}
                  placeholder="Community default"
                />
              </div>
            )}

            <div className="modal-actions">
              <button type="button" onClick={() => setShowReviewModal(false)}>Cancel</button>
              <button type="button" onClick={() => handleReviewAction('deny')}>Deny</button>
              <button type="button" className="primary" onClick={() => handleReviewAction('approve')}>Approve</button>
            </div>
          </div>
        </div>
      )}

      {showTournamentModal && tournamentDetails && (
        <div className="modal-overlay" onClick={() => setShowTournamentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{tournamentDetails.table_name} Tournament</h2>
              <button className="close-button" onClick={() => setShowTournamentModal(false)}>×</button>
            </div>
            <div className="join-info">
              <p><strong>State:</strong> {tournamentDetails.state}</p>
              <p><strong>Start Time:</strong> {formatDateTime(tournamentDetails.start_time)}</p>
              <p><strong>Confirmation Deadline:</strong> {formatDateTime(tournamentDetails.confirmation_deadline)}</p>
              <p><strong>Entry Fee:</strong> {tournamentDetails.buy_in} chips</p>
              <p><strong>Security Deposit:</strong> {tournamentDetails.security_deposit} chips</p>
              <p><strong>Starting Stack:</strong> {tournamentDetails.starting_stack} chips</p>
              <p><strong>Blind Interval:</strong> {tournamentDetails.blind_interval_minutes} minutes</p>
              <p><strong>Blind Increase:</strong> {tournamentDetails.blind_progression_percent}% per level</p>
              <p><strong>Registrations:</strong> {tournamentDetails.registration_count}/{tournamentDetails.max_players}</p>
              <p><strong>Prize Pool:</strong> {tournamentDetails.prize_pool} chips</p>
              <p>
                <strong>Payout:</strong>{' '}
                {tournamentDetails.payout.length > 0
                  ? `${tournamentDetails.payout.join(', ')} ${tournamentDetails.payout_is_percentage ? '(%)' : '(chips)'}`
                  : 'Not set'}
              </p>
            </div>

            {tournamentDetails.can_set_payout && (
              <div className="form-group">
                <label>Payout Mode</label>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      checked={tournamentPayoutEditIsPercentage}
                      onChange={() => setTournamentPayoutEditIsPercentage(true)}
                    />
                    Percentage
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={!tournamentPayoutEditIsPercentage}
                      onChange={() => setTournamentPayoutEditIsPercentage(false)}
                      disabled={!canUseFixedTournamentPayout}
                    />
                    Fixed chips
                  </label>
                </div>
                {!canUseFixedTournamentPayout && (
                  <small>Only community commissioners and global admins can set fixed chip payouts.</small>
                )}
                <label>Update Payout (comma separated)</label>
                <input
                  type="text"
                  value={tournamentPayoutEditInput}
                  onChange={(e) => setTournamentPayoutEditInput(e.target.value)}
                  placeholder={tournamentPayoutEditIsPercentage ? 'e.g., 60,30,10' : 'e.g., 5000,3000,2000'}
                  disabled={!tournamentPayoutEditIsPercentage && !canUseFixedTournamentPayout}
                />
                <small>
                  {tournamentPayoutEditIsPercentage
                    ? 'Leave empty to reset to 60,30,10.'
                    : 'Leave empty to clear fixed payout amounts.'}
                </small>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={handleUpdateTournamentPayout}
                    disabled={!canUseFixedTournamentPayout && !tournamentPayoutEditIsPercentage}
                  >
                    Save Payout
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Registered Players</label>
              {tournamentDetails.registrations.length === 0 ? (
                <p>No players registered yet.</p>
              ) : (
                <ul>
                  {tournamentDetails.registrations.map((entry) => (
                    <li key={`${entry.table_id}-${entry.user_id}`}>
                      {entry.username} ({entry.status}; entry: {entry.paid_entry_fee}, deposit: {entry.paid_security_deposit}, stack: {entry.starting_stack})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="form-group">
              <label>Bracket JSON</label>
              <pre className="tournament-bracket-json">
                {JSON.stringify(tournamentDetails.bracket || {}, null, 2)}
              </pre>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setShowTournamentModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
