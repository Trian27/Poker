import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { communitiesApi, tablesApi, walletsApi } from '../api';
import { useAuth } from '../AuthContext';
import type { Community, Table, Wallet, TableSeat } from '../types';
import './CommunityLobby.css';

const MAX_TABLE_SEATS = 8;
const LOBBY_REFRESH_INTERVAL_MS = 3000;

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
  
  // Create table form state
  const [tableName, setTableName] = useState('');
  const [gameType, setGameType] = useState<'cash' | 'tournament'>('cash');
  const [maxSeats, setMaxSeats] = useState(MAX_TABLE_SEATS);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [buyIn, setBuyIn] = useState(1000);
  const [agentsAllowed, setAgentsAllowed] = useState(true);
  
  // Join table state
  const [buyInAmount, setBuyInAmount] = useState(1000);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  const parsedCommunityId = Number(communityId);

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
    } catch (err: any) {
      const message = err.response?.data?.detail || 'Failed to load community data';
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

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await tablesApi.create(Number(communityId), {
        name: tableName,
        game_type: gameType,
        max_seats: maxSeats,
        small_blind: smallBlind,
        big_blind: bigBlind,
        buy_in: buyIn,
        agents_allowed: agentsAllowed,
      });
      
      // Reset form
      setTableName('');
      setAgentsAllowed(true);
      setShowCreateModal(false);
      
      // Reload tables
      await loadData({ silent: true });
      
      alert('Table created successfully!');
    } catch (err: any) {
      console.error('Error creating table:', err);
      alert(err.response?.data?.detail || 'Failed to create table');
    }
  };

  const handleJoinTable = async () => {
    if (!selectedTable || !wallet || selectedSeat === null) return;
    
    const walletBalance = typeof wallet.balance === 'string' 
      ? parseFloat(wallet.balance) 
      : wallet.balance;
    
    if (buyInAmount > walletBalance) {
      alert(`Insufficient funds! You have ${walletBalance} chips but need ${buyInAmount}.`);
      return;
    }
    
    if (buyInAmount < selectedTable.buy_in) {
      alert(`Minimum buy-in is ${selectedTable.buy_in} chips.`);
      return;
    }
    
    try {
      const response = await tablesApi.join(selectedTable.id, buyInAmount, selectedSeat);
      
      alert(response.message);
      setShowJoinModal(false);
      
      // Navigate to game table
      const communityQuery = Number.isFinite(parsedCommunityId) && parsedCommunityId > 0
        ? `?communityId=${parsedCommunityId}`
        : '';
      navigate(`/game/${selectedTable.id}${communityQuery}`);
      
    } catch (err: any) {
      console.error('Error joining table:', err);
      if (err?.response?.status === 404) {
        setShowJoinModal(false);
        setSelectedTable(null);
        setSelectedSeat(null);
        setSeats([]);
        await loadData({ silent: true });
        alert('This table is no longer available.');
        return;
      }
      alert(err.response?.data?.detail || 'Failed to join table');
    }
  };

  const openJoinModal = async (table: Table) => {
    setSelectedTable(table);
    setBuyInAmount(table.buy_in);
    setSelectedSeat(null);
    setShowJoinModal(true);
    await loadSeats(table, true);
  };

  const loadSeats = async (table: Table, showLoading: boolean = false) => {
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
    } catch (err: any) {
      console.error('Error loading seats:', err);
      if (err?.response?.status === 404) {
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
  };

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
  }, [showJoinModal, selectedTable, selectedSeat]);

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
        <button className="back-button" onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
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
              } catch (err: any) {
                alert(err.response?.data?.detail || 'Failed to join community');
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
                    <span className={`status-badge ${table.status}`}>
                      {table.status}
                    </span>
                  </div>
                </div>
                
                <button 
                  className="join-button"
                  onClick={() => openJoinModal(table)}
                  disabled={!wallet || table.status === 'finished'}
                >
                  {table.status === 'finished' ? 'Finished' : 'Join Table'}
                </button>
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
                  <label>Small Blind</label>
                  <input
                    type="number"
                    value={smallBlind}
                    onChange={(e) => setSmallBlind(Number(e.target.value))}
                    min="1"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Big Blind</label>
                  <input
                    type="number"
                    value={bigBlind}
                    onChange={(e) => setBigBlind(Number(e.target.value))}
                    min="1"
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Buy-in Amount</label>
                  <input
                    type="number"
                    value={buyIn}
                    onChange={(e) => setBuyIn(Number(e.target.value))}
                    min="1"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Max Seats</label>
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
                </div>
              </div>
              
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
              <p><strong>Minimum Buy-in:</strong> {selectedTable.buy_in} chips</p>
              {wallet && (
                <p><strong>Your Balance:</strong> {typeof wallet.balance === 'string' ? wallet.balance : wallet.balance.toFixed(2)} chips</p>
              )}
            </div>
            
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
                                <div className="player-avatar">👤</div>
                                <div className="player-name">{isTakenByMe ? `${seat.username} (You)` : seat.username}</div>
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
                {selectedSeat === null ? 'Select a seat' : `Join at Seat ${selectedSeat} with ${buyInAmount} chips`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
