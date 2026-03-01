import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tournamentsApi } from '../api';
import { useAuth } from '../auth-context';
import type { Tournament } from '../types';
import './FeatureHub.css';
import { getApiErrorMessage } from "../utils/error";

export const TournamentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goldPrizePool, setGoldPrizePool] = useState(1000);

  const [awardTournamentId, setAwardTournamentId] = useState<number | null>(null);
  const [awardLines, setAwardLines] = useState('');

  const loadTournaments = async () => {
    try {
      const data = await tournamentsApi.list();
      setTournaments(data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load tournaments'));
    }
  };

  useEffect(() => {
    loadTournaments();
  }, []);

  const createTournament = async () => {
    try {
      await tournamentsApi.createAsAdmin({
        name,
        description,
        gold_prize_pool: goldPrizePool,
        status: 'announced',
      });
      setName('');
      setDescription('');
      await loadTournaments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create tournament'));
    }
  };

  const awardTournament = async () => {
    if (!awardTournamentId) {
      return;
    }

    try {
      const payouts = awardLines
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [userIdText, goldText, rankText] = line.split(',').map((part) => part.trim());
          return {
            user_id: Number(userIdText),
            gold_awarded: Number(goldText),
            rank: rankText ? Number(rankText) : undefined,
          };
        });
      await tournamentsApi.awardAsAdmin(awardTournamentId, payouts);
      setAwardLines('');
      await loadTournaments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to award tournament'));
    }
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h1>Tournaments</h1>
        <button className="secondary" onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}

      <div className="feature-grid">
        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>Current Tournaments</h3>
          <div className="feature-grid">
            {tournaments.map((tournament) => (
              <div key={tournament.id} className="feature-card">
                <h3>{tournament.name}</h3>
                <div className="feature-meta">Status: {tournament.status}</div>
                <div className="feature-meta">Prize Pool: {tournament.gold_prize_pool} GC</div>
                <p>{tournament.description || 'No description'}</p>
                {user?.is_admin && (
                  <button type="button" onClick={() => setAwardTournamentId(tournament.id)}>
                    Select for Awards
                  </button>
                )}
              </div>
            ))}
            {tournaments.length === 0 && <div className="feature-meta">No tournaments yet.</div>}
          </div>
        </div>

        {user?.is_admin && (
          <>
            <div className="feature-card">
              <h3>Create Tournament (Global Admin)</h3>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tournament name" />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description"
                rows={4}
                style={{ marginTop: 8 }}
              />
              <input
                type="number"
                value={goldPrizePool}
                min={1}
                onChange={(event) => setGoldPrizePool(Number(event.target.value))}
                style={{ marginTop: 8 }}
              />
              <button type="button" style={{ marginTop: 8 }} onClick={createTournament}>
                Create Tournament
              </button>
            </div>

            <div className="feature-card">
              <h3>Award Gold Coins</h3>
              <div className="feature-meta">Tournament: {awardTournamentId || 'none selected'}</div>
              <textarea
                value={awardLines}
                onChange={(event) => setAwardLines(event.target.value)}
                rows={8}
                placeholder="One per line: user_id,gold_awarded,rank(optional)"
                style={{ marginTop: 8 }}
              />
              <button type="button" style={{ marginTop: 8 }} onClick={awardTournament}>
                Award Payouts
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
