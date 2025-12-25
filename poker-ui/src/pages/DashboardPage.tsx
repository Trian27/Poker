/**
 * Dashboard/Lobby page - shows communities and wallets
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { communitiesApi, walletsApi } from '../api';
import type { Community, Wallet } from '../types';
import './Dashboard.css';

export const DashboardPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      
      const [communitiesData, walletsData] = await Promise.all([
        communitiesApi.getAll(),
        walletsApi.getAll(),
      ]);
      
      setCommunities(communitiesData);
      setWallets(walletsData);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = (communityId: number) => {
    // Navigate to community lobby to see available tables
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

  const handleJoinCommunity = async (communityId: number) => {
    try {
      await communitiesApi.join(communityId);
      await loadData(); // Reload to get new wallet
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to join community');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
          <span>Welcome, {user?.username}!</span>
          <button onClick={handleLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      {error && <div className="error-message">{error}</div>}

      <main className="dashboard-main">
        <section className="communities-section">
          <h2>Communities</h2>
          
          {communities.length === 0 ? (
            <p className="empty-state">No communities available. Contact an admin to create one.</p>
          ) : (
            <div className="communities-grid">
              {communities.map((community) => (
                <div key={community.id} className="community-card">
                  <h3>{community.name}</h3>
                  <p className="description">{community.description}</p>
                  
                  <div className="community-info">
                    <div className="info-item">
                      <span className="label">Starting Balance:</span>
                      <span className="value">
                        ${parseFloat(community.starting_balance.toString()).toFixed(2)}
                      </span>
                    </div>
                    
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
                        onClick={() => handleJoinCommunity(community.id)}
                        className="btn-secondary"
                      >
                        Join Community
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
