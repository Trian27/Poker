import { Server, Socket } from 'socket.io';
import { Game, GameConfig, HandResult } from './engine/Game';
import { Player } from './engine/Player';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { GameStateStorage, redis } from './redis';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';

const PORT = parseInt(process.env.PORT || '3000');
const FASTAPI_URL = process.env.AUTH_API_URL || 'http://localhost:8000';

interface ConnectedPlayer {
  socketId: string;
  playerId: string;
  playerName: string;
  userId: number;
  communityId?: number;
  gameId?: string;
}

interface AuthenticatedUser {
  id: number;
  username: string;
  email?: string;  // Optional since WebSocket auth doesn't need it
}

interface ChatMessage {
  id: string;
  userId: number;
  username: string;
  message: string;
  timestamp: number;
  gameId?: string;
}

interface TableEmoteMessage {
  id: string;
  userId: number;
  username: string;
  emoji: string;
  timestamp: number;
}

interface DisconnectedPlayer {
  playerInfo: ConnectedPlayer;
  gameId: string;
  disconnectTime: number;
  cachedGameState?: ReturnType<Game['getPlayerGameState']>;
  cachedChatMessages?: ChatMessage[];
}

// Extend socket with user data
interface AuthenticatedSocket extends Socket {
  data: {
    user: AuthenticatedUser;
  };
}

interface TableReadiness {
  gameId: string;
  communityId?: number;
  tableName?: string;
  seatedPlayers: Set<string>; // userIds of players seated via FastAPI
  connectedPlayers: Set<string>; // userIds of players connected via WebSocket
  playerIds: Map<string, string>; // userId -> playerId mapping
  gameStarted: boolean;
}
/**
 * Real-time poker game server using Socket.io
 */
export class PokerServer {
  private io: Server;
  // Note: games Map removed - now using Redis for persistence
  private connectedPlayers: Map<string, ConnectedPlayer> = new Map();
  private lobby: string[] = []; // Socket IDs waiting for a game
  private playerGameMap: Map<string, string> = new Map(); // playerId -> gameId
  private userIdToSocketId: Map<number, string> = new Map(); // userId -> socketId for reconnection
  private disconnectedPlayers: Map<string, DisconnectedPlayer> = new Map(); // socketId -> DisconnectedPlayer
  private chatHistory: Map<string, ChatMessage[]> = new Map(); // gameId -> messages
  private tableReadiness: Map<string, TableReadiness> = new Map(); // gameId -> table readiness state
  private recentlyReconnected: Set<string> = new Set(); // playerId -> marker to avoid immediate reconnection loops
  private actionTimers: Map<string, NodeJS.Timeout> = new Map(); // gameId -> timeout handle
  private disconnectCleanupTimers: Map<string, NodeJS.Timeout> = new Map(); // socketId -> reconnect timeout
  private showdownCardReveals: Map<string, Map<number, boolean>> = new Map(); // gameId -> userId -> shown
  private apiDrivenUsersByGame: Map<string, Set<number>> = new Map(); // gameId -> userIds acting via agent API
  private spectatorsByGame: Map<string, Map<string, number>> = new Map(); // gameId -> socketId -> userId
  private spectatorSocketToGame: Map<string, string> = new Map(); // socketId -> gameId
  private spectatorReadOnlySockets: Set<string> = new Set(); // sockets that requested spectator mode
  private readonly RECONNECT_TIMEOUT = 30000; // 30 seconds to reconnect
  private readonly HAND_RESULT_DELAY = 7000; // 7 seconds to show showdown results
  private staleTableSweepTimer?: NodeJS.Timeout;
  private server: any; // HTTP server instance
  private app: express.Application; // Express app

  constructor(port: number) {
    // Create Express app
    this.app = express();
    this.app.use(bodyParser.json());
    
    // Create HTTP server with Express
    const httpServer = require('http').createServer(this.app);
    this.server = httpServer;
    httpServer.on('close', () => {
      this.clearAllActionTimers();
      this.clearAllDisconnectCleanupTimers();
      if (this.staleTableSweepTimer) {
        clearInterval(this.staleTableSweepTimer);
        this.staleTableSweepTimer = undefined;
      }
    });
    
    this.io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupAuthMiddleware();
    this.setupSocketHandlers();
    this.setupHttpEndpoints(); // Add HTTP endpoints for agent API
    this.startStaleTableSweep();
    
    httpServer.listen(port, () => {
      console.log(`🎰 Poker server running on port ${port}`);
      console.log(`   - Socket.IO for real-time game play`);
      console.log(`   - HTTP endpoints for agent API`);
    });
  }

  private startStaleTableSweep(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const intervalMs = Math.max(15000, Number(process.env.STALE_TABLE_SWEEP_MS || 30000));
    const runSweep = async (): Promise<void> => {
      try {
        const gameIds = await GameStateStorage.getAllGameIds();
        const tableGameIds = gameIds.filter((gameId) => /^table_\d+$/.test(gameId));
        for (const gameId of tableGameIds) {
          await this.checkAndCleanupTable(gameId);
        }
      } catch (error: any) {
        console.warn(`⚠️  Failed stale-table sweep: ${error?.message || error}`);
      }
    };

    void runSweep();
    this.staleTableSweepTimer = setInterval(() => {
      void runSweep();
    }, intervalMs);
    this.staleTableSweepTimer.unref?.();
  }

  /**
   * Verify JWT token with FastAPI before allowing socket connection
   */
  private setupAuthMiddleware(): void {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // In test environments, validate JWT locally to avoid external dependency
        if (process.env.NODE_ENV === 'test') {
          try {
            const decoded = jwt.verify(
              token,
              process.env.JWT_SECRET || 'test-secret-key-change-in-production'
            ) as JwtPayload;

            socket.data.user = {
              id: Number(decoded.id),
              username: decoded.username || 'test-user'
            };
            return next();
          } catch (err) {
            return next(new Error('Authentication failed: Invalid token'));
          }
        }

        // Verify token with FastAPI (POST with JSON body)
        const response = await axios.post(`${FASTAPI_URL}/api/internal/auth/verify`, {
          token: token
        });

        if (response.data && response.data.user_id) {
          // Attach user data to socket
          socket.data.user = {
            id: response.data.user_id,
            username: response.data.username
          };
          console.log(`🔐 Authenticated: ${response.data.username} (ID: ${response.data.user_id})`);
          next();
        } else {
          return next(new Error('Authentication failed: Invalid token'));
        }
      } catch (error: any) {
        console.error('Authentication error:', error.response?.data || error.message);
        return next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Debit player's wallet for game buy-in
   */
  private async debitWallet(userId: number, communityId: number, amount: number, description: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    const payload = {
      user_id: userId,
      community_id: communityId,
      amount,
      description
    };
    const endpointCandidates = [
      '/api/internal/wallets/debit',
      '/api/internal/wallet/debit', // Backward-compatible fallback for older auth-api images.
    ];

    let lastError: any = null;
    try {
      for (const endpoint of endpointCandidates) {
        try {
          const response = await axios.post(`${FASTAPI_URL}${endpoint}`, payload);
          if (response.data.success) {
            console.log(`💰 Debited ${amount} from user ${userId} wallet. New balance: ${response.data.new_balance}`);
            return true;
          }
          lastError = new Error(response.data?.message || 'Wallet debit failed');
          break;
        } catch (error: any) {
          const statusCode = Number(error?.response?.status || 0);
          // Try next endpoint when route is missing.
          if (statusCode === 404) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
    } catch (error: any) {
      lastError = error;
    }

    if (lastError) {
      console.error(`❌ Failed to debit wallet for user ${userId}:`, lastError.response?.data || lastError.message);
    } else {
      console.error(`❌ Failed to debit wallet for user ${userId}: unknown error`);
    }
    return false;
  }

  private async resolveCommunityIdForGame(gameId: string, preferredCommunityId?: number): Promise<number | undefined> {
    if (Number.isFinite(preferredCommunityId) && Number(preferredCommunityId) > 0) {
      return Number(preferredCommunityId);
    }

    const tableState = this.tableReadiness.get(gameId);
    if (tableState?.communityId && Number.isFinite(tableState.communityId) && Number(tableState.communityId) > 0) {
      return Number(tableState.communityId);
    }

    const tableIdMatch = gameId.match(/^table_(\d+)$/);
    if (!tableIdMatch || process.env.NODE_ENV === 'test') {
      return undefined;
    }

    try {
      const tableId = parseInt(tableIdMatch[1], 10);
      const response = await axios.get(`${FASTAPI_URL}/api/internal/tables/${tableId}`);
      const resolvedCommunityId = Number(response.data?.community_id);
      if (Number.isFinite(resolvedCommunityId) && resolvedCommunityId > 0) {
        if (tableState) {
          tableState.communityId = resolvedCommunityId;
        }
        return resolvedCommunityId;
      }
    } catch (error: any) {
      console.warn(`⚠️  Failed to resolve community ID for ${gameId}:`, error.response?.data || error.message);
    }

    return undefined;
  }

  /**
   * Credit player's wallet for game winnings
   */
  private async creditWallet(userId: number, communityId: number, amount: number, description: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    const payload = {
      user_id: userId,
      community_id: communityId,
      amount,
      description
    };
    const endpointCandidates = [
      '/api/internal/wallets/credit',
      '/api/internal/wallet/credit', // Backward-compatible fallback for older auth-api images.
    ];

    let lastError: any = null;
    try {
      for (const endpoint of endpointCandidates) {
        try {
          const response = await axios.post(`${FASTAPI_URL}${endpoint}`, payload);
          if (response.data.success) {
            console.log(`💰 Credited ${amount} to user ${userId} wallet. New balance: ${response.data.new_balance}`);
            return true;
          }
          lastError = new Error(response.data?.message || 'Wallet credit failed');
          break;
        } catch (error: any) {
          const statusCode = Number(error?.response?.status || 0);
          // Try next endpoint when route is missing.
          if (statusCode === 404) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }
    } catch (error: any) {
      lastError = error;
    }

    if (lastError) {
      console.error(`❌ Failed to credit wallet for user ${userId}:`, lastError.response?.data || lastError.message);
    } else {
      console.error(`❌ Failed to credit wallet for user ${userId}: unknown error`);
    }
    return false;
  }

  /**
   * Resolve a seated player's current stack and refund it to community wallet.
   */
  private async refundLeavingPlayerStack(
    gameId: string,
    userId: number,
    username: string,
    stackAmount: number,
    preferredCommunityId?: number
  ): Promise<void> {
    if (stackAmount <= 0) {
      return;
    }

    const communityId = await this.resolveCommunityIdForGame(gameId, preferredCommunityId);
    if (!communityId) {
      console.warn(`⚠️  Could not resolve community ID for ${username} (${userId}) leaving ${gameId}. Stack refund skipped.`);
      return;
    }

    const credited = await this.creditWallet(
      userId,
      communityId,
      stackAmount,
      `Refund from leaving game: ${stackAmount} chips`
    );
    if (credited) {
      console.log(`💸 ${username} refunded ${stackAmount} chips`);
    } else {
      console.warn(`⚠️  Failed refunding ${stackAmount} chips to ${username} (${userId}) for ${gameId}`);
    }
  }

  private findPlayerByUserId(game: Game, userId: number): Player | undefined {
    return game.getPlayers().find((player) => this.extractUserIdFromPlayerId(player.id) === userId);
  }

  private async removeAndRefundPlayerFromGame(
    gameId: string,
    userId: number,
    username: string,
    preferredCommunityId?: number
  ): Promise<{ removed: boolean; remainingPlayers: number; gameStateUpdated: boolean }> {
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      return { removed: false, remainingPlayers: 0, gameStateUpdated: false };
    }

    const game = Game.fromJSON(gameData);
    const leavingPlayer = this.findPlayerByUserId(game, userId);
    if (!leavingPlayer) {
      return { removed: false, remainingPlayers: game.getPlayers().length, gameStateUpdated: false };
    }

    await this.refundLeavingPlayerStack(
      gameId,
      userId,
      username,
      leavingPlayer.getStack(),
      preferredCommunityId
    );

    if (!game.removePlayer(leavingPlayer.id)) {
      return { removed: false, remainingPlayers: game.getPlayers().length, gameStateUpdated: false };
    }

    this.playerGameMap.delete(leavingPlayer.id);
    this.clearApiDrivenUser(gameId, userId);

    const remainingPlayers = game.getPlayers().length;
    if (remainingPlayers > 0) {
      await GameStateStorage.saveGameState(gameId, game.toJSON());
      return { removed: true, remainingPlayers, gameStateUpdated: true };
    }

    await GameStateStorage.deleteGameState(gameId);
    this.clearActionTimer(gameId);
    this.showdownCardReveals.delete(gameId);
    this.apiDrivenUsersByGame.delete(gameId);
    return { removed: true, remainingPlayers: 0, gameStateUpdated: false };
  }

  /**
   * Check if a table should be deleted (non-permanent tables with no players)
   */
  private async purgeLocalTableRuntime(gameId: string): Promise<void> {
    await GameStateStorage.deleteGameState(gameId);
    this.clearActionTimer(gameId);
    this.showdownCardReveals.delete(gameId);
    this.apiDrivenUsersByGame.delete(gameId);
    this.tableReadiness.delete(gameId);

    const gameSpectators = this.spectatorsByGame.get(gameId);
    if (gameSpectators) {
      for (const socketId of gameSpectators.keys()) {
        this.spectatorSocketToGame.delete(socketId);
        this.spectatorReadOnlySockets.delete(socketId);
      }
      this.spectatorsByGame.delete(gameId);
    }

    this.io.in(gameId).socketsLeave(gameId);

    for (const [playerId, mappedGameId] of Array.from(this.playerGameMap.entries())) {
      if (mappedGameId === gameId) {
        this.playerGameMap.delete(playerId);
      }
    }

    for (const [socketId, playerInfo] of Array.from(this.connectedPlayers.entries())) {
      if (playerInfo.gameId === gameId) {
        this.connectedPlayers.set(socketId, {
          ...playerInfo,
          gameId: undefined
        });
      }
    }

    for (const [socketId, disconnectedInfo] of Array.from(this.disconnectedPlayers.entries())) {
      if (disconnectedInfo.gameId === gameId) {
        this.disconnectedPlayers.delete(socketId);
      }
    }
  }

  private async checkAndCleanupTable(gameId: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return false; // Skip cleanup in tests
    }

    try {
      // Extract table ID from gameId (format: table_123)
      const tableIdMatch = gameId.match(/^table_(\d+)$/);
      if (!tableIdMatch) {
        return false;
      }

      const tableId = parseInt(tableIdMatch[1]);

      // Always ask auth-api; it is the source of truth for seat occupancy/permanence.
      const response = await axios.post(`${FASTAPI_URL}/api/internal/tables/${tableId}/check-cleanup`);
      const deleted = Boolean(response.data?.deleted);
      const tableMissing = String(response.data?.message || '').toLowerCase().includes('not found');

      if (deleted || tableMissing) {
        await this.purgeLocalTableRuntime(gameId);
      }

      if (deleted) {
        console.log(`🗑️  Non-permanent table ${tableId} deleted - no players remaining`);
      } else if (tableMissing) {
        console.log(`🧹 Cleared stale local runtime for missing table ${tableId}`);
      }
      return deleted;
    } catch (error: any) {
      console.error(`⚠️  Failed to check table cleanup for ${gameId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Unseat a player from a table in the database
   */
  private async unseatPlayer(gameId: string, userId: number): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return; // Skip in tests
    }

    try {
      // Extract table ID from gameId (format: table_123)
      const tableIdMatch = gameId.match(/^table_(\d+)$/);
      if (!tableIdMatch) return;

      const tableId = parseInt(tableIdMatch[1]);

      // Call FastAPI to unseat the player
      await axios.post(`${FASTAPI_URL}/api/internal/tables/${tableId}/unseat/${userId}`);
      
      // Update local tracking
      const tableState = this.tableReadiness.get(gameId);
      if (tableState) {
        tableState.seatedPlayers.delete(userId.toString());
        tableState.playerIds?.delete(userId.toString());
        console.log(`💺 User ${userId} unseated from table ${tableId}`);
      }
    } catch (error: any) {
      console.error(`⚠️  Failed to unseat player from ${gameId}:`, error.response?.data || error.message);
    }
  }

  /**
   * Handle player WebSocket connection and check if game should start
   */
  private async handlePlayerWebSocketConnection(user: AuthenticatedUser, socketId: string): Promise<void> {
    await this.handlePlayerWebSocketConnectionForGame(user, socketId);
  }

  private normalizeRequestedGameId(rawGameId: unknown, rawTableId: unknown): string | undefined {
    if (typeof rawGameId === 'string') {
      const trimmed = rawGameId.trim();
      if (/^table_\d+$/.test(trimmed)) {
        return trimmed;
      }
    }

    const numericTableId = Number(rawTableId);
    if (Number.isFinite(numericTableId) && numericTableId > 0) {
      return `table_${Math.floor(numericTableId)}`;
    }

    return undefined;
  }

  private async handlePlayerWebSocketConnectionForGame(
    user: AuthenticatedUser,
    socketId: string,
    requestedGameId?: string
  ): Promise<void> {
    const userIdStr = user.id.toString();
    let matchedRequestedGame = false;

    // Find all tables where this user is seated
    for (const [gameId, tableState] of this.tableReadiness.entries()) {
      if (requestedGameId && gameId !== requestedGameId) {
        continue;
      }
      if (tableState.seatedPlayers.has(userIdStr)) {
        matchedRequestedGame = true;
        if (!tableState.playerIds) {
          tableState.playerIds = new Map();
        }
        // Mark player as connected
  tableState.connectedPlayers.add(userIdStr);
        
        // Join the Socket.IO room for this game
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.join(gameId);
          console.log(`🎮 Player ${user.id} joined room: ${gameId}`);
        }

        console.log(`📋 Table ${gameId}: ${tableState.seatedPlayers.size} seated, ${tableState.connectedPlayers.size} connected`);

        // Resolve the player's unique game-specific ID
        let playerId = tableState.playerIds.get(userIdStr);

        if (!playerId) {
          const gameData = await GameStateStorage.loadGameState(gameId);
          if (gameData) {
            const game = Game.fromJSON(gameData);
            const player = game.getPlayers().find((p: any) => {
              const match = p.id.match(/^player_(\d+)_/);
              return match ? Number(match[1]) === user.id : p.name === user.username;
            });
            if (player) {
              playerId = player.id;
              tableState.playerIds.set(userIdStr, player.id);
              this.playerGameMap.set(player.id, gameId);
            }
          }
        }

        if (playerId) {
          const existing = this.connectedPlayers.get(socketId);
          const playerInfo: ConnectedPlayer = {
            socketId,
            playerId,
            playerName: user.username,
            userId: user.id,
            communityId: tableState.communityId,
            gameId
          };
          this.connectedPlayers.set(socketId, { ...existing, ...playerInfo });

          // Always provide an immediate snapshot so clients don't get stuck waiting
          // when gameStarted is already true and no broadcast is triggered.
          const liveGameData = await GameStateStorage.loadGameState(gameId);
          if (liveGameData) {
            try {
              const liveGame = Game.fromJSON(liveGameData);
              this.emitPlayerState(socketId, gameId, playerId, liveGame);
              const revealState = this.showdownCardReveals.get(gameId);
              if (revealState) {
                for (const [revealedUserId, show] of revealState.entries()) {
                  if (show) {
                    this.io.to(socketId).emit('player_show_hand_update', {
                      userId: revealedUserId,
                      show: true
                    });
                  }
                }
              }
            } catch (error: any) {
              console.warn(`⚠️  Failed to emit immediate game state for ${user.username}:`, error.message);
            }
          }
        } else {
          console.warn(`⚠️  Could not resolve playerId for user ${user.id} in ${gameId}`);
        }

        // Check if we should start the game
        await this.checkAndStartGame(gameId);
      }
    }

    if (requestedGameId && !matchedRequestedGame) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        this.io.to(socket.id).emit('error', {
          message: 'No active seat found for requested table. Join a seat first.',
        });
      }
    }
  }

  /**
   * Check if a game should start and start it if ready
   */
  private async checkAndStartGame(gameId: string): Promise<void> {
    const tableState = this.tableReadiness.get(gameId);
    if (!tableState) return;

    // Don't start if already started
    if (tableState.gameStarted) return;

    // Check if we have at least 2 players who are both seated AND connected
    const readyPlayerCount = Array.from(tableState.seatedPlayers).filter(userId =>
      tableState.connectedPlayers.has(userId)
    ).length;

    if (readyPlayerCount >= 2) {
      console.log(`🚀 Starting game ${gameId} with ${readyPlayerCount} players!`);

      // Load game from Redis
      const gameData = await GameStateStorage.loadGameState(gameId);
      if (!gameData) {
        console.error(`❌ Cannot start game ${gameId} - no game data found`);
        return;
      }

      const game = Game.fromJSON(gameData);
      const stage = game.getStage();
      const hasActiveHand = stage !== 'waiting' && stage !== 'complete';

      try {
        if (hasActiveHand) {
          tableState.gameStarted = true;
          if (stage !== 'showdown') {
            const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
            this.startActionTimer(gameId, timeoutSeconds);
          }
          await this.broadcastGameState(gameId);
          return;
        }

        tableState.gameStarted = true;

        // Start the hand
        game.startHand();
        console.log(`🎲 Hand started for game ${gameId}`);

        // Save updated game state
        await GameStateStorage.saveGameState(gameId, game.toJSON());

        // Start action timer if configured
        const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
        this.startActionTimer(gameId, timeoutSeconds);
        console.log(`⏰ Action timer started: ${timeoutSeconds} seconds`);

        // Broadcast game state to all players in the room
        await this.broadcastGameState(gameId);
      } catch (error: any) {
        console.error(`❌ Error starting game ${gameId}:`, error.message);
        tableState.gameStarted = false; // Reset if failed
      }
    } else {
      console.log(`⏳ Waiting for more players at ${gameId}: ${readyPlayerCount}/2 ready`);
    }
  }

  /**
   * Handle player reconnection
   */
  private async handleReconnection(socket: AuthenticatedSocket, oldSocketId: string): Promise<void> {
    const disconnectedInfo = this.disconnectedPlayers.get(oldSocketId);
    
    if (!disconnectedInfo) return;

    const { playerInfo, gameId, cachedGameState, cachedChatMessages } = disconnectedInfo;
    const user = socket.data.user;

    // Restore playerGameMap entry if it was removed
    const currentGameId = this.playerGameMap.get(playerInfo.playerId);
    if (!currentGameId) {
      // Player's game mapping was lost, restore from disconnection record
      this.playerGameMap.set(playerInfo.playerId, gameId);
      console.log(`🔧 Restored playerGameMap for ${user.username} → ${gameId}`);
    } else if (currentGameId !== gameId) {
      console.warn(`⚠️  Stale reconnection for ${user.username}. Expected ${gameId}, but player now in ${currentGameId}. Skipping.`);
      this.connectedPlayers.delete(oldSocketId);
      this.disconnectedPlayers.delete(oldSocketId);
      this.clearDisconnectCleanupTimer(oldSocketId);
      return;
    }

    console.log(`🔄 Player reconnecting: ${user.username} (old: ${oldSocketId}, new: ${socket.id})`);

    // Update the player info with new socket ID
    const updatedPlayerInfo: ConnectedPlayer = {
      ...playerInfo,
      socketId: socket.id,
      gameId
    };

    // Update all mappings
    this.connectedPlayers.delete(oldSocketId);
    this.connectedPlayers.set(socket.id, updatedPlayerInfo);

    // Remove from disconnected list
    this.disconnectedPlayers.delete(oldSocketId);
    this.clearDisconnectCleanupTimer(oldSocketId);

    // Re-add to table readiness tracking
    for (const [gId, tableState] of this.tableReadiness.entries()) {
      if (gId === gameId && tableState.seatedPlayers.has(user.id.toString())) {
        tableState.connectedPlayers.add(user.id.toString());
        console.log(`📋 Player ${user.id} reconnected to ${gameId}. ${tableState.connectedPlayers.size}/${tableState.seatedPlayers.size} connected`);
      }
    }

    // Rejoin the game room
    socket.join(gameId);

    // Send current game state
    const gameData = await GameStateStorage.loadGameState(gameId);
    let gameStateForPlayer: ReturnType<Game['getPlayerGameState']> | undefined = cachedGameState;

    if (gameData) {
      try {
        const game = Game.fromJSON(gameData);
        gameStateForPlayer = game.getPlayerGameState(playerInfo.playerId);
      } catch (err) {
        console.warn(`⚠️  Failed to load live game state for reconnection (${gameId}):`, (err as Error).message);
      }
    }

    if (!gameStateForPlayer) {
      console.warn(`⚠️  Missing game state for ${user.username} on reconnection, sending empty snapshot.`);
      gameStateForPlayer = {
        ...new Game({ smallBlind: 10, bigBlind: 20, initialStack: 0 }).getGameState(),
        myCards: []
      } as ReturnType<Game['getPlayerGameState']>;
    }

    this.io.to(socket.id).emit('reconnected', {
      message: 'Successfully reconnected to game',
      gameId,
      gameState: gameStateForPlayer,
      botUserIds: this.getApiDrivenUserIds(gameId),
    });

    const chatMessages = (cachedChatMessages && cachedChatMessages.length > 0)
      ? cachedChatMessages
      : this.chatHistory.get(gameId) || [];

    this.io.to(socket.id).emit('chat_history', { messages: chatMessages });

    // Notify other players
    socket.to(gameId).emit('player_reconnected', {
      playerName: user.username
    });

    console.log(`✅ ${user.username} reconnected to game ${gameId}`);

    this.recentlyReconnected.add(updatedPlayerInfo.playerId);
    setTimeout(() => {
      this.recentlyReconnected.delete(updatedPlayerInfo.playerId);
    }, 5000);
  }

  /**
   * Handle chat messages
   */
  private handleChatMessage(socket: AuthenticatedSocket, message: string, gameId?: string): void {
    const user = socket.data.user;
    const trimmedMessage = String(message ?? '').trim();
    if (!trimmedMessage || trimmedMessage.length === 0) {
      socket.emit('error', { message: 'Cannot send empty message' });
      return;
    }

    const playerInfo = this.connectedPlayers.get(socket.id);

    // Get the actual game ID if not provided
    const actualGameId = gameId || (playerInfo ? this.playerGameMap.get(playerInfo.playerId) : undefined);
    
    const chatMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      userId: user.id,
      username: user.username,
      message: trimmedMessage,
      timestamp: Date.now(),
      gameId: actualGameId
    };

    // Store message in history
    if (actualGameId) {
      if (!this.chatHistory.has(actualGameId)) {
        this.chatHistory.set(actualGameId, []);
      }
      const messages = this.chatHistory.get(actualGameId)!;
      messages.push(chatMessage);

      // Keep only last 100 messages
      if (messages.length > 100) {
        messages.shift();
      }

      // Broadcast to game room
      this.io.to(actualGameId).emit('chat_message', chatMessage);
      console.log(`💬 ${user.username}: ${trimmedMessage}`);
    } else {
      // Send to just this socket if not in a game
      this.io.to(socket.id).emit('chat_message', chatMessage);
    }
  }

  private handleTableEmote(socket: AuthenticatedSocket, emoji: string): void {
    const user = socket.data.user;
    const playerInfo = this.connectedPlayers.get(socket.id);
    if (!playerInfo) {
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;
    if (!gameId) {
      this.io.to(socket.id).emit('error', { message: 'You are not in a game' });
      return;
    }

    const normalizedEmoji = (emoji || '').trim();
    if (!normalizedEmoji || normalizedEmoji.length > 16) {
      this.io.to(socket.id).emit('error', { message: 'Invalid emote' });
      return;
    }

    const emoteMessage: TableEmoteMessage = {
      id: `emote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      username: user.username,
      emoji: normalizedEmoji,
      timestamp: Date.now(),
    };

    this.io.to(gameId).emit('table_emote', emoteMessage);
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      const user = socket.data.user;
      console.log(`✅ Player connected: ${user.username} (${socket.id})`);

      const wantsSpectatorMode = socket.handshake.auth?.spectator === true
        || socket.handshake.auth?.spectator === 'true'
        || socket.handshake.auth?.readonly === true
        || socket.handshake.auth?.readonly === 'true';

      // Track user to socket mapping for reconnection
      const oldSocketId = this.userIdToSocketId.get(user.id);
      this.userIdToSocketId.set(user.id, socket.id);

      const requestedGameId = this.normalizeRequestedGameId(
        socket.handshake.auth?.gameId,
        socket.handshake.auth?.tableId
      );

      // Check if user is seated at any table and mark them as connected
      // unless this socket requested read-only spectator mode.
      if (!wantsSpectatorMode) {
        this.handlePlayerWebSocketConnectionForGame(user, socket.id, requestedGameId).catch((error) => {
          console.error('❌ Failed to bind player socket to requested table:', error);
        });
      }

      // Notify client that connection is ready
      this.io.to(socket.id).emit('connected', {
        message: 'Connected to poker server',
        socketId: socket.id
      });

      // Check if this is a reconnection
      if (oldSocketId && this.disconnectedPlayers.has(oldSocketId)) {
        this.handleReconnection(socket, oldSocketId);
      }

      const handleJoin = async ({ communityId }: { communityId: number }) => {
        const existingPlayer = this.connectedPlayers.get(socket.id);

        // If this socket is already attached to a table game, ignore lobby join events.
        // This prevents remapping the player to a temporary lobby ID and breaking actions.
        if (existingPlayer?.gameId) {
          const gameData = await GameStateStorage.loadGameState(existingPlayer.gameId);
          if (gameData) {
            const game = Game.fromJSON(gameData);
            this.emitPlayerState(socket.id, existingPlayer.gameId, existingPlayer.playerId, game);
          }
          return;
        }

        this.handleJoinLobby(socket, communityId);
      };

      socket.on('join_game', (payload: { communityId: number }) => {
        handleJoin(payload).catch((error) => {
          console.error('❌ Failed to process join_game:', error);
          this.io.to(socket.id).emit('error', { message: 'Failed to join game lobby' });
        });
      });
      socket.on('join_lobby', (payload: { communityId: number }) => {
        handleJoin(payload).catch((error) => {
          console.error('❌ Failed to process join_lobby:', error);
          this.io.to(socket.id).emit('error', { message: 'Failed to join game lobby' });
        });
      });

      socket.on('spectate_table', ({ tableId }: { tableId: number }) => {
        this.handleSpectateTable(socket, tableId).catch((error) => {
          console.error('❌ Failed to process spectate_table:', error);
          this.io.to(socket.id).emit('error', { message: 'Failed to start spectator mode' });
        });
      });

      socket.on('game_action', ({ action, amount }: { action: string; amount?: number }) => {
        this.handleGameAction(socket.id, action, amount);
      });

      socket.on('show_hand_choice', ({ show }: { show: boolean }) => {
        this.handleShowHandChoice(socket.id, show).catch((error) => {
          console.error('❌ Failed to process show_hand_choice:', error);
          this.io.to(socket.id).emit('error', { message: 'Failed to update show-hand preference' });
        });
      });

      socket.on('chat_message', ({ message, gameId }: { message: string; gameId?: string }) => {
        this.handleChatMessage(socket, message, gameId);
      });

      socket.on('table_emote', ({ emoji }: { emoji: string }) => {
        this.handleTableEmote(socket, emoji);
      });

      socket.on('leave_game', (payload?: { tableId?: number }) => {
        this.handleLeaveGame(socket.id, payload?.tableId, socket.data.user);
      });

      socket.on('disconnect', (reason) => {
        console.log(`❌ Player disconnected: ${user.username} (${socket.id}) reason=${reason}`);
        this.handleDisconnect(socket, reason);
      });
    });
  }

  private async handleJoinLobby(socket: AuthenticatedSocket, communityId: number): Promise<void> {
    const user = socket.data.user;
    const playerId = `player_${user.id}_${Date.now()}`;
    const buyInAmount = 1000; // Match the initial stack
    
    // Debit wallet for buy-in
    const debitSuccess = await this.debitWallet(
      user.id, 
      communityId, 
      buyInAmount, 
      `Game buy-in for ${buyInAmount} chips`
    );

    if (!debitSuccess) {
      this.io.to(socket.id).emit('error', { 
        message: 'Insufficient funds for buy-in. Please add funds to your wallet.' 
      });
      console.log(`❌ ${user.username} insufficient funds for buy-in`);
      return;
    }
    
    this.connectedPlayers.set(socket.id, {
      socketId: socket.id,
      playerId,
      playerName: user.username,
      userId: user.id,
      communityId
    });

    this.lobby.push(socket.id);
    console.log(`🎲 ${user.username} joined lobby for community ${communityId}. Lobby size: ${this.lobby.length}`);

    this.io.to(socket.id).emit('lobby_joined', { 
      playerId, 
      message: 'Waiting for opponent...',
      lobbySize: this.lobby.length 
    });

    // If we have 2 players, start a game
    if (this.lobby.length >= 2) {
      this.createGame();
    }
  }

  private async createGame(): Promise<void> {
    const player1SocketId = this.lobby.shift()!;
    const player2SocketId = this.lobby.shift()!;

    const player1Info = this.connectedPlayers.get(player1SocketId)!;
    const player2Info = this.connectedPlayers.get(player2SocketId)!;

    const gameId = `game_${Date.now()}`;
    
    const config: GameConfig = {
      smallBlind: 10,
      bigBlind: 20,
      initialStack: 1000
    };

    const game = new Game(config);
    
    const player1 = new Player(player1Info.playerId, player1Info.playerName, config.initialStack);
    const player2 = new Player(player2Info.playerId, player2Info.playerName, config.initialStack);

    game.addPlayer(player1);
    game.addPlayer(player2);
    game.startHand();

    // Save to Redis instead of in-memory Map
    await GameStateStorage.saveGameState(gameId, game.toJSON());
    
    this.playerGameMap.set(player1Info.playerId, gameId);
    this.playerGameMap.set(player2Info.playerId, gameId);

    // Put both players in a room
    this.io.in(player1SocketId).socketsJoin(gameId);
    this.io.in(player2SocketId).socketsJoin(gameId);

    console.log(`🎮 Game started: ${gameId}`);
    console.log(`   Player 1: ${player1Info.playerName}`);
    console.log(`   Player 2: ${player2Info.playerName}`);

    // Send game start to both players
    this.io.to(player1SocketId).emit('game_started', {
      gameId,
      yourPlayerId: player1Info.playerId,
      gameState: game.getPlayerGameState(player1Info.playerId)
    });

    this.io.to(player2SocketId).emit('game_started', {
      gameId,
      yourPlayerId: player2Info.playerId,
      gameState: game.getPlayerGameState(player2Info.playerId)
    });

    // Broadcast initial state
    await this.broadcastGameState(gameId);
  }

  private async handleGameAction(socketId: string, action: string, amount?: number): Promise<void> {
    if (this.spectatorReadOnlySockets.has(socketId)) {
      this.io.to(socketId).emit('action_error', { error: 'Spectator mode is read-only. You cannot take actions.' });
      return;
    }

    const playerInfo = this.connectedPlayers.get(socketId);
    if (!playerInfo) {
      console.log(`⚠️  Unknown player tried to act: ${socketId}`);
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;
    if (!gameId) {
      this.io.to(socketId).emit('error', { message: 'You are not in a game' });
      return;
    }

    // Load game from Redis
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      this.io.to(socketId).emit('error', { message: 'Game not found' });
      return;
    }

    const game = Game.fromJSON(gameData);
    console.log(`🎯 ${playerInfo.playerName} action: ${action}${amount ? ` ${amount}` : ''}`);

    const result = game.handleAction(playerInfo.playerId, action as any, amount);

    if (!result.valid) {
      if (result.timeBankExhausted && result.exhaustedPlayerId) {
        console.log(`   🪫 Time bank exhausted: ${result.exhaustedPlayerName || result.exhaustedPlayerId}`);
        await this.removePlayerForTimeBankExhaustion(gameId, result.exhaustedPlayerId, result.exhaustedPlayerName);
        return;
      }
      this.io.to(socketId).emit('action_error', { error: result.error });
      console.log(`   ❌ Invalid: ${result.error}`);
      return;
    }

    // Save updated game state back to Redis
    await GameStateStorage.saveGameState(gameId, game.toJSON());

    // Clear existing timer and start new one for next player
    if (game.getStage() !== 'complete' && game.getStage() !== 'showdown') {
      const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
      this.startActionTimer(gameId, timeoutSeconds);
    }

    // Broadcast updated game state to all players in this game
    await this.broadcastGameState(gameId);

    // Check if game is complete
    if (game.getStage() === 'complete') {
      await this.handleCompletedHand(gameId, 'player action');
    }
  }

  private async handleShowHandChoice(socketId: string, show: boolean): Promise<void> {
    if (this.spectatorReadOnlySockets.has(socketId)) {
      this.io.to(socketId).emit('error', { message: 'Spectator mode is read-only.' });
      return;
    }

    const playerInfo = this.connectedPlayers.get(socketId);
    if (!playerInfo) {
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;
    if (!gameId) {
      this.io.to(socketId).emit('error', { message: 'You are not in a game' });
      return;
    }

    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      this.io.to(socketId).emit('error', { message: 'Game not found' });
      return;
    }

    const game = Game.fromJSON(gameData);
    const handResult = game.getLastHandResult();
    if (game.getStage() !== 'complete' || !handResult) {
      this.io.to(socketId).emit('error', { message: 'You can only show cards after a hand ends' });
      return;
    }

    const canShowCards = handResult.players.some((player) => {
      const resultUserId = player.userId ?? this.extractUserIdFromPlayerId(player.playerId);
      return resultUserId === playerInfo.userId && player.holeCards.length > 0;
    });

    if (!canShowCards) {
      this.io.to(socketId).emit('error', { message: 'No cards available to show' });
      return;
    }

    let gameRevealState = this.showdownCardReveals.get(gameId);
    if (!gameRevealState) {
      gameRevealState = new Map<number, boolean>();
      this.showdownCardReveals.set(gameId, gameRevealState);
    }

    gameRevealState.set(playerInfo.userId, Boolean(show));
    this.io.to(gameId).emit('player_show_hand_update', {
      userId: playerInfo.userId,
      show: Boolean(show),
    });
  }

  /**
   * Record hand history to the auth-api database
   */
  private async recordHandHistory(gameId: string, game: Game): Promise<void> {
    try {
      // Extract table info from gameId (format: "table_123")
      const tableId = parseInt(gameId.split('_')[1]);
      
      // Get community_id from table readiness info
      let tableState = this.tableReadiness.get(gameId);
      if (!tableState) {
        tableState = {
          gameId,
          seatedPlayers: new Set(),
          connectedPlayers: new Set(),
          playerIds: new Map(),
          gameStarted: false,
        };
        this.tableReadiness.set(gameId, tableState);
      }
      
      // Prefer persisted table metadata.
      let communityId: number | null = tableState.communityId ?? null;
      let tableName = tableState.tableName || `Table ${tableId}`;

      // Fallback to connected player metadata.
      if (!communityId) {
        for (const [, playerInfo] of this.connectedPlayers.entries()) {
          if (playerInfo.gameId === gameId && playerInfo.communityId) {
            communityId = playerInfo.communityId;
            break;
          }
        }
      }

      // Final fallback: ask auth-api for table metadata.
      if (!communityId || !tableState.tableName) {
        try {
          const tableResponse = await axios.get(`${FASTAPI_URL}/api/internal/tables/${tableId}`, { timeout: 5000 });
          const resolvedCommunityId = Number(tableResponse.data?.community_id);
          const resolvedTableName = String(tableResponse.data?.name || '').trim();

          if (!communityId && Number.isFinite(resolvedCommunityId) && resolvedCommunityId > 0) {
            communityId = resolvedCommunityId;
            tableState.communityId = resolvedCommunityId;
          }
          if (resolvedTableName) {
            tableName = resolvedTableName;
            tableState.tableName = resolvedTableName;
          }
        } catch (error: any) {
          console.warn(`⚠️  Failed to resolve table metadata for history (${gameId}):`, error.response?.data || error.message);
        }
      }
      
      if (!communityId) {
        console.warn(`⚠️  No community_id found for ${gameId}, skipping history recording`);
        return;
      }
      
      // Get hand history data
      const handData = game.getHandHistory();
      
      // Make internal API call to record history
      const response = await axios.post('http://auth-api:8000/_internal/history/record', {
        community_id: communityId,
        table_id: tableId,
        table_name: tableName,
        hand_data: handData
      }, {
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data.success) {
        console.log(`📜 Hand history recorded: ${response.data.hand_id} (linked_sessions=${response.data.linked_sessions ?? 0})`);
      }
    } catch (error: any) {
      // Log but don't throw - we don't want to crash the game if history recording fails
      console.error(`❌ Error recording hand history:`, error.message);
    }
  }

  /**
   * Process wallet credits for game winners
   */
  private async processGamePayouts(gameId: string, game: Game): Promise<void> {
    const players = game.getPlayers();
    
    for (const player of players) {
      const playerInfo = Array.from(this.connectedPlayers.values())
        .find(info => info.playerId === player.id);
      
      if (playerInfo && playerInfo.communityId) {
        // Credit player's remaining stack to their wallet
        const stackAmount = player.getStack();
        if (stackAmount > 0) {
          await this.creditWallet(
            playerInfo.userId,
            playerInfo.communityId,
            stackAmount,
            `Game payout: ${stackAmount} chips`
          );
          console.log(`💸 ${playerInfo.playerName} cashed out ${stackAmount} chips`);
        }
      }
    }
  }

  private extractUserIdFromPlayerId(playerId: string): number | null {
    const match = playerId.match(/^player_(\d+)_/);
    return match ? Number(match[1]) : null;
  }

  private removeSpectatorSocket(socketId: string): void {
    const gameId = this.spectatorSocketToGame.get(socketId);
    if (!gameId) {
      this.spectatorReadOnlySockets.delete(socketId);
      return;
    }

    const gameSpectators = this.spectatorsByGame.get(gameId);
    if (gameSpectators) {
      gameSpectators.delete(socketId);
      if (gameSpectators.size === 0) {
        this.spectatorsByGame.delete(gameId);
      }
    }

    this.spectatorSocketToGame.delete(socketId);
    this.spectatorReadOnlySockets.delete(socketId);
  }

  private buildSpectatorGameState(game: Game, userId: number): ReturnType<Game['getPlayerGameState']> {
    const publicState = game.getGameState() as ReturnType<Game['getPlayerGameState']>;
    const viewerPlayer = game.getPlayers().find((player) => this.extractUserIdFromPlayerId(player.id) === userId);
    return {
      ...publicState,
      myCards: viewerPlayer ? viewerPlayer.getHoleCards() : [],
    };
  }

  private emitSpectatorState(socketId: string, gameId: string, userId: number, game: Game): void {
    this.io.to(socketId).emit('game_state_update', {
      gameId,
      gameState: this.buildSpectatorGameState(game, userId),
      botUserIds: this.getApiDrivenUserIds(gameId),
    });
  }

  private async handleSpectateTable(socket: AuthenticatedSocket, tableId: number): Promise<void> {
    const numericTableId = Number(tableId);
    if (!Number.isFinite(numericTableId) || numericTableId <= 0) {
      this.io.to(socket.id).emit('error', { message: 'Invalid table id for spectator mode' });
      return;
    }

    const gameId = `table_${Math.floor(numericTableId)}`;
    const userId = socket.data.user.id;
    const userIdStr = userId.toString();

    this.removeSpectatorSocket(socket.id);
    this.spectatorReadOnlySockets.add(socket.id);

    let gameSpectators = this.spectatorsByGame.get(gameId);
    if (!gameSpectators) {
      gameSpectators = new Map<string, number>();
      this.spectatorsByGame.set(gameId, gameSpectators);
    }
    gameSpectators.set(socket.id, userId);
    this.spectatorSocketToGame.set(socket.id, gameId);

    socket.join(gameId);

    const hasSeat = this.tableReadiness.get(gameId)?.seatedPlayers.has(userIdStr) ?? false;
    this.io.to(socket.id).emit('spectator_mode', {
      enabled: true,
      gameId,
      hasSeat,
    });

    const gameData = await GameStateStorage.loadGameState(gameId);
    if (gameData) {
      const game = Game.fromJSON(gameData);
      this.emitSpectatorState(socket.id, gameId, userId, game);
      return;
    }

    // Keep spectator connected to room and provide a neutral waiting snapshot
    // until the first state is available.
    const waitingState = new Game({
      smallBlind: 10,
      bigBlind: 20,
      initialStack: 0,
    });
    this.io.to(socket.id).emit('game_state_update', {
      gameId,
      gameState: this.buildSpectatorGameState(waitingState, userId),
      botUserIds: this.getApiDrivenUserIds(gameId),
    });
  }

  private resolvePlayerIdForUser(gameId: string, userId: number, game?: Game): string | undefined {
    // Prefer connected socket mappings that are explicitly tied to this game.
    for (const [, playerInfo] of this.connectedPlayers.entries()) {
      if (playerInfo.userId !== userId) {
        continue;
      }
      const mappedGameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;
      if (mappedGameId === gameId) {
        return playerInfo.playerId;
      }
    }

    // Fall back to table readiness map (rebuilt on seat/re-seat).
    const readinessState = this.tableReadiness.get(gameId);
    const readinessPlayerId = readinessState?.playerIds?.get(userId.toString());
    if (readinessPlayerId) {
      return readinessPlayerId;
    }

    // Fall back to player->game index.
    for (const [playerId, mappedGameId] of this.playerGameMap.entries()) {
      const mappedUserId = this.extractUserIdFromPlayerId(playerId);
      if (mappedGameId === gameId && mappedUserId === userId) {
        return playerId;
      }
    }

    // Final fallback: inspect current game player list if available.
    if (game) {
      const player = game.getPlayers().find((entry) => this.extractUserIdFromPlayerId(entry.id) === userId);
      if (player) {
        return player.id;
      }
    }

    return undefined;
  }

  private getApiDrivenUserIds(gameId: string): number[] {
    const users = this.apiDrivenUsersByGame.get(gameId);
    if (!users || users.size === 0) {
      return [];
    }
    return Array.from(users.values());
  }

  private markUserAsApiDriven(gameId: string, userId: number): void {
    let users = this.apiDrivenUsersByGame.get(gameId);
    if (!users) {
      users = new Set<number>();
      this.apiDrivenUsersByGame.set(gameId, users);
    }
    users.add(userId);
  }

  private clearApiDrivenUser(gameId: string, userId: number): void {
    const users = this.apiDrivenUsersByGame.get(gameId);
    if (!users) {
      return;
    }
    users.delete(userId);
    if (users.size === 0) {
      this.apiDrivenUsersByGame.delete(gameId);
    }
  }

  private emitPlayerState(socketId: string, gameId: string, playerId: string, game: Game): void {
    this.io.to(socketId).emit('game_state_update', {
      gameId,
      gameState: game.getPlayerGameState(playerId),
      botUserIds: this.getApiDrivenUserIds(gameId),
    });
  }

  private getSocketIdsForUserInGame(userId: number, gameId: string): string[] {
    const matchingSocketIds = new Set<string>();

    for (const [socketId, info] of this.connectedPlayers.entries()) {
      if (info.userId !== userId) {
        continue;
      }

      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        continue;
      }

      // Prefer explicit game mapping, but also allow room-based matching for
      // legacy/lobby player records that may not carry gameId.
      if (info.gameId === gameId || socket.rooms.has(gameId)) {
        matchingSocketIds.add(socketId);
      }
    }

    const latestSocketId = this.userIdToSocketId.get(userId);
    if (latestSocketId) {
      const latestSocket = this.io.sockets.sockets.get(latestSocketId);
      if (latestSocket && latestSocket.rooms.has(gameId)) {
        matchingSocketIds.add(latestSocketId);
      }
    }

    return Array.from(matchingSocketIds);
  }

  private async removeBustedPlayers(gameId: string, game: Game): Promise<void> {
    const bustedPlayers = game.getPlayers().filter((player) => player.getStack() <= 0);
    if (bustedPlayers.length === 0) {
      return;
    }

    const tableState = this.tableReadiness.get(gameId);

    for (const bustedPlayer of bustedPlayers) {
      if (!game.removePlayer(bustedPlayer.id)) {
        continue;
      }

      this.playerGameMap.delete(bustedPlayer.id);
      this.io.to(gameId).emit('player_eliminated', { playerName: bustedPlayer.name });

      const userId = this.extractUserIdFromPlayerId(bustedPlayer.id);
      if (userId === null) {
        continue;
      }

      const userIdStr = userId.toString();
      tableState?.seatedPlayers.delete(userIdStr);
      tableState?.connectedPlayers.delete(userIdStr);
      tableState?.playerIds?.delete(userIdStr);
      this.clearApiDrivenUser(gameId, userId);

      await this.unseatPlayer(gameId, userId);

      const socketIds = this.getSocketIdsForUserInGame(userId, gameId);
      for (const socketId of socketIds) {
        this.io.to(socketId).emit('player_busted', {
          userId,
          message: 'You have run out of chips and were removed from the table.',
          gameId
        });

        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.leave(gameId);
        }
      }

      for (const [connectedSocketId, playerInfo] of Array.from(this.connectedPlayers.entries())) {
        if (playerInfo.userId === userId && playerInfo.gameId === gameId) {
          this.connectedPlayers.set(connectedSocketId, {
            ...playerInfo,
            gameId: undefined
          });
        }
      }

      for (const [playerId, mappedGameId] of Array.from(this.playerGameMap.entries())) {
        const mappedUserId = this.extractUserIdFromPlayerId(playerId);
        if (mappedGameId === gameId && mappedUserId === userId) {
          this.playerGameMap.delete(playerId);
        }
      }
    }
  }

  private async removePlayerForTimeBankExhaustion(gameId: string, exhaustedPlayerId: string, exhaustedPlayerName?: string): Promise<void> {
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      return;
    }

    const game = Game.fromJSON(gameData);
    const targetPlayer = game.getPlayers().find((player) => player.id === exhaustedPlayerId);
    if (!targetPlayer) {
      return;
    }

    const userId = this.extractUserIdFromPlayerId(targetPlayer.id);
    const tableState = this.tableReadiness.get(gameId);
    const playerName = targetPlayer.name || exhaustedPlayerName || 'Player';

    if (userId !== null) {
      const userInfo = Array.from(this.connectedPlayers.values()).find(
        (info) => info.userId === userId && info.gameId === gameId
      );

      if (userInfo?.communityId && targetPlayer.getStack() > 0) {
        await this.creditWallet(
          userInfo.userId,
          userInfo.communityId,
          targetPlayer.getStack(),
          `Refund after time-bank removal: ${targetPlayer.getStack()} chips`
        );
      }
    }

    if (!game.removePlayer(targetPlayer.id)) {
      return;
    }

    this.playerGameMap.delete(targetPlayer.id);
    this.io.to(gameId).emit('player_eliminated', {
      playerName,
      reason: 'time_bank_exhausted'
    });

    if (userId !== null) {
      const userIdStr = userId.toString();
      tableState?.seatedPlayers.delete(userIdStr);
      tableState?.connectedPlayers.delete(userIdStr);
      tableState?.playerIds?.delete(userIdStr);
      this.clearApiDrivenUser(gameId, userId);

      await this.unseatPlayer(gameId, userId);

      const socketIds = this.getSocketIdsForUserInGame(userId, gameId);
      for (const socketId of socketIds) {
        this.io.to(socketId).emit('player_busted', {
          userId,
          message: 'Your 30-second reserve time ran out. You were removed from the table.',
          gameId
        });

        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.leave(gameId);
        }
      }

      for (const [connectedSocketId, playerInfo] of Array.from(this.connectedPlayers.entries())) {
        if (playerInfo.userId === userId && playerInfo.gameId === gameId) {
          this.connectedPlayers.set(connectedSocketId, {
            ...playerInfo,
            gameId: undefined
          });
        }
      }

      for (const [playerId, mappedGameId] of Array.from(this.playerGameMap.entries())) {
        const mappedUserId = this.extractUserIdFromPlayerId(playerId);
        if (mappedGameId === gameId && mappedUserId === userId) {
          this.playerGameMap.delete(playerId);
        }
      }
    }

    const remainingPlayers = game.getPlayers().length;
    this.clearActionTimer(gameId);

    if (remainingPlayers === 0) {
      await GameStateStorage.deleteGameState(gameId);
      this.apiDrivenUsersByGame.delete(gameId);
      if (tableState) {
        tableState.gameStarted = false;
      }
      await this.checkAndCleanupTable(gameId);
      return;
    }

    await GameStateStorage.saveGameState(gameId, game.toJSON());

    if (remainingPlayers < 2) {
      if (tableState) {
        tableState.gameStarted = false;
      }
      await this.broadcastGameState(gameId);
      return;
    }

    if (game.getStage() === 'complete') {
      await this.handleCompletedHand(gameId, 'time bank exhausted');
      return;
    }

    await this.broadcastGameState(gameId);

    const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
    this.startActionTimer(gameId, timeoutSeconds);
  }

  private async handleCompletedHand(gameId: string, reason: string): Promise<void> {
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      return;
    }

    const game = Game.fromJSON(gameData);
    const handResult: HandResult | null = game.getLastHandResult();
    this.showdownCardReveals.delete(gameId);

    if (handResult) {
      this.io.to(gameId).emit('hand_complete', handResult);
    }

    console.log(`🏆 Game ${gameId} completed (${reason})`);

    this.recordHandHistory(gameId, game).catch((err) => {
      console.error(`❌ Failed to record hand history for ${gameId}:`, err.message);
    });

    await this.processGamePayouts(gameId, game);
    this.clearActionTimer(gameId);

    setTimeout(async () => {
      const latestData = await GameStateStorage.loadGameState(gameId);
      if (!latestData) {
        return;
      }

      const latestGame = Game.fromJSON(latestData);
      await this.removeBustedPlayers(gameId, latestGame);

      const remainingPlayers = latestGame.getPlayers().length;
      const tableState = this.tableReadiness.get(gameId);

      if (remainingPlayers === 0) {
        await GameStateStorage.deleteGameState(gameId);
        this.clearActionTimer(gameId);
        this.showdownCardReveals.delete(gameId);
        this.apiDrivenUsersByGame.delete(gameId);
        if (tableState) {
          tableState.gameStarted = false;
        }
        await this.checkAndCleanupTable(gameId);
        return;
      }

      if (remainingPlayers < 2) {
        if (tableState) {
          tableState.gameStarted = false;
        }
        await GameStateStorage.saveGameState(gameId, latestGame.toJSON());
        await this.broadcastGameState(gameId);
        this.clearActionTimer(gameId);
        this.showdownCardReveals.delete(gameId);
        return;
      }

      latestGame.startHand();
      await GameStateStorage.saveGameState(gameId, latestGame.toJSON());
      this.showdownCardReveals.delete(gameId);

      const timeoutSeconds = Math.max(1, Math.ceil(latestGame.getRemainingTotalTime()));
      this.startActionTimer(gameId, timeoutSeconds);

      await this.broadcastGameState(gameId);
    }, this.HAND_RESULT_DELAY);
  }

  private async broadcastGameState(gameId: string): Promise<void> {
    // Load game from Redis
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) return;

    const game = Game.fromJSON(gameData);

    // Send personalized state to every in-room socket for each player.
    // This avoids stale userId->socket mappings delivering private state
    // to sockets that are not actually attached to this game.
    for (const player of game.getPlayers()) {
      const socketIds = new Set<string>();

      for (const [socketId, info] of this.connectedPlayers.entries()) {
        if (info.playerId !== player.id) {
          continue;
        }
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket && socket.rooms.has(gameId)) {
          socketIds.add(socketId);
        }
      }

      const userId = this.extractUserIdFromPlayerId(player.id);
      if (userId !== null) {
        for (const socketId of this.getSocketIdsForUserInGame(userId, gameId)) {
          socketIds.add(socketId);
        }
      }

      for (const socketId of socketIds) {
        this.emitPlayerState(socketId, gameId, player.id, game);
      }
    }

    const gameSpectators = this.spectatorsByGame.get(gameId);
    if (gameSpectators && gameSpectators.size > 0) {
      for (const [socketId, userId] of Array.from(gameSpectators.entries())) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket || !socket.rooms.has(gameId)) {
          this.removeSpectatorSocket(socketId);
          continue;
        }
        this.emitSpectatorState(socketId, gameId, userId, game);
      }
    }
  }

  /**
   * Starts an action timer for the current player
   */
  private startActionTimer(gameId: string, timeoutSeconds: number): void {
    // Clear any existing timer for this game
    this.clearActionTimer(gameId);

    const safeTimeoutMs = Math.max(250, Math.ceil(timeoutSeconds * 1000));

    // Set new timer
    const timerId = setTimeout(async () => {
      await this.handleActionTimeout(gameId);
    }, safeTimeoutMs);

    this.actionTimers.set(gameId, timerId);
  }

  /**
   * Clears the action timer for a game
   */
  private clearActionTimer(gameId: string): void {
    const existingTimer = this.actionTimers.get(gameId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.actionTimers.delete(gameId);
    }
  }

  private clearAllActionTimers(): void {
    for (const timer of this.actionTimers.values()) {
      clearTimeout(timer);
    }
    this.actionTimers.clear();
  }

  private clearDisconnectCleanupTimer(socketId: string): void {
    const timer = this.disconnectCleanupTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectCleanupTimers.delete(socketId);
    }
  }

  private clearAllDisconnectCleanupTimers(): void {
    for (const timer of this.disconnectCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectCleanupTimers.clear();
  }

  /**
   * Handles player action timeout
   */
  private async handleActionTimeout(gameId: string): Promise<void> {
    console.log(`⏰ Action timeout for game ${gameId}`);

    // Load game from Redis
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) {
      console.log(`   ⚠️ Game ${gameId} not found`);
      return;
    }

    const game = Game.fromJSON(gameData);

    // Check if action actually timed out (in case it was cleared)
    if (!game.hasActionTimedOut()) {
      console.log(`   ℹ️ Action no longer timed out for ${gameId}`);
      return;
    }

    // Get the current player
    const currentPlayer = game.getPlayers()[game.getGameState().currentPlayerIndex];
    console.log(`   ⏰ ${currentPlayer.name} timed out - auto-folding/checking`);

    // Emit timeout event to all players
    this.io.to(gameId).emit('player_timeout', {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name
    });

    // Handle timeout (auto-fold or check)
    const result = game.handleTimeout();

    if (!result.valid) {
      if (result.timeBankExhausted && result.exhaustedPlayerId) {
        console.log(`   🪫 Time bank exhausted: ${result.exhaustedPlayerName || result.exhaustedPlayerId}`);
        await this.removePlayerForTimeBankExhaustion(gameId, result.exhaustedPlayerId, result.exhaustedPlayerName);
        return;
      }
      console.error(`   ❌ Timeout handling failed: ${result.error}`);
      return;
    }

    // Save updated game state
    await GameStateStorage.saveGameState(gameId, game.toJSON());

    // Broadcast updated state
    await this.broadcastGameState(gameId);

    // Check if game is complete after timeout
    if (game.getStage() === 'complete') {
      await this.handleCompletedHand(gameId, 'timeout');
    } else {
      // Game continues - restart timer for next player
      const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
      this.startActionTimer(gameId, timeoutSeconds);
    }
  }

  private async handleLeaveGame(socketId: string, tableIdHint?: number, userHint?: AuthenticatedUser): Promise<void> {
    this.clearDisconnectCleanupTimer(socketId);

    if (this.spectatorReadOnlySockets.has(socketId)) {
      const socketUser = this.io.sockets.sockets.get(socketId)?.data.user;
      if (socketUser && this.userIdToSocketId.get(socketUser.id) === socketId) {
        this.userIdToSocketId.delete(socketUser.id);
      }
      this.removeSpectatorSocket(socketId);
      this.connectedPlayers.delete(socketId);
      this.disconnectedPlayers.delete(socketId);
      return;
    }

    const playerInfo = this.connectedPlayers.get(socketId);
    if (!playerInfo) {
      if (!tableIdHint || !userHint) {
        return;
      }

      const fallbackGameId = `table_${tableIdHint}`;
      const fallbackUserId = userHint.id;

      // Best-effort cleanup path when socket-player mapping is missing.
      const removal = await this.removeAndRefundPlayerFromGame(
        fallbackGameId,
        fallbackUserId,
        userHint.username
      );
      if (removal.removed && removal.remainingPlayers > 0 && removal.gameStateUpdated) {
        await this.broadcastGameState(fallbackGameId);
      }

      await this.unseatPlayer(fallbackGameId, fallbackUserId);
      await this.checkAndCleanupTable(fallbackGameId);

      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;
    if (gameId) {
      this.clearApiDrivenUser(gameId, playerInfo.userId);
      let remainingPlayers = 0;
      let gameStateUpdated = false;

      // Load game from Redis and remove leaving player from the live game state.
      const removal = await this.removeAndRefundPlayerFromGame(
        gameId,
        playerInfo.userId,
        playerInfo.playerName,
        playerInfo.communityId
      );
      if (removal.removed) {
        remainingPlayers = removal.remainingPlayers;
        gameStateUpdated = removal.gameStateUpdated;
        if (remainingPlayers === 0) {
          console.log(`🗑️  Game ${gameId} deleted - no players remaining`);
        }
      } else {
        // Missing state should still allow seat cleanup in the auth API.
        this.clearActionTimer(gameId);
        this.showdownCardReveals.delete(gameId);
        this.apiDrivenUsersByGame.delete(gameId);
      }

      this.io.to(gameId).emit('player_left', {
        playerName: playerInfo.playerName
      });

      const tableState = this.tableReadiness.get(gameId);
      if (tableState) {
        tableState.connectedPlayers.delete(playerInfo.userId.toString());
      }

      // Unseat player from table in database for both leave and timeout cleanup.
      await this.unseatPlayer(gameId, playerInfo.userId);
      const tableDeleted = await this.checkAndCleanupTable(gameId);
      if (!tableDeleted && remainingPlayers > 0 && gameStateUpdated) {
        await this.broadcastGameState(gameId);
      }

      this.playerGameMap.delete(playerInfo.playerId);
      for (const [playerId, mappedGameId] of Array.from(this.playerGameMap.entries())) {
        const match = playerId.match(/^player_(\d+)_/);
        if (mappedGameId === gameId && match && Number(match[1]) === playerInfo.userId) {
          this.playerGameMap.delete(playerId);
        }
      }
    }

    // Remove from lobby if waiting
    const lobbyIndex = this.lobby.indexOf(socketId);
    if (lobbyIndex > -1) {
      this.lobby.splice(lobbyIndex, 1);
      
      // Refund buy-in if player leaves before game starts
      if (playerInfo.communityId) {
        await this.creditWallet(
          playerInfo.userId,
          playerInfo.communityId,
          1000, // buy-in amount
          'Refund: Left lobby before game started'
        );
        console.log(`💸 ${playerInfo.playerName} refunded buy-in (left lobby)`);
      }
    }

    // Clean up socket mappings for this session.
    // Keep newer sockets for the same user intact (reconnection uses a different socketId).
    this.connectedPlayers.delete(socketId);
    this.disconnectedPlayers.delete(socketId);
    this.clearDisconnectCleanupTimer(socketId);
    if (this.userIdToSocketId.get(playerInfo.userId) === socketId) {
      this.userIdToSocketId.delete(playerInfo.userId);
    }
  }

  private async handleDisconnect(socket: AuthenticatedSocket, reason?: string): Promise<void> {
    const socketId = socket.id;
    const user = socket.data.user;

    if (this.spectatorReadOnlySockets.has(socketId)) {
      this.removeSpectatorSocket(socketId);
      this.connectedPlayers.delete(socketId);
      this.disconnectedPlayers.delete(socketId);
      this.clearDisconnectCleanupTimer(socketId);
      if (this.userIdToSocketId.get(user.id) === socketId) {
        this.userIdToSocketId.delete(user.id);
      }
      return;
    }

    const playerInfo = this.connectedPlayers.get(socketId);

    // Remove from table readiness tracking
    for (const [gameId, tableState] of this.tableReadiness.entries()) {
      if (tableState.connectedPlayers.has(user.id.toString())) {
        tableState.connectedPlayers.delete(user.id.toString());
        console.log(`📋 Player ${user.id} disconnected from ${gameId}. ${tableState.connectedPlayers.size}/${tableState.seatedPlayers.size} still connected`);
      }
    }

    // User intentionally left this socket/session. Skip reconnection grace and unseat immediately.
    if (reason === 'client namespace disconnect') {
      await this.handleLeaveGame(socketId);
      return;
    }

    if (playerInfo && this.recentlyReconnected.has(playerInfo.playerId)) {
      // Player just reconnected and disconnected quickly - might be a flaky connection
      // Give them normal reconnection grace instead of immediate cleanup
      this.recentlyReconnected.delete(playerInfo.playerId);
      console.log(`⚠️  ${user.username} disconnected shortly after reconnecting - treating as temporary disconnect`);
      // Fall through to normal disconnect handling below
    }

    if (!playerInfo) {
      this.clearDisconnectCleanupTimer(socketId);
      if (this.userIdToSocketId.get(user.id) === socketId) {
        this.userIdToSocketId.delete(user.id);
      }
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId) || playerInfo.gameId;

    // If player is in an active game, give them time to reconnect
    if (gameId && await GameStateStorage.gameExists(gameId)) {
      console.log(`⏳ ${user.username} disconnected, waiting for reconnection...`);

      let cachedGameState: ReturnType<Game['getPlayerGameState']> | undefined;
      let cachedChatMessages: ChatMessage[] | undefined;

      try {
        const gameData = await GameStateStorage.loadGameState(gameId);
        if (gameData) {
          const game = Game.fromJSON(gameData);
          cachedGameState = game.getPlayerGameState(playerInfo.playerId);
        }
      } catch (err) {
        console.warn(`⚠️  Failed to cache game state for ${user.username}:`, (err as Error).message);
      }

      const chatMessages = this.chatHistory.get(gameId);
      if (chatMessages && chatMessages.length > 0) {
        cachedChatMessages = [...chatMessages];
      }

      // Store disconnection info (clone to avoid mutations)
      this.disconnectedPlayers.set(socketId, {
        playerInfo: { ...playerInfo },
        gameId,
        disconnectTime: Date.now(),
        cachedGameState,
        cachedChatMessages
      });

      // Notify other players
      this.io.to(gameId).emit('player_disconnected', {
        playerName: user.username,
        reconnectTimeout: this.RECONNECT_TIMEOUT
      });

      // Set timeout to actually remove player if they don't reconnect
      this.clearDisconnectCleanupTimer(socketId);
      const disconnectTimer = setTimeout(() => {
        this.disconnectCleanupTimers.delete(socketId);

        // Check if player reconnected
        if (this.disconnectedPlayers.has(socketId)) {
          console.log(`⏰ ${user.username} did not reconnect in time, removing from game`);
          this.disconnectedPlayers.delete(socketId);
          void this.handleLeaveGame(socketId);
        }
      }, this.RECONNECT_TIMEOUT);
      disconnectTimer.unref?.();
      this.disconnectCleanupTimers.set(socketId, disconnectTimer);
    } else {
      // Player not in game, immediate cleanup
      await this.handleLeaveGame(socketId);
      this.connectedPlayers.delete(socketId);
    }
  }

  /**
   * Setup HTTP endpoints for Agent API
   * These are internal endpoints called by the poker-agent-api service
   */
  private setupHttpEndpoints(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'poker-game-server' });
    });

    // Internal endpoint for agent actions
    // Called by poker-agent-api to execute agent moves
    this.app.post('/_internal/agent-action', async (req: Request, res: Response) => {
      try {
        const { userId, gameId, action, amount } = req.body;
        const numericUserId = Number(userId);
        const numericAmount = amount === undefined || amount === null ? undefined : Number(amount);

        // Validate request
        if (!numericUserId || !gameId || !action) {
          return res.status(400).json({ 
            error: 'Missing required fields: userId, gameId, action' 
          });
        }
        if (numericAmount !== undefined && !Number.isFinite(numericAmount)) {
          return res.status(400).json({
            error: 'Invalid amount'
          });
        }

        console.log(`🤖 Agent action: User ${numericUserId}, Game ${gameId}, Action: ${action}${amount ? ` ${amount}` : ''}`);
        this.markUserAsApiDriven(gameId, numericUserId);

        // Load game from Redis
        const gameData = await GameStateStorage.loadGameState(gameId);
        if (!gameData) {
          return res.status(404).json({ error: 'Game not found' });
        }

        const game = Game.fromJSON(gameData);

        const playerId = this.resolvePlayerIdForUser(gameId, numericUserId, game);

        if (!playerId) {
          return res.status(404).json({ error: 'Player not found in game' });
        }

        // Perform the action
        const result = game.handleAction(playerId, action as any, numericAmount);

        if (!result.valid) {
          if (result.timeBankExhausted && result.exhaustedPlayerId) {
            await this.removePlayerForTimeBankExhaustion(gameId, result.exhaustedPlayerId, result.exhaustedPlayerName);
            return res.status(400).json({
              error: result.error,
              valid: false
            });
          }
          return res.status(400).json({ 
            error: result.error,
            valid: false 
          });
        }

        // Save updated game state to Redis
        await GameStateStorage.saveGameState(gameId, game.toJSON());

        // Broadcast to all connected players via WebSocket
        await this.broadcastGameState(gameId);

        // Check if game is complete
        if (game.getStage() === 'complete') {
          await this.handleCompletedHand(gameId, 'agent action');
        } else if (game.getStage() !== 'showdown') {
          const timeoutSeconds = Math.max(1, Math.ceil(game.getRemainingTotalTime()));
          this.startActionTimer(gameId, timeoutSeconds);
        }

        // Return the updated game state
        const playerGameState = game.getPlayerGameState(playerId);
        res.json({
          success: true,
          gameState: playerGameState,
          botUserIds: this.getApiDrivenUserIds(gameId),
        });

      } catch (error: any) {
        console.error('❌ Error processing agent action:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          message: error.message 
        });
      }
    });

    // Get game state (for agent polling)
    this.app.get('/_internal/game/:gameId/state', async (req: Request, res: Response) => {
      try {
        const { gameId } = req.params;
        const { userId } = req.query;

        if (!userId) {
          return res.status(400).json({ error: 'Missing userId query parameter' });
        }
        const numericUserId = Number(userId);
        if (!numericUserId) {
          return res.status(400).json({ error: 'Invalid userId query parameter' });
        }
        this.markUserAsApiDriven(gameId, numericUserId);

        // Load game from Redis
        const gameData = await GameStateStorage.loadGameState(gameId);
        if (!gameData) {
          return res.status(404).json({ error: 'Game not found' });
        }

        const game = Game.fromJSON(gameData);

        const playerId = this.resolvePlayerIdForUser(gameId, numericUserId, game);

        if (!playerId) {
          return res.status(404).json({ error: 'Player not found in game' });
        }

        // Return player-specific game state
        const playerGameState = game.getPlayerGameState(playerId);
        res.json({
          gameState: playerGameState,
          botUserIds: this.getApiDrivenUserIds(gameId),
        });

      } catch (error: any) {
        console.error('❌ Error getting game state:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          message: error.message 
        });
      }
    });

    // Seat player endpoint (for buy-in orchestration)
    // Called by poker-api when a user joins a table
    this.app.post('/_internal/seat-player', async (req: Request, res: Response) => {
      try {
  const { table_id, user_id, username, stack, seat_number, community_id, table_name } = req.body;

        // Validate request
        if (!table_id || !user_id || !username || !stack || !seat_number) {
          return res.status(400).json({ 
            error: 'Missing required fields: table_id, user_id, username, stack, seat_number' 
          });
        }

        console.log(`💺 Seating player: ${username} (User ${user_id}) at table ${table_id} seat ${seat_number} with ${stack} chips`);

        const gameId = `table_${table_id}`;
        const playerId = `player_${user_id}_${Date.now()}`;

        // Fetch table configuration including action_timeout_seconds and max_seats
        let actionTimeoutSeconds: number | undefined;
        let maxSeats = 8;
        try {
          const tableResponse = await axios.get(`${FASTAPI_URL}/api/internal/tables/${table_id}`);
          actionTimeoutSeconds = tableResponse.data.action_timeout_seconds;
          maxSeats = Number(tableResponse.data.max_seats) || 8;
          console.log(`⏱️  Table ${table_id} action timeout: ${actionTimeoutSeconds} seconds`);
        } catch (error: any) {
          console.warn(`⚠️  Failed to fetch table config for ${table_id}:`, error.response?.data || error.message);
          // Continue without timeout if fetch fails
        }

        // Load or create game from Redis
        let gameData = await GameStateStorage.loadGameState(gameId);
        let game: Game;

        if (!gameData) {
          // Create new game
          console.log(`🎮 Creating new game for table ${table_id}`);
          game = new Game({
            smallBlind: 10,
            bigBlind: 20,
            initialStack: stack,
            actionTimeoutSeconds
          });
        } else {
          game = Game.fromJSON(gameData);
        }

        // Create player object with seat number
        const player = new Player(playerId, username, stack, seat_number);

        // Ensure table readiness exists for both fresh seats and idempotent re-seats.
        if (!this.tableReadiness.has(gameId)) {
          this.tableReadiness.set(gameId, {
            gameId,
            communityId: community_id,
            tableName: table_name,
            seatedPlayers: new Set(),
            connectedPlayers: new Set(),
            playerIds: new Map(),
            gameStarted: false
          });
        }
        const tableState = this.tableReadiness.get(gameId)!;
        if (!tableState.playerIds) {
          tableState.playerIds = new Map();
        }
        if (community_id && tableState.communityId !== community_id) {
          tableState.communityId = community_id;
        }
        if (table_name && tableState.tableName !== table_name) {
          tableState.tableName = table_name;
        }

        // Check if player already seated
        const existingPlayer = game.getPlayers().find((p) => {
          const match = p.id.match(/^player_(\d+)_/);
          return match ? Number(match[1]) === Number(user_id) : p.name === username;
        });
        if (existingPlayer) {
          // Rebuild ephemeral mappings after server restarts so seated users can reconnect.
          tableState.seatedPlayers.add(user_id.toString());
          tableState.playerIds.set(user_id.toString(), existingPlayer.id);
          this.playerGameMap.set(existingPlayer.id, gameId);

          const currentSocketId = this.userIdToSocketId.get(Number(user_id));
          if (currentSocketId) {
            const existing = this.connectedPlayers.get(currentSocketId);
            if (existing) {
              this.connectedPlayers.set(currentSocketId, {
                ...existing,
                playerId: existingPlayer.id,
                playerName: username,
                userId: Number(user_id),
                communityId: tableState.communityId,
                gameId
              });
            }
            const currentSocket = this.io.sockets.sockets.get(currentSocketId);
            if (currentSocket) {
              currentSocket.join(gameId);
              this.emitPlayerState(currentSocketId, gameId, existingPlayer.id, game);
            }
          }

          console.log(`♻️  Re-seated existing player ${username} at table ${table_id}.`);
          console.log(`📋 Table ${table_id}: ${tableState.seatedPlayers.size} seated, ${tableState.connectedPlayers.size} connected`);

          await this.checkAndStartGame(gameId);

          return res.json({
            success: true,
            message: `Player ${username} already seated at this table`,
            game_id: gameId,
            player_id: existingPlayer.id,
            players_count: game.getPlayers().length,
            max_seats: maxSeats
          });
        }

        // Check if seat is already taken
        const seatTaken = game.getPlayers().find(p => p.seatNumber === seat_number);
        if (seatTaken) {
          return res.status(400).json({ 
            error: `Seat ${seat_number} is already occupied` 
          });
        }

        // Check if table is full
        if (game.getPlayers().length >= maxSeats) {
          return res.status(400).json({ 
            error: 'Table is full' 
          });
        }

        const gameStageBeforeSeat = game.getStage();
        let waitingForBigBlind = false;
        let waitReason: string | null = null;
        if (gameStageBeforeSeat !== 'waiting' && gameStageBeforeSeat !== 'complete' && gameStageBeforeSeat !== 'showdown') {
          const joinCheck = game.canPlayerJoinAtSeat(seat_number);
          waitingForBigBlind = !joinCheck.canJoin;
          if (waitingForBigBlind) {
            waitReason = joinCheck.reason;
          }
        }

        // Add player to game
        game.addPlayer(player);
        console.log(`✅ Player ${username} added to game at seat ${seat_number}. Total players: ${game.getPlayers().length}`);
        if (waitingForBigBlind) {
          console.log(`🕒 ${username} seated and queued until big blind`);
        }

        // Save game state to Redis
        await GameStateStorage.saveGameState(gameId, game.toJSON());

        // Map player to game for future lookups
        this.playerGameMap.set(playerId, gameId);

        // Track seated player for readiness check
        tableState.seatedPlayers.add(user_id.toString());
        tableState.playerIds.set(user_id.toString(), playerId);

        const currentSocketId = this.userIdToSocketId.get(Number(user_id));
        if (currentSocketId) {
          const existing = this.connectedPlayers.get(currentSocketId);
          if (existing) {
            this.connectedPlayers.set(currentSocketId, {
              ...existing,
              playerId,
              playerName: username,
              userId: Number(user_id),
              communityId: tableState.communityId,
              gameId
            });
          }
          const currentSocket = this.io.sockets.sockets.get(currentSocketId);
          if (currentSocket) {
            currentSocket.join(gameId);
          }
        }

        console.log(`📋 Table ${table_id}: ${tableState.seatedPlayers.size} seated, ${tableState.connectedPlayers.size} connected`);

        // Broadcast game state update to all connected players at this table
        for (const [socketId, playerInfo] of this.connectedPlayers.entries()) {
          if (playerInfo.gameId === gameId) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
              this.emitPlayerState(socketId, gameId, playerInfo.playerId, game);
            }
          }
        }

        // Check if this triggers tournament start (if max_seats reached)
        // TODO: Implement tournament logic here
        const currentPlayerCount = game.getPlayers().length;
        if (currentPlayerCount === maxSeats) {
          console.log(`🏆 Table full (${currentPlayerCount}/${maxSeats}). Tournament could start here.`);
          // TODO: Load tournament config, call tournament.start(), set up blind timer
        }

        res.json({ 
          success: true,
          message: waitingForBigBlind
            ? `Player ${username} seated. You are queued until your big blind arrives.`
            : `Player ${username} seated successfully`,
          game_id: gameId,
          player_id: playerId,
          players_count: currentPlayerCount,
          max_seats: maxSeats,
          waiting_for_big_blind: waitingForBigBlind,
          waiting_reason: waitReason
        });

      } catch (error: any) {
        console.error('❌ Error seating player:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          message: error.message 
        });
      }
    });
  }
}

// Start the server only when running as main module
if (require.main === module) {
  new PokerServer(PORT);
}
