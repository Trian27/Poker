/**
 * Game Table page - real-time poker game interface with chat and reconnection
 */
import React, { useMemo, useRef, useState, useEffect, type CSSProperties } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../AuthContext';
import { ActionTimer } from '../components/ActionTimer';
import { tablesApi } from '../api';
import type { GameState, GameAction, Card, ChatMessage, HandResult } from '../types';
import './GameTable.css';

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3000';
const ACTIVE_ACTION_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);

export const GameTablePage: React.FC = () => {
  const params = useParams<{ tableId?: string; communityId?: string }>();
  const tableIdParam = params.tableId ?? params.communityId;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const [bustMessage, setBustMessage] = useState('');
  const [resolvedCommunityId, setResolvedCommunityId] = useState<number | null>(null);
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const [revealedShowdownHandsByUserId, setRevealedShowdownHandsByUserId] = useState<Record<number, boolean>>({});
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatMinimized, setChatMinimized] = useState(true);
  const [animatedCommunityIndexes, setAnimatedCommunityIndexes] = useState<number[]>([]);
  const [animatedHoleCardIndexes, setAnimatedHoleCardIndexes] = useState<number[]>([]);
  const [actionMeterNowMs, setActionMeterNowMs] = useState<number>(Date.now());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const handResultTimeoutRef = useRef<number | null>(null);
  const handResultCountdownRef = useRef<number | null>(null);
  const actionMeterSyncRef = useRef<{
    syncedAtMs: number;
    turnPlayerId: number | null;
    turnRemainingSeconds: number;
    reserveRemainingSeconds: number;
  }>({
    syncedAtMs: Date.now(),
    turnPlayerId: null,
    turnRemainingSeconds: 0,
    reserveRemainingSeconds: 0,
  });
  const previousCommunityCountRef = useRef(0);
  const previousHoleCardCountRef = useRef(0);

  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tableId = Number(tableIdParam);
  const expectedGameId = Number.isFinite(tableId) ? `table_${tableId}` : undefined;

  const extractUserId = (playerId: unknown): number | null => {
    if (typeof playerId === 'number' && Number.isFinite(playerId)) {
      return playerId;
    }

    if (typeof playerId !== 'string') {
      return null;
    }

    const tablePlayerMatch = playerId.match(/^player_(\d+)_/);
    if (tablePlayerMatch) {
      return Number(tablePlayerMatch[1]);
    }

    if (/^\d+$/.test(playerId)) {
      return Number(playerId);
    }

    return null;
  };

  const normalizeCards = (cards: unknown): Card[] => {
    if (!Array.isArray(cards)) {
      return [];
    }
    return cards
      .filter((card): card is Card => Boolean(card) && typeof card === 'object' && 'rank' in card && 'suit' in card)
      .map((card) => ({ rank: String(card.rank), suit: String(card.suit) } as Card));
  };

  const normalizeHandResult = (rawHandResult: any): HandResult | null => {
    if (!rawHandResult || !Array.isArray(rawHandResult.winners)) {
      return null;
    }

    return {
      totalPot: Number(rawHandResult.totalPot ?? 0),
      endedByFold: Boolean(rawHandResult.endedByFold),
      winners: rawHandResult.winners.map((winner: any) => ({
        playerId: String(winner.playerId ?? ''),
        userId: winner.userId === null || winner.userId === undefined ? null : Number(winner.userId),
        username: String(winner.username ?? 'Unknown'),
        amount: Number(winner.amount ?? 0),
        handDescription: String(winner.handDescription ?? ''),
        bestHandCards: normalizeCards(winner.bestHandCards),
        holeCards: normalizeCards(winner.holeCards),
      })),
      players: Array.isArray(rawHandResult.players)
        ? rawHandResult.players.map((player: any) => ({
            playerId: String(player.playerId ?? ''),
            userId: player.userId === null || player.userId === undefined ? null : Number(player.userId),
            username: String(player.username ?? 'Unknown'),
            folded: Boolean(player.folded),
            isWinner: Boolean(player.isWinner),
            holeCards: normalizeCards(player.holeCards),
          }))
        : [],
    };
  };

  const normalizeGameState = (rawState: any): GameState => {
    const rawPlayers = Array.isArray(rawState?.players) ? rawState.players : [];
    const normalizedPlayers: GameState['players'] = rawPlayers.map((player: any, index: number): GameState['players'][number] => {
      const parsedId = extractUserId(player?.id);

      return {
        id: parsedId ?? index + 1,
        username: player?.username ?? player?.name ?? `Player ${index + 1}`,
        stack: Number(player?.stack ?? 0),
        currentBet: Number(player?.currentBet ?? player?.bet ?? 0),
        seatNumber: Number.isFinite(Number(player?.seatNumber)) ? Number(player?.seatNumber) : undefined,
        timeBankMs: Number.isFinite(Number(player?.timeBankMs)) ? Number(player?.timeBankMs) : undefined,
        timeBankSeconds: Number.isFinite(Number(player?.timeBankSeconds)) ? Number(player?.timeBankSeconds) : undefined,
        hasFolded: Boolean(player?.hasFolded ?? false),
        isAllIn: Boolean(player?.isAllIn ?? false),
        hand: undefined as Card[] | undefined,
      };
    });

    const currentPlayerIndex = Number(rawState?.currentPlayerIndex);
    const dealerIndex = Number(rawState?.dealerIndex ?? rawState?.dealerPosition ?? -1);
    const smallBlindIndex = Number(rawState?.smallBlindIndex ?? -1);
    const bigBlindIndex = Number(rawState?.bigBlindIndex ?? -1);

    let currentTurnPlayerId: number | null = null;
    const rawCurrentTurnPlayerId = rawState?.currentTurnPlayerId;

    if (rawCurrentTurnPlayerId !== undefined && rawCurrentTurnPlayerId !== null) {
      currentTurnPlayerId = extractUserId(rawCurrentTurnPlayerId);
    } else if (
      Number.isInteger(currentPlayerIndex) &&
      currentPlayerIndex >= 0 &&
      currentPlayerIndex < normalizedPlayers.length
    ) {
      currentTurnPlayerId = normalizedPlayers[currentPlayerIndex].id;
    }

    const myCards: Card[] = normalizeCards(rawState?.myCards);
    if (user) {
      const me = normalizedPlayers.find((player: GameState['players'][number]) => player.id === user.id);
      if (me) {
        me.hand = myCards;
      }
    }

    const rawPhase = rawState?.phase ?? rawState?.stage ?? 'waiting';
    const phase = rawPhase === 'complete' ? 'finished' : rawPhase;

    const currentTurnPlayerIdForPhase = ACTIVE_ACTION_PHASES.has(phase) ? currentTurnPlayerId : null;

    return {
      gameId: rawState?.gameId ?? `table_${Number.isFinite(tableId) ? tableId : 0}`,
      communityId: Number.isFinite(tableId) ? tableId : 0,
      players: normalizedPlayers,
      communityCards: normalizeCards(rawState?.communityCards),
      pot: Number(rawState?.pot ?? 0),
      currentTurnPlayerId: currentTurnPlayerIdForPhase,
      phase,
      minBet: Number(rawState?.minBet ?? rawState?.currentBet ?? rawState?.bigBlind ?? 0),
      minRaiseSize: Number(rawState?.minRaiseSize ?? rawState?.bigBlind ?? 0),
      dealerPosition: dealerIndex,
      dealerPlayerId: dealerIndex >= 0 && dealerIndex < normalizedPlayers.length ? normalizedPlayers[dealerIndex].id : null,
      smallBlind: Number(rawState?.smallBlind ?? rawState?.config?.smallBlind ?? 0),
      smallBlindPlayerId: smallBlindIndex >= 0 && smallBlindIndex < normalizedPlayers.length ? normalizedPlayers[smallBlindIndex].id : null,
      bigBlind: Number(rawState?.bigBlind ?? rawState?.config?.bigBlind ?? 0),
      bigBlindPlayerId: bigBlindIndex >= 0 && bigBlindIndex < normalizedPlayers.length ? normalizedPlayers[bigBlindIndex].id : null,
      lastHandResult: normalizeHandResult(rawState?.lastHandResult),
      actionTimeoutSeconds: Number(rawState?.actionTimeoutSeconds ?? 30),
      remainingActionTime: Number(rawState?.remainingActionTime ?? 0),
      remainingReserveTime: Number(rawState?.remainingReserveTime ?? 0),
    };
  };

  const backToCommunity = () => {
    if (resolvedCommunityId) {
      navigate(`/community/${resolvedCommunityId}`);
    } else {
      navigate('/dashboard');
    }
  };

  useEffect(() => {
    if (!tableIdParam) {
      setResolvedCommunityId(null);
      return;
    }

    const queryParams = new URLSearchParams(location.search);
    const queryCommunityId = Number(queryParams.get('communityId'));
    if (Number.isFinite(queryCommunityId) && queryCommunityId > 0) {
      setResolvedCommunityId(queryCommunityId);
      return;
    }

    let cancelled = false;

    tablesApi.getMyActiveSeat()
      .then((activeSeat) => {
        if (cancelled) {
          return;
        }

        const activeTableId = Number(activeSeat?.table_id);
        const activeCommunityId = Number(activeSeat?.community_id);

        if (activeSeat?.active && activeTableId === Number(tableIdParam) && Number.isFinite(activeCommunityId) && activeCommunityId > 0) {
          setResolvedCommunityId(activeCommunityId);
        } else {
          setResolvedCommunityId(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedCommunityId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tableIdParam, location.search]);

  useEffect(() => {
    if (!token || !tableIdParam) return;

    const newSocket = io(GAME_SERVER_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      setError('');
    });

    newSocket.on('connect_error', () => {
      setError('Failed to connect to game server');
      setConnected(false);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      setReconnecting(true);
    });

    newSocket.on('reconnected', ({ gameState: restoredState }: { message: string; gameState: GameState }) => {
      setGameState(normalizeGameState(restoredState));
      setReconnecting(false);
      setError('');
    });

    newSocket.on('hand_complete', (result: HandResult) => {
      if (handResultTimeoutRef.current !== null) {
        window.clearTimeout(handResultTimeoutRef.current);
        handResultTimeoutRef.current = null;
      }
      if (handResultCountdownRef.current !== null) {
        window.clearInterval(handResultCountdownRef.current);
        handResultCountdownRef.current = null;
      }
      setHandResult(normalizeHandResult(result));
      setRevealedShowdownHandsByUserId({});
      setNextHandCountdown(7);

      handResultCountdownRef.current = window.setInterval(() => {
        setNextHandCountdown((previous) => {
          if (previous === null) {
            return null;
          }
          if (previous <= 1) {
            return 0;
          }
          return previous - 1;
        });
      }, 1000);

      handResultTimeoutRef.current = window.setTimeout(() => {
        if (handResultCountdownRef.current !== null) {
          window.clearInterval(handResultCountdownRef.current);
          handResultCountdownRef.current = null;
        }
        setHandResult(null);
        setRevealedShowdownHandsByUserId({});
        setNextHandCountdown(null);
        handResultTimeoutRef.current = null;
      }, 7000);
    });

    newSocket.on('player_show_hand_update', ({ userId, show }: { userId: number; show: boolean }) => {
      if (!Number.isFinite(userId)) {
        return;
      }
      setRevealedShowdownHandsByUserId((previous) => ({
        ...previous,
        [userId]: Boolean(show),
      }));
    });

    newSocket.on('player_busted', ({ message, userId, gameId }: { message: string; userId?: number; gameId?: string }) => {
      if (gameId && expectedGameId && gameId !== expectedGameId) {
        return;
      }
      if (typeof userId === 'number' && user && userId !== user.id) {
        return;
      }
      setBustMessage(message || 'You were removed from the table.');
      setTimeout(() => {
        newSocket.close();
        backToCommunity();
      }, 2600);
    });

    newSocket.on('player_eliminated', ({ playerName, reason }: { playerName: string; reason?: string }) => {
      setError(
        reason === 'time_bank_exhausted'
          ? `${playerName} ran out of reserve time and was removed from the table.`
          : `${playerName} ran out of chips and was removed from the table.`
      );
      setTimeout(() => setError(''), 4000);
    });

    newSocket.on('player_timeout', ({ playerName }: { playerId: string; playerName: string }) => {
      setError(`${playerName} timed out - auto-folded/checked`);
      setTimeout(() => setError(''), 3000);
    });

    newSocket.on('game_state_update', ({ gameState: newGameState }: { gameState: GameState }) => {
      const normalizedState = normalizeGameState(newGameState);
      setGameState(normalizedState);
      if (normalizedState.phase !== 'finished' && normalizedState.lastHandResult == null) {
        if (handResultTimeoutRef.current !== null) {
          window.clearTimeout(handResultTimeoutRef.current);
          handResultTimeoutRef.current = null;
        }
        if (handResultCountdownRef.current !== null) {
          window.clearInterval(handResultCountdownRef.current);
          handResultCountdownRef.current = null;
        }
        setHandResult(null);
        setRevealedShowdownHandsByUserId({});
        setNextHandCountdown(null);
      }
    });

    newSocket.on('chat_message', (message: ChatMessage) => {
      setChatMessages((prev) => [...prev, message]);
    });

    newSocket.on('chat_history', ({ messages }: { messages: ChatMessage[] }) => {
      setChatMessages(messages);
    });

    newSocket.on('error', ({ message }: { message: string }) => {
      setError(message);
    });

    newSocket.on('action_error', ({ error: actionError }: { error: string }) => {
      setError(actionError || 'Action failed');
    });

    setSocket(newSocket);

    return () => {
      if (handResultTimeoutRef.current !== null) {
        window.clearTimeout(handResultTimeoutRef.current);
        handResultTimeoutRef.current = null;
      }
      if (handResultCountdownRef.current !== null) {
        window.clearInterval(handResultCountdownRef.current);
        handResultCountdownRef.current = null;
      }
      newSocket.close();
    };
  }, [token, tableIdParam, user?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!gameState || !user) {
      previousCommunityCountRef.current = 0;
      previousHoleCardCountRef.current = 0;
      return;
    }

    const communityCount = gameState.communityCards.length;
    if (communityCount < previousCommunityCountRef.current) {
      setAnimatedCommunityIndexes([]);
    } else if (communityCount > previousCommunityCountRef.current) {
      const newIndexes = Array.from(
        { length: communityCount - previousCommunityCountRef.current },
        (_, idx) => previousCommunityCountRef.current + idx
      );
      setAnimatedCommunityIndexes(newIndexes);
      setTimeout(() => setAnimatedCommunityIndexes([]), 1200);
    }
    previousCommunityCountRef.current = communityCount;

    const currentPlayer = gameState.players.find((player) => player.id === user.id);
    const holeCardCount = currentPlayer?.hand?.length ?? 0;

    if (holeCardCount < previousHoleCardCountRef.current) {
      setAnimatedHoleCardIndexes([]);
    } else if (holeCardCount > previousHoleCardCountRef.current) {
      const newIndexes = Array.from(
        { length: holeCardCount - previousHoleCardCountRef.current },
        (_, idx) => previousHoleCardCountRef.current + idx
      );
      setAnimatedHoleCardIndexes(newIndexes);
      setTimeout(() => setAnimatedHoleCardIndexes([]), 1200);
    }
    previousHoleCardCountRef.current = holeCardCount;
  }, [gameState, user]);

  const getCurrentPlayer = () => {
    if (!gameState || !user) return null;
    return gameState.players.find((player) => player.id === user.id) || null;
  };

  const isMyTurn = () => {
    const currentPlayer = getCurrentPlayer();
    if (!gameState || !currentPlayer) {
      return false;
    }
    if (!ACTIVE_ACTION_PHASES.has(gameState.phase)) {
      return false;
    }
    return gameState.currentTurnPlayerId === currentPlayer.id;
  };

  const canCheck = () => {
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer || !gameState) return false;
    const highestBet = Math.max(...gameState.players.map((player) => player.currentBet));
    return currentPlayer.currentBet === highestBet;
  };

  const sendAction = (gameAction: GameAction) => {
    if (!socket || !connected) {
      setError('Not connected to game server');
      return;
    }
    if (!gameState || !ACTIVE_ACTION_PHASES.has(gameState.phase)) {
      setError('Hand is complete. Wait for next hand.');
      return;
    }

    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) {
      setError('You are not seated at this table');
      return;
    }
    if (!isMyTurn()) {
      setError("It's not your turn");
      return;
    }
    if (currentPlayer.hasFolded || currentPlayer.isAllIn) {
      setError('You cannot act right now');
      return;
    }

    socket.emit('game_action', gameAction);
    setBetAmount('');
  };

  const sendChatMessage = () => {
    if (!socket || !connected || !chatInput.trim()) return;

    socket.emit('chat_message', {
      message: chatInput.trim(),
      gameId: gameState?.gameId
    });

    setChatInput('');
  };

  const handleFold = () => sendAction({ action: 'fold' });
  const handleCheck = () => sendAction({ action: 'check' });
  const handleCall = () => sendAction({ action: 'call' });

  const handleBet = () => {
    const amount = Math.ceil(parseFloat(betAmount));
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Please enter a valid bet amount');
      return;
    }
    sendAction({ action: callAmount > 0 ? 'raise' : 'bet', amount });
  };

  const handleAllIn = () => sendAction({ action: 'all-in' });

  const handleLeaveGame = () => {
    if (socket) {
      socket.emit('leave_game', Number.isFinite(tableId) ? { tableId } : undefined);
      socket.close();
    }
    backToCommunity();
  };

  const getSeatLayout = (seatIndex: number, totalSeats: number) => {
    const normalizedSeats = Math.max(totalSeats, 2);
    const angle = Math.PI / 2 - (seatIndex / normalizedSeats) * (Math.PI * 2);
    const radiusXPercent = 42;
    const radiusYPercent = 36;

    return {
      angle,
      leftPercent: 50 + Math.cos(angle) * radiusXPercent,
      topPercent: 50 + Math.sin(angle) * radiusYPercent,
    };
  };

  const suitToSymbol = (suit: string): string => {
    const suitSymbols: Record<string, string> = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠',
    };
    return suitSymbols[suit] || suit;
  };

  const renderCard = (card: Card, index: number, className?: string, animationDelayMs: number = 0) => {
    const symbol = suitToSymbol(card.suit);
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

    return (
      <div
        key={`${card.rank}-${card.suit}-${index}`}
        className={`playing-card ${isRed ? 'red' : 'black'} ${className || ''}`}
        style={animationDelayMs > 0 ? { animationDelay: `${animationDelayMs}ms` } : undefined}
      >
        <div className="card-corner top">
          <span className="corner-rank">{card.rank}</span>
          <span className="corner-suit">{symbol}</span>
        </div>
        <div className="card-center-suit">{symbol}</div>
        <div className="card-corner bottom">
          <span className="corner-rank">{card.rank}</span>
          <span className="corner-suit">{symbol}</span>
        </div>
      </div>
    );
  };
  const renderFaceDownCard = (key: string, className?: string) => (
    <div key={key} className={`playing-card card-back ${className || ''}`} />
  );

  const currentPlayer = getCurrentPlayer();
  const isActionPhase = Boolean(gameState && ACTIVE_ACTION_PHASES.has(gameState.phase));
  const canAct = isActionPhase && isMyTurn() && !!currentPlayer && !currentPlayer.hasFolded && !currentPlayer.isAllIn;
  const canCheckNow = canCheck();
  const highestBet = Math.max(0, ...(gameState?.players || []).map((player) => player.currentBet));
  const callAmount = currentPlayer ? Math.max(0, highestBet - currentPlayer.currentBet) : 0;
  const orderedPlayers = useMemo(() => {
    if (!gameState) {
      return [] as GameState['players'];
    }
    const players = gameState.players;
    if (!user) {
      return players;
    }
    const myIndex = players.findIndex((player) => player.id === user.id);
    if (myIndex < 0) {
      return players;
    }
    return players.map((_, idx) => players[(myIndex + idx) % players.length]);
  }, [gameState, user]);

  const minRaiseSize = Math.max(1, Math.ceil(gameState?.minRaiseSize || gameState?.minBet || gameState?.bigBlind || 1));
  const quickBetPresets = useMemo(() => {
    if (!gameState) {
      return [];
    }

    // If facing a bet, preset sizing is based on pot-after-call.
    const effectivePot = Math.max(0, gameState.pot + (callAmount > 0 ? callAmount : 0));
    const halfPot = Math.ceil(effectivePot * 0.5);
    const presetConfigs = [
      { label: '1/2 Pot', amount: halfPot },
      { label: 'Pot', amount: Math.ceil(effectivePot) },
      { label: '2x Pot', amount: Math.ceil(effectivePot * 2) },
      { label: '3x Pot', amount: Math.ceil(effectivePot * 3) },
    ];

    return presetConfigs.map((preset) => ({
      label: preset.label,
      amount: Math.max(minRaiseSize, preset.amount || minRaiseSize),
    }));
  }, [gameState, minRaiseSize, callAmount]);

  const handResultPlayersByUserId = useMemo(() => {
    const byUserId = new Map<number, NonNullable<HandResult['players']>[number]>();
    if (!handResult) {
      return byUserId;
    }

    handResult.players.forEach((player) => {
      const resolvedUserId = player.userId ?? extractUserId(player.playerId);
      if (resolvedUserId !== null) {
        byUserId.set(resolvedUserId, player);
      }
    });

    return byUserId;
  }, [handResult]);
  const currentPlayerReveal = useMemo(() => {
    if (!currentPlayer || !handResult) {
      return null;
    }
    return handResultPlayersByUserId.get(currentPlayer.id) ?? null;
  }, [currentPlayer, handResult, handResultPlayersByUserId]);
  const winnerSummary = useMemo(() => {
    if (!handResult || handResult.winners.length === 0) {
      return '';
    }
    if (handResult.winners.length === 1) {
      const winner = handResult.winners[0];
      return `Winner: ${winner.username} - ${winner.handDescription}`;
    }
    const names = handResult.winners.map((winner) => winner.username).join(', ');
    return `Winners: ${names} - Split pot`;
  }, [handResult]);
  const hideBottomHandCards = Boolean(
    handResult &&
    currentPlayer &&
    revealedShowdownHandsByUserId[currentPlayer.id] &&
    currentPlayerReveal?.holeCards.length
  );

  useEffect(() => {
    if (!gameState || !isActionPhase || gameState.currentTurnPlayerId === null) {
      actionMeterSyncRef.current = {
        syncedAtMs: Date.now(),
        turnPlayerId: null,
        turnRemainingSeconds: 0,
        reserveRemainingSeconds: 0,
      };
      return;
    }

    const activePlayer = gameState.players.find((player) => player.id === gameState.currentTurnPlayerId);
    actionMeterSyncRef.current = {
      syncedAtMs: Date.now(),
      turnPlayerId: gameState.currentTurnPlayerId,
      turnRemainingSeconds: Math.max(0, Number(gameState.remainingActionTime ?? 0)),
      reserveRemainingSeconds: Math.max(0, Number(activePlayer?.timeBankSeconds ?? 0)),
    };
    setActionMeterNowMs(Date.now());
  }, [gameState, isActionPhase]);

  useEffect(() => {
    if (!isActionPhase || !gameState?.currentTurnPlayerId) {
      return;
    }
    const timerId = window.setInterval(() => {
      setActionMeterNowMs(Date.now());
    }, 120);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isActionPhase, gameState?.currentTurnPlayerId]);

  const getActiveTurnMeterStyle = (playerId: number): CSSProperties | undefined => {
    if (!gameState || !isActionPhase || gameState.currentTurnPlayerId !== playerId) {
      return undefined;
    }

    const snapshot = actionMeterSyncRef.current;
    if (snapshot.turnPlayerId !== playerId) {
      return undefined;
    }

    const elapsedSeconds = Math.max(0, (actionMeterNowMs - snapshot.syncedAtMs) / 1000);
    const turnRemaining = Math.max(0, snapshot.turnRemainingSeconds - elapsedSeconds);
    const overtimeSeconds = Math.max(0, elapsedSeconds - snapshot.turnRemainingSeconds);
    const reserveRemaining = Math.max(0, snapshot.reserveRemainingSeconds - overtimeSeconds);
    const turnTotal = Math.max(1, Number(gameState.actionTimeoutSeconds ?? 30));
    const reserveTotal = 30;
    const turnProgress = Math.max(0, Math.min(1, turnRemaining / turnTotal));
    const reserveProgress = Math.max(0, Math.min(1, reserveRemaining / reserveTotal));
    const reserveActive = turnRemaining <= 0 && reserveRemaining > 0;

    return {
      '--turn-progress': turnProgress.toString(),
      '--reserve-progress': reserveProgress.toString(),
      '--reserve-active': reserveActive ? '1' : '0',
    } as CSSProperties;
  };

  if (!connected) {
    return (
      <div className="game-container">
        <div className="connecting-overlay">
          <div className="spinner"></div>
          <p>Connecting to game server...</p>
          {error && <p className="error">{error}</p>}
          <button onClick={handleLeaveGame} className="btn-secondary">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="game-container">
        <div className="waiting-overlay">
          <h2>Waiting for game to start...</h2>
          <p>Please wait while other players join.</p>
          <button onClick={handleLeaveGame} className="btn-secondary">
            Leave Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <h2>Poker Table</h2>
        <div className="game-info">
          <span>Street: {gameState.phase}</span>
          <span>Pot: {gameState.pot}</span>
          <span>Blinds: {gameState.smallBlind}/{gameState.bigBlind}</span>
        </div>
        <button onClick={handleLeaveGame} className="btn-leave">
          Leave
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {bustMessage && <div className="busted-banner">{bustMessage}</div>}

      <div className="hand-result-slot">
        <div className={`hand-result-banner ${handResult ? 'is-visible' : 'is-hidden'}`}>
          <div className="hand-result-summary">{handResult ? winnerSummary : '\u00a0'}</div>
          <div className="next-hand-countdown">{handResult ? (nextHandCountdown ?? '') : '\u00a0'}</div>
        </div>
      </div>

      <div className="game-layout">
        <section className="table-stage">
          <div className="game-table">
            <div className="table-center">
              <div className="pot-display">
                <div className="pot-amount">{gameState.pot}</div>
                <div className="pot-label">Pot</div>
              </div>
              <div className="community-cards">
                <div className="cards-container">
                  {gameState.communityCards.length > 0 ? (
                    gameState.communityCards.map((card, index) =>
                      renderCard(
                        card,
                        index,
                        animatedCommunityIndexes.includes(index) ? 'deal-in' : '',
                        animatedCommunityIndexes.includes(index) ? (index % 3) * 220 : 0
                      )
                    )
                  ) : (
                    <div className="no-cards">Waiting for flop...</div>
                  )}
                </div>
              </div>
            </div>

            <div className="players-ring">
              {orderedPlayers.map((player, index) => {
                const isCurrentUser = player.id === currentPlayer?.id;
                const isActiveTurn = gameState.currentTurnPlayerId === player.id;
                const revealData = handResult ? handResultPlayersByUserId.get(player.id) : undefined;
                const seatLayout = getSeatLayout(index, orderedPlayers.length);
                const showRevealedCards = Boolean(
                  handResult &&
                  (
                    revealedShowdownHandsByUserId[player.id] ||
                    (!handResult.endedByFold && revealData?.isWinner)
                  ) &&
                  revealData &&
                  revealData.holeCards.length > 0
                );
                const showFaceDownCards = Boolean(
                  !isCurrentUser &&
                  !showRevealedCards &&
                  !player.hasFolded &&
                  isActionPhase
                );
                const roleBadges: string[] = [];

                if (gameState.dealerPlayerId === player.id) roleBadges.push('D');
                if (gameState.smallBlindPlayerId === player.id) roleBadges.push('SB');
                if (gameState.bigBlindPlayerId === player.id) roleBadges.push('BB');

                return (
                  <div
                    key={player.id}
                    className={`player-seat ${isCurrentUser ? 'current-user' : ''} ${isActiveTurn ? 'active-turn' : ''} ${player.hasFolded ? 'folded' : ''} ${showRevealedCards ? 'revealed-hand' : ''}`}
                    style={{ left: `${seatLayout.leftPercent}%`, top: `${seatLayout.topPercent}%` }}
                  >
                    {showFaceDownCards && (
                      <div
                        className="seat-facedown-cards"
                        style={{
                          '--card-offset-x': `${Math.cos(seatLayout.angle) * 126}px`,
                          '--card-offset-y': `${Math.sin(seatLayout.angle) * 126}px`,
                        } as CSSProperties}
                      >
                        {renderFaceDownCard(`${player.id}-fd1`, 'seat-facedown-card')}
                        {renderFaceDownCard(`${player.id}-fd2`, 'seat-facedown-card')}
                      </div>
                    )}
                    <div className="player-circle" style={getActiveTurnMeterStyle(player.id)}>
                      {showRevealedCards && revealData && (
                        <div className="player-circle-revealed-cards">
                          {revealData.holeCards.map((card, cardIndex) =>
                            renderCard(card, cardIndex, 'seat-reveal-card')
                          )}
                        </div>
                      )}
                      <div className="player-name">{player.username}</div>
                      <div className="player-stack">{player.stack}</div>
                      <div className="player-bet">Bet {player.currentBet}</div>
                      <div className="player-badges">
                        {roleBadges.map((badge) => (
                          <span key={badge} className="seat-role-badge">{badge}</span>
                        ))}
                        {player.isAllIn && <span className="status-badge allin">ALL IN</span>}
                        {player.hasFolded && <span className="status-badge folded">FOLDED</span>}
                        {isActiveTurn && <span className="status-badge active">TURN</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bottom-panel">
          {currentPlayer?.hand && currentPlayer.hand.length > 0 && (
            <div className="player-hand">
              <div className={`cards-container ${hideBottomHandCards ? 'hidden-hand-cards' : ''}`}>
                {currentPlayer.hand.map((card, index) =>
                  renderCard(
                    card,
                    index,
                    animatedHoleCardIndexes.includes(index) ? 'deal-in' : '',
                    animatedHoleCardIndexes.includes(index) ? index * 220 : 0
                  )
                )}
              </div>
              <div className="player-hand-controls-slot">
                {handResult && currentPlayerReveal && currentPlayerReveal.holeCards.length > 0 && (
                  <button
                    type="button"
                    className="btn-toggle-own-show"
                    onClick={() => {
                      if (!socket || !connected || !currentPlayer) {
                        return;
                      }
                      socket.emit('show_hand_choice', {
                        show: !Boolean(revealedShowdownHandsByUserId[currentPlayer.id]),
                      });
                    }}
                  >
                    {currentPlayer && revealedShowdownHandsByUserId[currentPlayer.id] ? 'Hide My Cards' : 'Show My Cards'}
                  </button>
                )}
              </div>
            </div>
          )}

          <ActionTimer
            turnSeconds={gameState.actionTimeoutSeconds}
            remainingTurnSeconds={gameState.remainingActionTime}
            reserveSeconds={currentPlayer?.timeBankSeconds}
            isMyTurn={isMyTurn()}
          />

          <div className="action-area">
            {canAct && (
              <div className="action-panel">
                <h3>Your Turn</h3>
                <div className="quick-bets">
                  {quickBetPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="btn-quick-bet"
                      onClick={() => setBetAmount(String(preset.amount))}
                    >
                      {preset.label}: {preset.amount}
                    </button>
                  ))}
                </div>

                <div className="action-buttons">
                  <button
                    onClick={handleFold}
                    className={`btn-action btn-fold ${canCheckNow ? 'btn-disabled' : ''}`}
                    disabled={canCheckNow}
                  >
                    Fold
                  </button>

                  {canCheckNow ? (
                    <button onClick={handleCheck} className="btn-action btn-check">
                      Check
                    </button>
                  ) : (
                    <button onClick={handleCall} className="btn-action btn-call">
                      Call {callAmount}
                    </button>
                  )}

                  <div className="bet-group">
                    <input
                      type="number"
                      placeholder="Amount"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      min={minRaiseSize}
                      className="bet-input"
                    />
                    <button onClick={handleBet} className="btn-action btn-bet">
                      Bet
                    </button>
                  </div>

                  <button onClick={handleAllIn} className="btn-action btn-allin">
                    All In
                  </button>
                </div>
              </div>
            )}

            {!currentPlayer && (
              <div className="waiting-turn">
                <p>Syncing your seat...</p>
              </div>
            )}

            {!!currentPlayer && !canAct && !currentPlayer.hasFolded && !bustMessage && isActionPhase && (
              <div className="waiting-turn">
                <p>Waiting for other players...</p>
              </div>
            )}

            {!!currentPlayer && !canAct && !currentPlayer.hasFolded && !bustMessage && !isActionPhase && (
              <div className="waiting-turn">
                <p>Hand complete. Waiting for next hand...</p>
              </div>
            )}

            {currentPlayer?.hasFolded && (
              <div className="folded-message">
                <p>You folded this hand. Waiting for next hand...</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className={`chat-panel ${chatMinimized ? 'minimized' : ''}`}>
        <div className="chat-header">
          <h4>Chat</h4>
          <button
            type="button"
            className="chat-toggle"
            onClick={() => setChatMinimized((previous) => !previous)}
            aria-label={chatMinimized ? 'Expand chat' : 'Minimize chat'}
          >
            {chatMinimized ? 'Expand' : 'Minimize'}
          </button>
        </div>
        {!chatMinimized && (
          <>
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="no-messages">No messages yet. Say hello!</div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`chat-message ${msg.userId === user?.id ? 'own-message' : ''}`}
                  >
                    <div className="message-header">
                      <span className="message-username">{msg.username}</span>
                      <span className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="message-text">{msg.message}</div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-container">
              <input
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    sendChatMessage();
                  }
                }}
                className="chat-input"
                maxLength={200}
              />
              <button onClick={sendChatMessage} className="btn-send-chat">
                Send
              </button>
            </div>
          </>
        )}
      </div>

      {reconnecting && (
        <div className="reconnecting-overlay">
          <div className="spinner"></div>
          <p>Reconnecting to game...</p>
        </div>
      )}
    </div>
  );
};
