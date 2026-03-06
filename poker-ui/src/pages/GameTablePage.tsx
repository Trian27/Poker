/**
 * Game Table page - real-time poker game interface with chat and reconnection
 */
import React, { useCallback, useMemo, useRef, useState, useEffect, type CSSProperties } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../auth-context';
import { ActionTimer } from '../components/ActionTimer';
import RulesScrollHelp from '../components/RulesScrollHelp';
import { tablesApi, skinsApi, playerNotesApi } from '../api';
import type { GameState, GameAction, Card, ChatMessage, HandResult, TableSeat } from '../types';
import { getApiErrorMessage } from '../utils/error';
import { suppressAutoRejoinForMs } from '../utils/activeSeatRejoin';
import './GameTable.css';

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3000';
const ACTIVE_ACTION_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);
const QUICK_EMOTES = ['😀', '😂', '😎', '🤔', '😬', '😢', '😡', '👏', '🔥', '🍀'];

interface TableEmoteEvent {
  id: string;
  userId: number;
  username: string;
  emoji: string;
  timestamp: number;
}

interface AppliedTableTheme {
  cardFront: string | null;
  cardBack: string | null;
  tableFelt: string | null;
  tableBackground: string | null;
}

interface TableLayoutTuning {
  seatRadiusXPercent: number;
  seatRadiusYPercent: number;
  seatCardOffsetPx: number;
}

const EMPTY_TABLE_THEME: AppliedTableTheme = {
  cardFront: null,
  cardBack: null,
  tableFelt: null,
  tableBackground: null,
};

const DEFAULT_TABLE_LAYOUT_TUNING: TableLayoutTuning = {
  seatRadiusXPercent: 50,
  seatRadiusYPercent: 50,
  seatCardOffsetPx: 78,
};

type UnknownRecord = Record<string, unknown>;

interface OwnedSkinEntry {
  is_equipped?: boolean;
  skin?: {
    category?: string;
    design_spec?: {
      asset_manifest?: unknown;
    };
  };
}

const asRecord = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as UnknownRecord;
};

const normalizePhase = (rawPhase: unknown): GameState['phase'] => {
  const value = rawPhase === 'complete' ? 'finished' : rawPhase;
  if (
    value === 'waiting'
    || value === 'preflop'
    || value === 'flop'
    || value === 'turn'
    || value === 'river'
    || value === 'showdown'
    || value === 'finished'
  ) {
    return value;
  }
  return 'waiting';
};

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
  const [activeEmotes, setActiveEmotes] = useState<TableEmoteEvent[]>([]);
  const [tableTheme, setTableTheme] = useState<AppliedTableTheme>(EMPTY_TABLE_THEME);
  const [tableLayoutTuning, setTableLayoutTuning] = useState<TableLayoutTuning>(DEFAULT_TABLE_LAYOUT_TUNING);
  const [tableSeatCapacity, setTableSeatCapacity] = useState<number>(8);
  const [noteTargetPlayer, setNoteTargetPlayer] = useState<GameState['players'][number] | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [noteInfo, setNoteInfo] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const handResultTimeoutRef = useRef<number | null>(null);
  const handResultCountdownRef = useRef<number | null>(null);
  const botUserIdsRef = useRef<number[]>([]);
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
  const gameContainerRef = useRef<HTMLDivElement | null>(null);
  const tableStageRef = useRef<HTMLElement | null>(null);
  const gameTableRef = useRef<HTMLDivElement | null>(null);

  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const tableId = Number(tableIdParam);
  const currentUserId = user?.id ?? null;
  const expectedGameId = Number.isFinite(tableId) ? `table_${tableId}` : undefined;
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const spectateRequested = queryParams.get('spectate') === '1';
  const [spectatorMode, setSpectatorMode] = useState<boolean>(spectateRequested);
  const [spectatorHasSeat, setSpectatorHasSeat] = useState(false);

  const extractUserId = useCallback((playerId: unknown): number | null => {
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
  }, []);

  const toCssImageValue = useCallback((rawValue: unknown): string | null => {
    if (typeof rawValue !== 'string') {
      return null;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.toLowerCase();
    if (
      !normalized.startsWith('https://')
      && !normalized.startsWith('http://')
      && !normalized.startsWith('/')
      && !normalized.startsWith('data:image/')
    ) {
      return null;
    }
    const escaped = trimmed.replace(/"/g, '\\"');
    return `url("${escaped}")`;
  }, []);

  const extractSkinManifestValue = useCallback((manifest: unknown, keys: string[]): string | null => {
    if (!manifest || typeof manifest !== 'object') {
      return null;
    }
    const values = manifest as Record<string, unknown>;
    for (const key of keys) {
      const cssValue = toCssImageValue(values[key]);
      if (cssValue) {
        return cssValue;
      }
    }
    return null;
  }, [toCssImageValue]);

  const normalizeCards = useCallback((cards: unknown): Card[] => {
    if (!Array.isArray(cards)) {
      return [];
    }
    return cards
      .filter((card): card is Card => Boolean(card) && typeof card === 'object' && 'rank' in card && 'suit' in card)
      .map((card) => ({ rank: String(card.rank), suit: String(card.suit) } as Card));
  }, []);

  const normalizeHandResult = useCallback((rawHandResult: unknown): HandResult | null => {
    const handResultRecord = asRecord(rawHandResult);
    const rawWinners = Array.isArray(handResultRecord.winners) ? handResultRecord.winners : null;
    if (!rawWinners) {
      return null;
    }

    return {
      totalPot: Number(handResultRecord.totalPot ?? 0),
      endedByFold: Boolean(handResultRecord.endedByFold),
      winners: rawWinners.map((winnerValue) => {
        const winner = asRecord(winnerValue);
        return {
          playerId: String(winner.playerId ?? ''),
          userId: winner.userId === null || winner.userId === undefined ? null : Number(winner.userId),
          username: String(winner.username ?? 'Unknown'),
          amount: Number(winner.amount ?? 0),
          handDescription: String(winner.handDescription ?? ''),
          bestHandCards: normalizeCards(winner.bestHandCards),
          holeCards: normalizeCards(winner.holeCards),
        };
      }),
      players: Array.isArray(handResultRecord.players)
        ? handResultRecord.players.map((playerValue) => {
            const player = asRecord(playerValue);
            return {
              playerId: String(player.playerId ?? ''),
              userId: player.userId === null || player.userId === undefined ? null : Number(player.userId),
              username: String(player.username ?? 'Unknown'),
              folded: Boolean(player.folded),
              isWinner: Boolean(player.isWinner),
              holeCards: normalizeCards(player.holeCards),
            };
          })
        : [],
    };
  }, [normalizeCards]);

  const normalizeGameState = useCallback((rawState: unknown, latestBotUserIds: number[] = []): GameState => {
    const state = asRecord(rawState);
    const config = asRecord(state.config);
    const botSet = new Set(latestBotUserIds.filter((value) => Number.isFinite(value)));
    const rawPlayers = Array.isArray(state.players) ? state.players : [];
    const normalizedPlayers: GameState['players'] = rawPlayers.map((playerValue, index): GameState['players'][number] => {
      const player = asRecord(playerValue);
      const parsedId = extractUserId(player.id);
      const resolvedId = parsedId ?? index + 1;

      return {
        id: resolvedId,
        username: String(player.username ?? player.name ?? `Player ${index + 1}`),
        stack: Number(player.stack ?? 0),
        currentBet: Number(player.currentBet ?? player.bet ?? 0),
        seatNumber: Number.isFinite(Number(player.seatNumber)) ? Number(player.seatNumber) : undefined,
        profileImageUrl: typeof player.profileImageUrl === 'string'
          ? player.profileImageUrl
          : (typeof player.avatarUrl === 'string' ? player.avatarUrl : null),
        timeBankMs: Number.isFinite(Number(player.timeBankMs)) ? Number(player.timeBankMs) : undefined,
        timeBankSeconds: Number.isFinite(Number(player.timeBankSeconds)) ? Number(player.timeBankSeconds) : undefined,
        hasFolded: Boolean(player.hasFolded ?? false),
        isAllIn: Boolean(player.isAllIn ?? false),
        isApiBot: botSet.has(resolvedId),
        waitingForBigBlind: Boolean(player.waitingForBigBlind ?? false),
        hand: undefined as Card[] | undefined,
      };
    });

    const currentPlayerIndex = Number(state.currentPlayerIndex);
    const dealerIndex = Number(state.dealerIndex ?? state.dealerPosition ?? -1);
    const smallBlindIndex = Number(state.smallBlindIndex ?? -1);
    const bigBlindIndex = Number(state.bigBlindIndex ?? -1);

    let currentTurnPlayerId: number | null = null;
    const rawCurrentTurnPlayerId = state.currentTurnPlayerId;

    if (rawCurrentTurnPlayerId !== undefined && rawCurrentTurnPlayerId !== null) {
      currentTurnPlayerId = extractUserId(rawCurrentTurnPlayerId);
    } else if (
      Number.isInteger(currentPlayerIndex) &&
      currentPlayerIndex >= 0 &&
      currentPlayerIndex < normalizedPlayers.length
    ) {
      currentTurnPlayerId = normalizedPlayers[currentPlayerIndex].id;
    }

    const myCards: Card[] = normalizeCards(state.myCards);
    if (currentUserId !== null) {
      const me = normalizedPlayers.find((player: GameState['players'][number]) => player.id === currentUserId);
      if (me) {
        me.hand = myCards;
      }
    }

    const phase = normalizePhase(state.phase ?? state.stage ?? 'waiting');
    const currentTurnPlayerIdForPhase = ACTIVE_ACTION_PHASES.has(phase) ? currentTurnPlayerId : null;
    const sidePots = Array.isArray(state.sidePots)
      ? state.sidePots
          .map((sidePotValue, index) => {
            const sidePot = asRecord(sidePotValue);
            const eligiblePlayerIds = Array.isArray(sidePot.eligiblePlayerIds)
              ? sidePot.eligiblePlayerIds
                  .map((id: unknown) => extractUserId(id))
                  .filter((id: number | null): id is number => id !== null)
              : [];
            return {
              index: Number(sidePot.index ?? (index + 1)),
              amount: Number(sidePot.amount ?? 0),
              eligiblePlayerIds,
            };
          })
          .filter((sidePot: { amount: number }) => sidePot.amount > 0)
      : [];

    return {
      gameId: typeof state.gameId === 'string'
        ? state.gameId
        : `table_${Number.isFinite(tableId) ? tableId : 0}`,
      communityId: Number.isFinite(tableId) ? tableId : 0,
      players: normalizedPlayers,
      communityCards: normalizeCards(state.communityCards),
      pot: Number(state.pot ?? 0),
      sidePots,
      currentTurnPlayerId: currentTurnPlayerIdForPhase,
      phase,
      minBet: Number(state.minBet ?? state.currentBet ?? state.bigBlind ?? 0),
      minRaiseSize: Number(state.minRaiseSize ?? state.bigBlind ?? 0),
      dealerPosition: dealerIndex,
      dealerPlayerId: dealerIndex >= 0 && dealerIndex < normalizedPlayers.length ? normalizedPlayers[dealerIndex].id : null,
      smallBlind: Number(state.smallBlind ?? config.smallBlind ?? 0),
      smallBlindPlayerId: smallBlindIndex >= 0 && smallBlindIndex < normalizedPlayers.length ? normalizedPlayers[smallBlindIndex].id : null,
      bigBlind: Number(state.bigBlind ?? config.bigBlind ?? 0),
      bigBlindPlayerId: bigBlindIndex >= 0 && bigBlindIndex < normalizedPlayers.length ? normalizedPlayers[bigBlindIndex].id : null,
      lastHandResult: normalizeHandResult(state.lastHandResult),
      actionTimeoutSeconds: Number(state.actionTimeoutSeconds ?? 30),
      remainingActionTime: Number(state.remainingActionTime ?? 0),
      remainingReserveTime: Number(state.remainingReserveTime ?? 0),
    };
  }, [extractUserId, normalizeCards, normalizeHandResult, tableId, currentUserId]);

  const backToCommunity = useCallback(() => {
    if (resolvedCommunityId) {
      navigate(`/community/${resolvedCommunityId}`, { replace: true });
    } else {
      navigate('/dashboard', { replace: true });
    }
  }, [resolvedCommunityId, navigate]);

  useEffect(() => {
    setSpectatorMode(spectateRequested);
    if (!spectateRequested) {
      setSpectatorHasSeat(false);
    }
  }, [spectateRequested]);

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
    if (!Number.isFinite(tableId) || tableId <= 0 || !token) {
      return;
    }

    let cancelled = false;

    tablesApi.getSeats(tableId)
      .then((seatsData: TableSeat[]) => {
        if (cancelled || !Array.isArray(seatsData) || seatsData.length === 0) {
          return;
        }

        const maxSeatNumber = seatsData.reduce((maxSeat, seat) => {
          const seatNumber = Number(seat?.seat_number);
          if (!Number.isFinite(seatNumber) || seatNumber <= 0) {
            return maxSeat;
          }
          return Math.max(maxSeat, Math.floor(seatNumber));
        }, 0);

        if (maxSeatNumber >= 2) {
          setTableSeatCapacity(maxSeatNumber);
        }
      })
      .catch(() => {
        // Seat count is best-effort for layout mapping. Keep fallback if unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [tableId, token]);

  useEffect(() => {
    if (currentUserId === null) {
      setTableTheme(EMPTY_TABLE_THEME);
      return;
    }

    let cancelled = false;

    skinsApi.getMySkins()
      .then((ownedSkins) => {
        if (cancelled || !Array.isArray(ownedSkins)) {
          return;
        }

        const normalizedOwnedSkins = ownedSkins as OwnedSkinEntry[];
        const equippedSkins = normalizedOwnedSkins.filter((entry) => Boolean(entry?.is_equipped));
        const equippedCardSkin = equippedSkins.find((entry) => entry?.skin?.category === 'cards');
        const equippedTableSkin = equippedSkins.find((entry) => entry?.skin?.category === 'table');

        const cardManifest = equippedCardSkin?.skin?.design_spec?.asset_manifest;
        const tableManifest = equippedTableSkin?.skin?.design_spec?.asset_manifest;

        setTableTheme({
          cardFront: extractSkinManifestValue(cardManifest, ['card_front', 'cards_front', 'front']),
          cardBack: extractSkinManifestValue(cardManifest, ['card_back', 'cards_back', 'back']),
          tableFelt: extractSkinManifestValue(tableManifest, ['table_felt', 'felt']),
          tableBackground: extractSkinManifestValue(tableManifest, ['table_background', 'background']),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setTableTheme(EMPTY_TABLE_THEME);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, extractSkinManifestValue]);

  useEffect(() => {
    if (!token || !tableIdParam) return;

    const newSocket = io(GAME_SERVER_URL, {
      auth: {
        token,
        spectator: spectateRequested,
        tableId: Number.isFinite(tableId) ? tableId : undefined,
      },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      setError('');
      if (spectateRequested && Number.isFinite(tableId)) {
        newSocket.emit('spectate_table', { tableId });
      }
    });

    newSocket.on('connect_error', () => {
      setError('Failed to connect to game server');
      setConnected(false);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      setReconnecting(true);
    });

    newSocket.on('reconnected', ({ gameState: restoredState, botUserIds: latestBotUserIds }: { message: string; gameState: GameState; botUserIds?: number[] }) => {
      const normalizedBotUsers = Array.isArray(latestBotUserIds) ? latestBotUserIds.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [];
      botUserIdsRef.current = normalizedBotUsers;
      setGameState(normalizeGameState(restoredState, normalizedBotUsers));
      setReconnecting(false);
      setError('');
    });

    newSocket.on('spectator_mode', ({ enabled, hasSeat }: { enabled?: boolean; hasSeat?: boolean }) => {
      setSpectatorMode(Boolean(enabled));
      setSpectatorHasSeat(Boolean(hasSeat));
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
      if (typeof userId === 'number' && currentUserId !== null && userId !== currentUserId) {
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

    newSocket.on('game_state_update', ({ gameState: newGameState, botUserIds: latestBotUserIds }: { gameState: GameState; botUserIds?: number[] }) => {
      const normalizedBotUsers = Array.isArray(latestBotUserIds) ? latestBotUserIds.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [];
      if (Array.isArray(latestBotUserIds)) {
        botUserIdsRef.current = normalizedBotUsers;
      }
      const normalizedState = normalizeGameState(newGameState, botUserIdsRef.current);
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

    newSocket.on('table_emote', (emote: TableEmoteEvent) => {
      if (!emote || typeof emote.userId !== 'number' || typeof emote.emoji !== 'string') {
        return;
      }
      setActiveEmotes((previous) => {
        const filtered = previous.filter((item) => item.userId !== emote.userId);
        return [...filtered, emote];
      });
      window.setTimeout(() => {
        setActiveEmotes((previous) => previous.filter((item) => item.id !== emote.id));
      }, 2400);
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
  }, [token, tableIdParam, tableId, spectateRequested, expectedGameId, currentUserId, normalizeGameState, normalizeHandResult, backToCommunity]);

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
    if (spectatorMode) {
      return false;
    }
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
    if (spectatorMode) {
      setError('Spectator mode is read-only');
      return;
    }
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

  const sendEmote = (emoji: string) => {
    if (!socket || !connected) {
      return;
    }
    socket.emit('table_emote', { emoji });
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

  const openPlayerNotesPanel = async (player: GameState['players'][number]) => {
    setNoteTargetPlayer(player);
    setNoteError('');
    setNoteInfo('');
    setNoteText('');

    if (!user || player.id === user.id) {
      return;
    }

    setNoteLoading(true);
    try {
      const note = await playerNotesApi.get(player.id);
      setNoteText(typeof note?.notes === 'string' ? note.notes : '');
    } catch (err: unknown) {
      setNoteError(getApiErrorMessage(err, 'Failed to load notes for this player.'));
    } finally {
      setNoteLoading(false);
    }
  };

  const closePlayerNotesPanel = () => {
    setNoteTargetPlayer(null);
    setNoteText('');
    setNoteLoading(false);
    setNoteSaving(false);
    setNoteError('');
    setNoteInfo('');
  };

  const savePlayerNotes = async () => {
    if (!noteTargetPlayer || !user || noteTargetPlayer.id === user.id) {
      return;
    }

    setNoteSaving(true);
    setNoteError('');
    setNoteInfo('');
    try {
      await playerNotesApi.upsert(noteTargetPlayer.id, noteText);
      setNoteInfo('Notes saved.');
    } catch (err: unknown) {
      setNoteError(getApiErrorMessage(err, 'Failed to save notes.'));
    } finally {
      setNoteSaving(false);
    }
  };

  const handleLeaveGame = async () => {
    suppressAutoRejoinForMs();
    if (!spectatorMode && Number.isFinite(tableId)) {
      try {
        await tablesApi.leave(tableId);
      } catch (err) {
        console.warn('Failed to leave table via API fallback:', getApiErrorMessage(err, 'Leave fallback failed'));
      }
    }
    if (socket) {
      socket.emit('leave_game', !spectatorMode && Number.isFinite(tableId) ? { tableId } : undefined);
      socket.close();
    }
    backToCommunity();
  };

  const getSeatLayout = (seatNumber: number | undefined, totalSeats: number, fallbackIndex: number) => {
    const normalizedSeats = Math.max(2, Math.floor(totalSeats));
    const fallbackSeatNumber = fallbackIndex + 1;
    const parsedSeatNumber = Number(seatNumber);
    const safeSeatNumber = Number.isFinite(parsedSeatNumber) && parsedSeatNumber > 0
      ? Math.floor(parsedSeatNumber)
      : fallbackSeatNumber;
    const zeroBasedSeat = ((safeSeatNumber - 1) % normalizedSeats + normalizedSeats) % normalizedSeats;
    const angle = (zeroBasedSeat / normalizedSeats) * (Math.PI * 2) - Math.PI / 2;
    const radiusXPercent = tableLayoutTuning.seatRadiusXPercent;
    const radiusYPercent = tableLayoutTuning.seatRadiusYPercent;

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
        className={`playing-card ${isRed ? 'red' : 'black'} ${tableTheme.cardFront ? 'card-front-themed' : ''} ${className || ''}`}
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
    <div
      key={key}
      className={`playing-card card-back ${tableTheme.cardBack ? 'card-back-themed' : ''} ${className || ''}`}
    />
  );

  const currentPlayer = getCurrentPlayer();
  const hasGameState = gameState !== null;
  const isActionPhase = Boolean(gameState && ACTIVE_ACTION_PHASES.has(gameState.phase));
  const canAct = isActionPhase
    && isMyTurn()
    && !!currentPlayer
    && !currentPlayer.waitingForBigBlind
    && !currentPlayer.hasFolded
    && !currentPlayer.isAllIn;
  const canCheckNow = canCheck();
  const highestBet = Math.max(0, ...(gameState?.players || []).map((player) => player.currentBet));
  const callAmount = currentPlayer ? Math.max(0, highestBet - currentPlayer.currentBet) : 0;
  const orderedPlayers = useMemo(() => {
    if (!gameState) {
      return [] as GameState['players'];
    }
    return [...gameState.players].sort((a, b) => {
      const aSeat = Number.isFinite(Number(a.seatNumber)) ? Number(a.seatNumber) : Number.MAX_SAFE_INTEGER;
      const bSeat = Number.isFinite(Number(b.seatNumber)) ? Number(b.seatNumber) : Number.MAX_SAFE_INTEGER;
      if (aSeat !== bSeat) {
        return aSeat - bSeat;
      }
      return a.id - b.id;
    });
  }, [gameState]);
  const currentTurnPlayer = useMemo(() => {
    if (!gameState || gameState.currentTurnPlayerId === null) {
      return null;
    }
    return orderedPlayers.find((player) => player.id === gameState.currentTurnPlayerId) || null;
  }, [gameState, orderedPlayers]);
  const timerWaitingLabel = useMemo(() => {
    if (!gameState || orderedPlayers.length <= 1) {
      return 'Waiting for other players to join';
    }
    if (currentTurnPlayer) {
      return `${currentTurnPlayer.username}'s turn to move`;
    }
    return 'Waiting for other players to join';
  }, [gameState, orderedPlayers.length, currentTurnPlayer]);
  const seatSlotsForLayout = useMemo(() => {
    const maxSeatFromPlayers = orderedPlayers.reduce((maxSeat, player) => {
      const seatNumber = Number(player.seatNumber);
      if (!Number.isFinite(seatNumber) || seatNumber <= 0) {
        return maxSeat;
      }
      return Math.max(maxSeat, Math.floor(seatNumber));
    }, 0);

    return Math.max(
      2,
      Number.isFinite(tableSeatCapacity) ? Math.floor(tableSeatCapacity) : 0,
      maxSeatFromPlayers,
      orderedPlayers.length
    );
  }, [orderedPlayers, tableSeatCapacity]);

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
  }, [handResult, extractUserId]);
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
  const emoteByUserId = useMemo(() => {
    const map = new Map<number, string>();
    activeEmotes.forEach((emote) => {
      map.set(emote.userId, emote.emoji);
    });
    return map;
  }, [activeEmotes]);

  const tableThemeStyles = useMemo(() => {
    const styles: CSSProperties = {};
    if (tableTheme.tableBackground) {
      (styles as Record<string, string>)['--table-background-image'] = tableTheme.tableBackground;
    }
    if (tableTheme.tableFelt) {
      (styles as Record<string, string>)['--table-felt-image'] = tableTheme.tableFelt;
    }
    if (tableTheme.cardFront) {
      (styles as Record<string, string>)['--card-front-image'] = tableTheme.cardFront;
    }
    if (tableTheme.cardBack) {
      (styles as Record<string, string>)['--card-back-image'] = tableTheme.cardBack;
    }
    return styles;
  }, [tableTheme]);

  useEffect(() => {
    const container = gameContainerRef.current;
    const tableStage = tableStageRef.current;
    if (!container || !tableStage) {
      return;
    }

    const readCssPixelValue = (styles: CSSStyleDeclaration, name: string, fallback: number) => {
      const rawValue = styles.getPropertyValue(name);
      const parsed = Number.parseFloat((rawValue || '').trim());
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const readCssUnitValue = (styles: CSSStyleDeclaration, name: string, fallback: number) => {
      const rawValue = styles.getPropertyValue(name);
      const parsed = Number.parseFloat((rawValue || '').trim());
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const syncLayoutTuning = () => {
      const styles = getComputedStyle(container);
      const stageRect = tableStage.getBoundingClientRect();
      if (stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      const circleSize = readCssPixelValue(styles, '--player-circle-size', 108);
      const pocketCardHeight = readCssPixelValue(styles, '--pocket-card-height', 44);
      const hiddenPocketRatio = Math.max(0, Math.min(1, readCssUnitValue(styles, '--pocket-card-hidden-ratio', 0.25)));
      const pocketCardLift = readCssPixelValue(styles, '--pocket-card-extra-lift', 2);

      const cardVisibleAboveCircle = pocketCardHeight * Math.max(0.2, 1 - hiddenPocketRatio);
      const pocketCardProtrusion = (circleSize * 0.5) + cardVisibleAboveCircle + pocketCardLift;
      const safeTop = pocketCardProtrusion + 16;
      const safeBottom = (circleSize * 0.55) + 12;
      const safeHorizontal = (circleSize * 0.56) + 12;
      const availableWidth = Math.max(220, stageRect.width - (safeHorizontal * 2));
      const availableHeight = Math.max(180, stageRect.height - safeTop - safeBottom);
      const stageAspect = stageRect.width / Math.max(1, stageRect.height);
      const targetAspect = Math.max(1.72, Math.min(2.35, stageAspect * 1.18));

      let tableWidth = availableWidth;
      let tableHeight = tableWidth / targetAspect;

      if (tableHeight > availableHeight) {
        tableHeight = availableHeight;
        tableWidth = tableHeight * targetAspect;
      }

      tableWidth = Math.max(Math.min(220, availableWidth), Math.min(availableWidth, Math.floor(tableWidth)));
      tableHeight = Math.max(Math.min(180, availableHeight), Math.min(availableHeight, Math.floor(tableHeight)));
      const verticalCenterBias = Math.round(Math.max(0, (safeTop - safeBottom) * 0.42));

      container.style.setProperty('--dynamic-table-width', `${tableWidth}px`);
      container.style.setProperty('--dynamic-table-height', `${tableHeight}px`);
      container.style.setProperty('--dynamic-table-shift-y', `${verticalCenterBias}px`);

      const nextTuning: TableLayoutTuning = {
        seatRadiusXPercent: 50,
        seatRadiusYPercent: 50,
        seatCardOffsetPx: Math.max(48, Math.min(tableWidth, tableHeight) * 0.17),
      };

      setTableLayoutTuning((previous) => {
        if (
          Math.abs(previous.seatRadiusXPercent - nextTuning.seatRadiusXPercent) < 0.01
          && Math.abs(previous.seatRadiusYPercent - nextTuning.seatRadiusYPercent) < 0.01
          && Math.abs(previous.seatCardOffsetPx - nextTuning.seatCardOffsetPx) < 0.01
        ) {
          return previous;
        }
        return nextTuning;
      });
    };

    syncLayoutTuning();

    const onWindowResize = () => {
      syncLayoutTuning();
    };

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onWindowResize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        syncLayoutTuning();
      });
      observer.observe(tableStage);
      observer.observe(container);
    }

    return () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onWindowResize);
      if (observer) {
        observer.disconnect();
      }
      container.style.removeProperty('--dynamic-table-width');
      container.style.removeProperty('--dynamic-table-height');
      container.style.removeProperty('--dynamic-table-shift-y');
    };
  }, [connected, hasGameState]);

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
      <div className="game-container" style={tableThemeStyles} ref={gameContainerRef}>
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
      <div className="game-container" style={tableThemeStyles} ref={gameContainerRef}>
        <div className="waiting-overlay">
          <h2>{spectatorMode ? 'Starting spectator mode...' : 'Waiting for game to start...'}</h2>
          <p>{spectatorMode ? 'Waiting for live table state.' : 'Please wait while other players join.'}</p>
          <button onClick={handleLeaveGame} className="btn-secondary">
            {spectatorMode ? 'Back to Community' : 'Leave Game'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container" style={tableThemeStyles} ref={gameContainerRef}>
      <div className="game-header">
        <h2>Poker Table</h2>
        <div className="game-info">
          <span>Street: {gameState.phase}</span>
          <span>Pot: {gameState.pot}</span>
          <span>Blinds: {gameState.smallBlind}/{gameState.bigBlind}</span>
        </div>
        <div className="game-header-actions">
          {spectatorMode && (
            <span className="spectator-badge">
              Spectating{spectatorHasSeat ? ' (your cards visible)' : ''}
            </span>
          )}
          <RulesScrollHelp variant="game" />
          <button onClick={handleLeaveGame} className="btn-leave">
            Leave
          </button>
        </div>
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
        <section className="table-stage" ref={tableStageRef}>
          <div className="game-table" ref={gameTableRef}>
            <div className="table-center">
              <div className="pot-display">
                <div className="pot-line">Total Pot: ${gameState.pot}</div>
                {(gameState.sidePots || []).length > 0 && (
                  <div className="side-pot-list">
                    {(gameState.sidePots || []).map((sidePot) => (
                      <div key={`side-pot-${sidePot.index}`} className="side-pot-chip">
                        Side Pot {Math.max(1, sidePot.index - 1)}: ${sidePot.amount}
                      </div>
                    ))}
                  </div>
                )}
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
                const seatLayout = getSeatLayout(player.seatNumber, seatSlotsForLayout, index);
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
                  !player.waitingForBigBlind &&
                  !player.hasFolded &&
                  isActionPhase
                );
                const showOwnPocketCards = Boolean(
                  isCurrentUser &&
                  !showRevealedCards &&
                  !player.waitingForBigBlind &&
                  !player.hasFolded &&
                  Array.isArray(player.hand) &&
                  player.hand.length > 0
                );
                const revealedPocketCards = showRevealedCards && revealData ? revealData.holeCards : null;
                const visiblePocketCards = showOwnPocketCards
                  ? player.hand || null
                  : (revealedPocketCards && revealedPocketCards.length > 0 ? revealedPocketCards : null);
                const showSeatPocketCards = showFaceDownCards || Boolean(visiblePocketCards && visiblePocketCards.length > 0);
                const betOffsetPx = Math.max(52, tableLayoutTuning.seatCardOffsetPx * 0.62);
                const roleBadges: string[] = [];

                if (gameState.dealerPlayerId === player.id) roleBadges.push('D');
                if (gameState.smallBlindPlayerId === player.id) roleBadges.push('SB');
                if (gameState.bigBlindPlayerId === player.id) roleBadges.push('BB');
                if (player.isApiBot) roleBadges.push('BOT');

                return (
                  <div
                    key={player.id}
                    className={`player-seat ${isCurrentUser ? 'current-user' : ''} ${isActiveTurn ? 'active-turn' : ''} ${player.hasFolded ? 'folded' : ''} ${player.waitingForBigBlind ? 'waiting-big-blind' : ''} ${showRevealedCards ? 'revealed-hand' : ''}`}
                    style={{ left: `${seatLayout.leftPercent}%`, top: `${seatLayout.topPercent}%` }}
                  >
                    {emoteByUserId.get(player.id) && (
                      <div className="seat-emote-bubble">{emoteByUserId.get(player.id)}</div>
                    )}
                    {player.currentBet > 0 && (
                      <div
                        className="seat-bet-chip"
                        style={{
                          '--bet-offset-x': `${Math.cos(seatLayout.angle) * -betOffsetPx}px`,
                          '--bet-offset-y': `${Math.sin(seatLayout.angle) * -betOffsetPx}px`,
                        } as CSSProperties}
                      >
                        ${player.currentBet}
                      </div>
                    )}
                    {showSeatPocketCards && (
                      <div className="seat-pocket-cards" aria-hidden="true">
                        {visiblePocketCards && visiblePocketCards.length > 0
                          ? visiblePocketCards.map((card, cardIndex) =>
                              renderCard(
                                card,
                                cardIndex,
                                `seat-pocket-card ${showOwnPocketCards && animatedHoleCardIndexes.includes(cardIndex) ? 'deal-in' : ''}`,
                                showOwnPocketCards && animatedHoleCardIndexes.includes(cardIndex) ? cardIndex * 220 : 0
                              )
                            )
                          : (
                            <>
                              {renderFaceDownCard(`${player.id}-fd1`, 'seat-pocket-card seat-pocket-card-back')}
                              {renderFaceDownCard(`${player.id}-fd2`, 'seat-pocket-card seat-pocket-card-back')}
                            </>
                          )}
                      </div>
                    )}
                    <div
                      className="player-circle"
                      style={getActiveTurnMeterStyle(player.id)}
                      onClick={() => openPlayerNotesPanel(player)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openPlayerNotesPanel(player);
                        }
                      }}
                      aria-label={`Open note panel for ${player.username}`}
                    >
                      <div className="player-avatar-shell">
                        {player.profileImageUrl ? (
                          <img className="player-avatar-image" src={player.profileImageUrl} alt={`${player.username} avatar`} />
                        ) : (
                          <span className="player-avatar-placeholder" aria-hidden="true" />
                        )}
                      </div>
                      <div className="player-name">{player.username}</div>
                      <div className="player-stack">${player.stack}</div>
                      <div className="player-badges">
                        {roleBadges.map((badge) => (
                          <span key={badge} className={`seat-role-badge ${badge === 'BOT' ? 'bot' : ''}`}>{badge}</span>
                        ))}
                        {player.waitingForBigBlind && <span className="status-badge waiting">WAIT BB</span>}
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
          <div className="post-hand-controls-slot">
            {handResult && currentPlayerReveal && currentPlayerReveal.holeCards.length > 0 && (
              <button
                type="button"
                className="btn-toggle-own-show"
                onClick={() => {
                  if (!socket || !connected || !currentPlayer) {
                    return;
                  }
                  if (spectatorMode) {
                    return;
                  }
                  socket.emit('show_hand_choice', {
                    show: !revealedShowdownHandsByUserId[currentPlayer.id],
                  });
                }}
                disabled={spectatorMode}
              >
                {currentPlayer && revealedShowdownHandsByUserId[currentPlayer.id] ? 'Hide My Cards' : 'Show My Cards'}
              </button>
            )}
          </div>

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
                <p>{spectatorMode ? 'Spectating table' : 'Syncing your seat...'}</p>
              </div>
            )}

            {!!currentPlayer && currentPlayer.waitingForBigBlind && !bustMessage && (
              <div className="waiting-turn">
                <p>Seated. Waiting until your big blind to enter.</p>
              </div>
            )}

            {currentPlayer?.hasFolded && (
              <div className="folded-message">
                <p>You folded this hand. Waiting for next hand...</p>
              </div>
            )}
          </div>

          <div className="emote-row">
            {QUICK_EMOTES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="btn-emote"
                onClick={() => sendEmote(emoji)}
                title={`Send ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <ActionTimer
            turnSeconds={gameState.actionTimeoutSeconds}
            remainingTurnSeconds={gameState.remainingActionTime}
            reserveSeconds={currentPlayer?.timeBankSeconds}
            isMyTurn={isMyTurn()}
            waitingLabel={timerWaitingLabel}
          />
        </section>
      </div>

      {noteTargetPlayer && (
        <div className="player-note-overlay" onClick={closePlayerNotesPanel}>
          <div className="player-note-panel" onClick={(event) => event.stopPropagation()}>
            <div className="player-note-header">
              <h4>{noteTargetPlayer.username}</h4>
              <button type="button" className="player-note-close" onClick={closePlayerNotesPanel}>
                Close
              </button>
            </div>

            {noteTargetPlayer.id === user?.id ? (
              <div className="player-note-self-hint">Notes are available only for other players.</div>
            ) : (
              <>
                <div className="player-note-subtitle">Private notes saved across all tables and communities.</div>
                <textarea
                  className="player-note-textarea"
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder={`Add reads on ${noteTargetPlayer.username}...`}
                  maxLength={2000}
                  disabled={noteLoading || noteSaving}
                />
                <div className="player-note-footer">
                  <button
                    type="button"
                    className="player-note-save"
                    disabled={noteLoading || noteSaving}
                    onClick={savePlayerNotes}
                  >
                    {noteSaving ? 'Saving...' : 'Save Notes'}
                  </button>
                </div>
                {noteLoading && <div className="player-note-info">Loading notes...</div>}
                {noteError && <div className="player-note-error">{noteError}</div>}
                {noteInfo && <div className="player-note-info">{noteInfo}</div>}
              </>
            )}
          </div>
        </div>
      )}

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
