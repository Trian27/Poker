import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { handsApi, learningApi } from '../api';
import { useAuth } from '../auth-context';
import type {
  HandHistoryResponse,
  HandHistorySummary,
  LearningCoachRecommendation,
  LearningSessionSummary,
} from '../types';
import { getApiErrorMessage } from '../utils/error';
import './FeatureHub.css';
import './LearningPage.css';

type Street = 'preflop' | 'flop' | 'turn' | 'river';

interface ActionLogEntry {
  sequence: number;
  stage: Street | string;
  userId?: number | null;
  user_id?: number | null;
  username?: string;
  action: string;
  source?: 'player' | 'timeout' | 'forced' | string;
  requestedAmount?: number | null;
  requested_amount?: number | null;
  committedChips?: number;
  committed_chips?: number;
  toCallBefore?: number;
  to_call_before?: number;
  minimumRaiseBefore?: number;
  minimum_raise_before?: number;
  playersInHandBefore?: number;
  players_in_hand_before?: number;
  potBefore?: number;
  pot_before?: number;
  playerStackBefore?: number;
  player_stack_before?: number;
}

interface CardLike {
  rank?: string;
  suit?: string;
}

interface CoachCard {
  rank: string;
  suit: string;
}

interface HandPlayerLike {
  user_id?: number | string | null;
  hole_cards?: CardLike[];
}

interface HandDataShape {
  action_log?: ActionLogEntry[];
  players?: HandPlayerLike[];
  community_cards?: CardLike[];
}

const ANALYZABLE_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all-in']);

const stageBoardCardCount: Record<Street, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};

const parseNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeStreet = (value: unknown): Street => {
  const text = String(value || '').toLowerCase();
  if (text === 'flop' || text === 'turn' || text === 'river') {
    return text;
  }
  return 'preflop';
};

const suitSymbol = (suit: string) => {
  switch (suit) {
    case 'hearts':
      return '♥';
    case 'diamonds':
      return '♦';
    case 'clubs':
      return '♣';
    case 'spades':
      return '♠';
    default:
      return '?';
  }
};

const renderCardText = (card: { rank?: string; suit?: string }) => `${card.rank ?? '?'}${suitSymbol(card.suit ?? '')}`;

const normalizeCoachCards = (cards: unknown): CoachCard[] => {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards
    .map((card) => {
      if (!card || typeof card !== 'object') {
        return null;
      }
      const maybeCard = card as CardLike;
      if (typeof maybeCard.rank !== 'string' || typeof maybeCard.suit !== 'string') {
        return null;
      }
      return { rank: maybeCard.rank, suit: maybeCard.suit };
    })
    .filter((card): card is CoachCard => card !== null);
};

export const LearningPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LearningSessionSummary[]>([]);
  const [legacyHands, setLegacyHands] = useState<HandHistorySummary[]>([]);
  const [sessionHands, setSessionHands] = useState<HandHistorySummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [selectedHand, setSelectedHand] = useState<HandHistoryResponse | null>(null);
  const [selectedDecisionSequence, setSelectedDecisionSequence] = useState<number | null>(null);
  const [coachResult, setCoachResult] = useState<LearningCoachRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHands, setLoadingHands] = useState(false);
  const [loadingCoach, setLoadingCoach] = useState(false);
  const [error, setError] = useState('');
  const backTarget = (
    location.state
    && typeof location.state === 'object'
    && 'from' in location.state
    && typeof (location.state as { from?: unknown }).from === 'string'
  )
    ? (location.state as { from: string }).from
    : '/dashboard';

  const loadSessions = async () => {
    setLoading(true);
    setError('');
    try {
      const [sessionData, fallbackHands] = await Promise.all([
        learningApi.getSessions(),
        handsApi.getMine(30, 0),
      ]);
      setSessions(sessionData || []);
      setLegacyHands(sessionData?.length ? [] : (fallbackHands || []));

      if (sessionData?.length) {
        setSelectedSessionId(sessionData[0].id);
      } else if (fallbackHands?.length) {
        setSessionHands(fallbackHands);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load learning sessions'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    let cancelled = false;
    const loadHands = async () => {
      setLoadingHands(true);
      setCoachResult(null);
      setSelectedDecisionSequence(null);
      setSelectedHand(null);
      setSelectedHandId(null);
      try {
        const hands = await learningApi.getSessionHands(selectedSessionId);
        if (!cancelled) {
          setSessionHands(hands || []);
          if (hands?.length) {
            setSelectedHandId(hands[0].id);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'Failed to load session hands'));
        }
      } finally {
        if (!cancelled) {
          setLoadingHands(false);
        }
      }
    };

    loadHands();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedHandId) {
      return;
    }

    let cancelled = false;
    const loadHand = async () => {
      setCoachResult(null);
      setSelectedDecisionSequence(null);
      try {
        const hand = await handsApi.getById(selectedHandId);
        if (!cancelled) {
          setSelectedHand(hand);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'Failed to load hand details'));
        }
      }
    };

    loadHand();
    return () => {
      cancelled = true;
    };
  }, [selectedHandId]);

  const handData = useMemo<HandDataShape>(() => {
    if (!selectedHand?.hand_data || typeof selectedHand.hand_data !== 'object') {
      return {};
    }
    return selectedHand.hand_data as HandDataShape;
  }, [selectedHand?.hand_data]);

  const actionLog = useMemo(() => {
    if (!Array.isArray(handData.action_log)) {
      return [] as ActionLogEntry[];
    }
    return handData.action_log as ActionLogEntry[];
  }, [handData]);

  const myPlayerData = useMemo(() => {
    if (!Array.isArray(handData.players) || !user) {
      return null;
    }
    return handData.players.find((player) => Number(player.user_id) === user.id) || null;
  }, [handData, user]);

  const analyzeDecision = async (entry: ActionLogEntry) => {
    if (!user || !myPlayerData) {
      return;
    }

    const entryUserId = parseNumber(entry.userId ?? entry.user_id, 0);
    if (entryUserId !== user.id) {
      return;
    }

    const street = normalizeStreet(entry.stage);
    const boardCount = stageBoardCardCount[street] ?? 0;
    const communityCards = normalizeCoachCards(handData.community_cards).slice(0, boardCount);
    const holeCards = normalizeCoachCards(myPlayerData.hole_cards);

    setLoadingCoach(true);
    setSelectedDecisionSequence(entry.sequence);
    setCoachResult(null);
    setError('');

    try {
      const result = await learningApi.recommendAction({
        street,
        hole_cards: holeCards,
        community_cards: communityCards,
        pot: parseNumber(entry.potBefore ?? entry.pot_before, 0),
        to_call: parseNumber(entry.toCallBefore ?? entry.to_call_before, 0),
        min_raise: parseNumber(entry.minimumRaiseBefore ?? entry.minimum_raise_before, 1),
        stack: parseNumber(entry.playerStackBefore ?? entry.player_stack_before, 0),
        players_in_hand: parseNumber(entry.playersInHandBefore ?? entry.players_in_hand_before, 2),
        can_check: parseNumber(entry.toCallBefore ?? entry.to_call_before, 0) <= 0,
      });
      setCoachResult(result);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to analyze decision'));
    } finally {
      setLoadingCoach(false);
    }
  };

  if (loading) {
    return (
      <div className="feature-page">
        <div className="feature-card">Loading learning data...</div>
      </div>
    );
  }

  return (
    <div className="feature-page learning-page">
      <div className="feature-header">
        <h1>📘 Learning Hub</h1>
        <button className="secondary" onClick={() => navigate(backTarget)}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}

      <div className="learning-layout">
        <section className="feature-card learning-column">
          <h3>Sessions</h3>
          {sessions.length === 0 ? (
            <>
              <div className="feature-meta">No tracked sessions yet. Legacy hands shown on the right.</div>
              <div className="feature-meta">Sessions start on table join and end on leave/unseat.</div>
            </>
          ) : (
            <div className="feature-list">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`secondary ${session.id === selectedSessionId ? 'active-item' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="learning-item-title">{session.table_name}</div>
                  <div className="feature-meta">
                    {new Date(session.joined_at).toLocaleString()} • {session.hand_count} hands
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="feature-card learning-column">
          <h3>{selectedSessionId ? 'Hands in Session' : 'Hands'}</h3>
          {loadingHands ? (
            <div className="feature-meta">Loading hands...</div>
          ) : (
            <div className="feature-list">
              {(selectedSessionId ? sessionHands : legacyHands).map((hand) => (
                <button
                  key={hand.id}
                  type="button"
                  className={`secondary ${hand.id === selectedHandId ? 'active-item' : ''}`}
                  onClick={() => setSelectedHandId(hand.id)}
                >
                  <div className="learning-item-title">{hand.table_name}</div>
                  <div className="feature-meta">
                    Pot {hand.pot_size} • Winner {hand.winner_username || 'N/A'}
                  </div>
                  <div className="feature-meta">{new Date(hand.played_at).toLocaleString()}</div>
                </button>
              ))}
              {(selectedSessionId ? sessionHands : legacyHands).length === 0 && (
                <div className="feature-meta">No hands available.</div>
              )}
            </div>
          )}
        </section>

        <section className="feature-card learning-column wide">
          <h3>Replay and Analysis</h3>
          {!selectedHand && <div className="feature-meta">Select a hand to begin analysis.</div>}

          {selectedHand && (
            <>
              <div className="learning-hand-meta">
                <div><strong>Table:</strong> {selectedHand.table_name}</div>
                <div><strong>Played:</strong> {new Date(selectedHand.played_at).toLocaleString()}</div>
                <div>
                  <strong>Your Cards:</strong>{' '}
                  {Array.isArray(myPlayerData?.hole_cards) && myPlayerData.hole_cards.length
                    ? myPlayerData.hole_cards.map((card: CardLike, idx: number) => (
                        <span key={`${card.rank}-${card.suit}-${idx}`} className="card-pill">{renderCardText(card)}</span>
                      ))
                    : 'N/A'}
                </div>
              </div>

              {!actionLog.length && (
                <div className="feature-meta">
                  This hand has no action timeline (likely recorded before the learning logger update).
                </div>
              )}

              {!!actionLog.length && (
                <div className="learning-timeline">
                  {actionLog.map((entry) => {
                    const entryUserId = parseNumber(entry.userId ?? entry.user_id, 0);
                    const isMyDecision = user && entryUserId === user.id && ANALYZABLE_ACTIONS.has(entry.action);
                    const committed = parseNumber(entry.committedChips ?? entry.committed_chips, 0);
                    return (
                      <div
                        key={`${entry.sequence}-${entry.username}-${entry.action}`}
                        className={`timeline-row ${selectedDecisionSequence === entry.sequence ? 'selected' : ''}`}
                      >
                        <div className="timeline-main">
                          <span className="timeline-seq">#{entry.sequence}</span>
                          <span className="timeline-user">{entry.username || 'Player'}</span>
                          <span className="timeline-action">{entry.action}</span>
                          <span className="timeline-chip">{committed > 0 ? `${committed} chips` : '-'}</span>
                          <span className="timeline-stage">{String(entry.stage).toUpperCase()}</span>
                        </div>
                        {isMyDecision && (
                          <button type="button" className="btn-analyze" onClick={() => analyzeDecision(entry)}>
                            Analyze
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="feature-card coach-panel">
                <h3>Coach Move</h3>
                {!selectedDecisionSequence && <div className="feature-meta">Select one of your actions and click Analyze.</div>}
                {loadingCoach && <div className="feature-meta">Analyzing decision...</div>}
                {coachResult && (
                  <>
                    <div className="coach-summary">{coachResult.summary}</div>
                    <div className="coach-tags">
                      {coachResult.tags.map((tag) => (
                        <span key={tag} className="coach-tag">{tag}</span>
                      ))}
                    </div>
                    <div className="coach-actions">
                      {coachResult.top_actions.map((option, index) => (
                        <div key={`${option.action}-${index}`} className="coach-action-row">
                          <strong>{option.action.toUpperCase()}{option.amount ? ` ${option.amount}` : ''}</strong>
                          <span>{Math.round(option.score * 100)}%</span>
                          <div className="feature-meta">{option.rationale}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
