import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { communitiesApi, tablesApi, walletsApi } from '../api';
import type { Community, Table, Wallet, TableSeat } from '../types';
import './CommunityLobby.css';

export default function CommunityLobbyPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const navigate = useNavigate();
  
  const [community, setCommunity] = useState<Community | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
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
  const [maxSeats, setMaxSeats] = useState(9);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [buyIn, setBuyIn] = useState(1000);
  
  // Join table state
  const [buyInAmount, setBuyInAmount] = useState(1000);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, [communityId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get all communities to find this one
      const communities = await communitiesApi.getAll();
      const comm = communities.find((c: Community) => c.id === Number(communityId));
      
      if (!comm) {
        setError('Community not found');
        return;
      }
      
      setCommunity(comm);
      
      // Get tables for this community
      const tablesData = await tablesApi.getByCommunity(Number(communityId));
      setTables(tablesData);
      
      // Get user's wallet in this community
      const wallets = await walletsApi.getAll();
      const userWallet = wallets.find((w: Wallet) => w.community_id === Number(communityId));
      setWallet(userWallet || null);
      
    } catch (err: any) {
      console.error('Error loading community data:', err);
      setError(err.response?.data?.detail || 'Failed to load community data');
    } finally {
      setLoading(false);
    }
  };

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
      });
      
      // Reset form
      setTableName('');
      setShowCreateModal(false);
      
      // Reload tables
      await loadData();
      
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
      navigate(`/game/${selectedTable.id}`);
      
    } catch (err: any) {
      console.error('Error joining table:', err);
      alert(err.response?.data?.detail || 'Failed to join table');
    }
  };

  const openJoinModal = async (table: Table) => {
    setSelectedTable(table);
    setBuyInAmount(table.buy_in);
    setSelectedSeat(null);
    setShowJoinModal(true);
    
    // Load available seats
    setLoadingSeats(true);
    try {
      const seatsData = await tablesApi.getSeats(table.id);
      setSeats(seatsData);
    } catch (err: any) {
      console.error('Error loading seats:', err);
      alert('Failed to load seat information');
    } finally {
      setLoadingSeats(false);
    }
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
                    <strong>0/{table.max_seats}</strong>
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
                    onChange={(e) => setMaxSeats(Number(e.target.value))}
                    min="2"
                    max="10"
                    required
                  />
                </div>
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
                    {seats.map((seat) => {
                      const isOccupied = seat.user_id !== null;
                      const isSelected = selectedSeat === seat.seat_number;
                      
                      return (
                        <button
                          key={seat.id}
                          className={`seat-button seat-${seat.seat_number} ${isOccupied ? 'occupied' : 'available'} ${isSelected ? 'selected' : ''}`}
                          onClick={() => !isOccupied && setSelectedSeat(seat.seat_number)}
                          disabled={isOccupied}
                          title={isOccupied ? `Occupied by ${seat.username}` : `Seat ${seat.seat_number} - Available`}
                        >
                          <div className="seat-number">{seat.seat_number}</div>
                          {isOccupied ? (
                            <div className="seat-player">
                              <div className="player-avatar">👤</div>
                              <div className="player-name">{seat.username}</div>
                            </div>
                          ) : (
                            <div className="seat-empty">
                              {isSelected ? '✓' : '+'}
                            </div>
                          )}
                        </button>
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
