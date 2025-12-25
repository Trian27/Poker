import { Server, Socket } from 'socket.io';
import { Game, GameConfig } from './engine/Game';
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
  private readonly RECONNECT_TIMEOUT = 60000; // 60 seconds to reconnect
  private server: any; // HTTP server instance
  private app: express.Application; // Express app

  constructor(port: number) {
    // Create Express app
    this.app = express();
    this.app.use(bodyParser.json());
    
    // Create HTTP server with Express
    const httpServer = require('http').createServer(this.app);
    this.server = httpServer;
    
    this.io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupAuthMiddleware();
    this.setupSocketHandlers();
    this.setupHttpEndpoints(); // Add HTTP endpoints for agent API
    
    httpServer.listen(port, () => {
      console.log(`🎰 Poker server running on port ${port}`);
      console.log(`   - Socket.IO for real-time game play`);
      console.log(`   - HTTP endpoints for agent API`);
    });
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

    try {
      const response = await axios.post(`${FASTAPI_URL}/api/internal/wallet/debit`, {
        user_id: userId,
        community_id: communityId,
        amount,
        description
      });
      
      if (response.data.success) {
        console.log(`💰 Debited ${amount} from user ${userId} wallet. New balance: ${response.data.new_balance}`);
        return true;
      }
      return false;
    } catch (error: any) {
      console.error(`❌ Failed to debit wallet for user ${userId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Credit player's wallet for game winnings
   */
  private async creditWallet(userId: number, communityId: number, amount: number, description: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    try {
      const response = await axios.post(`${FASTAPI_URL}/api/internal/wallet/credit`, {
        user_id: userId,
        community_id: communityId,
        amount,
        description
      });
      
      if (response.data.success) {
        console.log(`💰 Credited ${amount} to user ${userId} wallet. New balance: ${response.data.new_balance}`);
        return true;
      }
      return false;
    } catch (error: any) {
      console.error(`❌ Failed to credit wallet for user ${userId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Check if a table should be deleted (non-permanent tables with no players)
   */
  private async checkAndCleanupTable(gameId: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return; // Skip cleanup in tests
    }

    try {
      // Extract table ID from gameId (format: table_123)
      const tableIdMatch = gameId.match(/^table_(\d+)$/);
      if (!tableIdMatch) return;

      const tableId = parseInt(tableIdMatch[1]);

      // Check if table is empty (no seated players)
      const tableState = this.tableReadiness.get(gameId);
      if (tableState && tableState.seatedPlayers.size === 0) {
        // Call FastAPI to check if table is permanent and delete if not
        const response = await axios.post(`${FASTAPI_URL}/api/internal/tables/${tableId}/check-cleanup`);
        
        if (response.data.deleted) {
          console.log(`🗑️  Non-permanent table ${tableId} deleted - no players remaining`);
          this.tableReadiness.delete(gameId);
        }
      }
    } catch (error: any) {
      console.error(`⚠️  Failed to check table cleanup for ${gameId}:`, error.response?.data || error.message);
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
    const userIdStr = user.id.toString();
    // Find all tables where this user is seated
    for (const [gameId, tableState] of this.tableReadiness.entries()) {
      if (tableState.seatedPlayers.has(userIdStr)) {
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
            const player = game.getPlayers().find((p: any) => p.name === user.username);
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
        } else {
          console.warn(`⚠️  Could not resolve playerId for user ${user.id} in ${gameId}`);
        }

        // Check if we should start the game
        await this.checkAndStartGame(gameId);
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
      tableState.gameStarted = true;

      // Load game from Redis
      const gameData = await GameStateStorage.loadGameState(gameId);
      if (!gameData) {
        console.error(`❌ Cannot start game ${gameId} - no game data found`);
        return;
      }

      const game = Game.fromJSON(gameData);

      try {
        // Start the hand
        game.startHand();
        console.log(`🎲 Hand started for game ${gameId}`);

        // Save updated game state
        await GameStateStorage.saveGameState(gameId, game.toJSON());

        // Start action timer if configured
        const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
        if (timeoutSeconds) {
          this.startActionTimer(gameId, timeoutSeconds);
          console.log(`⏰ Action timer started: ${timeoutSeconds} seconds`);
        }

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
      gameState: gameStateForPlayer
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
    const playerInfo = this.connectedPlayers.get(socket.id);

    if (!playerInfo) return;

    // Validate message
    const trimmedMessage = message.trim();
    if (!trimmedMessage || trimmedMessage.length === 0) {
      socket.emit('error', { message: 'Cannot send empty message' });
      return;
    }

    // Get the actual game ID if not provided
    const actualGameId = gameId || this.playerGameMap.get(playerInfo.playerId);
    
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

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      const user = socket.data.user;
      console.log(`✅ Player connected: ${user.username} (${socket.id})`);

      // Track user to socket mapping for reconnection
      const oldSocketId = this.userIdToSocketId.get(user.id);
      this.userIdToSocketId.set(user.id, socket.id);

      // Check if user is seated at any table and mark them as connected
      this.handlePlayerWebSocketConnection(user, socket.id);

      // Notify client that connection is ready
      this.io.to(socket.id).emit('connected', {
        message: 'Connected to poker server',
        socketId: socket.id
      });

      // Check if this is a reconnection
      if (oldSocketId && this.disconnectedPlayers.has(oldSocketId)) {
        this.handleReconnection(socket, oldSocketId);
      }

      const handleJoin = ({ communityId }: { communityId: number }) => {
        this.handleJoinLobby(socket, communityId);
      };

      socket.on('join_game', handleJoin);
      socket.on('join_lobby', handleJoin);

      socket.on('game_action', ({ action, amount }: { action: string; amount?: number }) => {
        this.handleGameAction(socket.id, action, amount);
      });

      socket.on('chat_message', ({ message, gameId }: { message: string; gameId?: string }) => {
        this.handleChatMessage(socket, message, gameId);
      });

      socket.on('leave_game', () => {
        this.handleLeaveGame(socket.id);
      });

      socket.on('disconnect', () => {
        console.log(`❌ Player disconnected: ${user.username} (${socket.id})`);
        this.handleDisconnect(socket);
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
    const playerInfo = this.connectedPlayers.get(socketId);
    if (!playerInfo) {
      console.log(`⚠️  Unknown player tried to act: ${socketId}`);
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId);
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
      this.io.to(socketId).emit('action_error', { error: result.error });
      console.log(`   ❌ Invalid: ${result.error}`);
      return;
    }

    // Save updated game state back to Redis
    await GameStateStorage.saveGameState(gameId, game.toJSON());

    // Clear existing timer and start new one for next player
    const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
    if (timeoutSeconds && game.getStage() !== 'complete' && game.getStage() !== 'showdown') {
      this.startActionTimer(gameId, timeoutSeconds);
    }

    // Broadcast updated game state to all players in this game
    await this.broadcastGameState(gameId);

    // Check if game is complete
    if (game.getStage() === 'complete') {
      console.log(`🏆 Game ${gameId} completed`);
      
      // Record hand history (fire and forget)
      this.recordHandHistory(gameId, game).catch(err => {
        console.error(`❌ Failed to record hand history for ${gameId}:`, err.message);
      });
      
      // Process payouts
      await this.processGamePayouts(gameId, game);
      
      setTimeout(async () => {
        // Start new hand
        game.startHand();
        await GameStateStorage.saveGameState(gameId, game.toJSON());
        
        // Start action timer for new hand
        const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
        if (timeoutSeconds) {
          this.startActionTimer(gameId, timeoutSeconds);
        }
        
        await this.broadcastGameState(gameId);
      }, 3000);
    }
  }

  /**
   * Record hand history to the auth-api database
   */
  private async recordHandHistory(gameId: string, game: Game): Promise<void> {
    try {
      // Extract table info from gameId (format: "table_123")
      const tableId = parseInt(gameId.split('_')[1]);
      
      // Get community_id from table readiness info
      const tableState = this.tableReadiness.get(gameId);
      if (!tableState) {
        console.warn(`⚠️  No table state found for ${gameId}, skipping history recording`);
        return;
      }
      
      // Get community_id from one of the connected players
      let communityId: number | null = null;
      let tableName = `Table ${tableId}`;
      
      for (const [, playerInfo] of this.connectedPlayers.entries()) {
        if (playerInfo.gameId === gameId && playerInfo.communityId) {
          communityId = playerInfo.communityId;
          break;
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
        console.log(`📜 Hand history recorded: ${response.data.hand_id}`);
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

  private async broadcastGameState(gameId: string): Promise<void> {
    // Load game from Redis
    const gameData = await GameStateStorage.loadGameState(gameId);
    if (!gameData) return;

    const game = Game.fromJSON(gameData);

    // Send personalized state to each player (with their hole cards)
    for (const player of game.getPlayers()) {
      // Try to find socket by playerId (old lobby system)
      let socketId = Array.from(this.connectedPlayers.entries())
        .find(([_, info]) => info.playerId === player.id)?.[0];
      
      // If not found, try to find by userId from player name (table system)
      // Player name format is the username, and we can look up socketId from userIdToSocketId
      if (!socketId) {
        // Extract userId from playerId (format: player_<userId>_<timestamp>)
        const match = player.id.match(/^player_(\d+)_/);
        if (match) {
          const userId = parseInt(match[1]);
          socketId = this.userIdToSocketId.get(userId);
        }
      }
      
      if (socketId) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          this.io.to(socketId).emit('game_state_update', {
            gameState: game.getPlayerGameState(player.id)
          });
        }
      }
    }
  }

  /**
   * Starts an action timer for the current player
   */
  private startActionTimer(gameId: string, timeoutSeconds: number): void {
    // Clear any existing timer for this game
    this.clearActionTimer(gameId);

    // Set new timer
    const timerId = setTimeout(async () => {
      await this.handleActionTimeout(gameId);
    }, timeoutSeconds * 1000);

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
      console.error(`   ❌ Timeout handling failed: ${result.error}`);
      return;
    }

    // Save updated game state
    await GameStateStorage.saveGameState(gameId, game.toJSON());

    // Broadcast updated state
    await this.broadcastGameState(gameId);

    // Check if game is complete after timeout
    if (game.getStage() === 'complete') {
      console.log(`🏆 Game ${gameId} completed after timeout`);
      
      // Record hand history
      this.recordHandHistory(gameId, game).catch(err => {
        console.error(`❌ Failed to record hand history for ${gameId}:`, err.message);
      });
      
      // Process payouts
      await this.processGamePayouts(gameId, game);
      
      // Clear timer
      this.clearActionTimer(gameId);
      
      setTimeout(async () => {
        // Start new hand
        game.startHand();
        await GameStateStorage.saveGameState(gameId, game.toJSON());
        await this.broadcastGameState(gameId);
        
        // Restart timer for new hand
        const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
        if (timeoutSeconds) {
          this.startActionTimer(gameId, timeoutSeconds);
        }
      }, 3000);
    } else {
      // Game continues - restart timer for next player
      const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
      if (timeoutSeconds) {
        this.startActionTimer(gameId, timeoutSeconds);
      }
    }
  }

  private async handleLeaveGame(socketId: string): Promise<void> {
    const playerInfo = this.connectedPlayers.get(socketId);
    if (!playerInfo) return;

    const gameId = this.playerGameMap.get(playerInfo.playerId);
    if (gameId) {
      // Load game from Redis
      const gameData = await GameStateStorage.loadGameState(gameId);
      
      // Credit remaining stack back to wallet
      if (gameData && playerInfo.communityId) {
        const game = Game.fromJSON(gameData);
        const player = game.getPlayers().find((p: any) => p.id === playerInfo.playerId);
        if (player) {
          const stackAmount = player.getStack();
          if (stackAmount > 0) {
            await this.creditWallet(
              playerInfo.userId,
              playerInfo.communityId,
              stackAmount,
              `Refund from leaving game: ${stackAmount} chips`
            );
            console.log(`💸 ${playerInfo.playerName} refunded ${stackAmount} chips`);
          }
        }
      }
      
      this.io.to(gameId).emit('player_left', { 
        playerName: playerInfo.playerName 
      });
      
      // Only delete game if all players have left
      // Check if any other players are still in this game
      const playersStillInGame = Array.from(this.connectedPlayers.values())
        .filter(info => info.playerId !== playerInfo.playerId && this.playerGameMap.get(info.playerId) === gameId);
      
      const disconnectedPlayersInGame = Array.from(this.disconnectedPlayers.values())
        .filter(info => info.playerInfo.playerId !== playerInfo.playerId && info.gameId === gameId);
      
      if (playersStillInGame.length === 0 && disconnectedPlayersInGame.length === 0) {
        // No other players in this game, safe to delete
        await GameStateStorage.deleteGameState(gameId);
        console.log(`🗑️  Game ${gameId} deleted - no players remaining`);
        
        // Unseat player from table in database
        await this.unseatPlayer(gameId, playerInfo.userId);
        
        // Check if table should be cleaned up (non-permanent tables only)
        await this.checkAndCleanupTable(gameId);
      } else {
        console.log(`⏳ Game ${gameId} preserved - ${playersStillInGame.length} connected, ${disconnectedPlayersInGame.length} disconnected`);
        
        // Unseat player even if game continues
        await this.unseatPlayer(gameId, playerInfo.userId);
      }
      
      this.playerGameMap.delete(playerInfo.playerId);
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
  }

  private async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const socketId = socket.id;
    const user = socket.data.user;
    const playerInfo = this.connectedPlayers.get(socketId);

    // Remove from table readiness tracking
    for (const [gameId, tableState] of this.tableReadiness.entries()) {
      if (tableState.connectedPlayers.has(user.id.toString())) {
        tableState.connectedPlayers.delete(user.id.toString());
        console.log(`📋 Player ${user.id} disconnected from ${gameId}. ${tableState.connectedPlayers.size}/${tableState.seatedPlayers.size} still connected`);
      }
    }

    if (playerInfo && this.recentlyReconnected.has(playerInfo.playerId)) {
      // Player just reconnected and disconnected quickly - might be a flaky connection
      // Give them normal reconnection grace instead of immediate cleanup
      this.recentlyReconnected.delete(playerInfo.playerId);
      console.log(`⚠️  ${user.username} disconnected shortly after reconnecting - treating as temporary disconnect`);
      // Fall through to normal disconnect handling below
    }

    if (!playerInfo) {
      this.userIdToSocketId.delete(user.id);
      return;
    }

    const gameId = this.playerGameMap.get(playerInfo.playerId);

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
      setTimeout(() => {
        // Check if player reconnected
        if (this.disconnectedPlayers.has(socketId)) {
          console.log(`⏰ ${user.username} did not reconnect in time, removing from game`);
          this.disconnectedPlayers.delete(socketId);
          this.handleLeaveGame(socketId);
        }
      }, this.RECONNECT_TIMEOUT);
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

        // Validate request
        if (!userId || !gameId || !action) {
          return res.status(400).json({ 
            error: 'Missing required fields: userId, gameId, action' 
          });
        }

        console.log(`🤖 Agent action: User ${userId}, Game ${gameId}, Action: ${action}${amount ? ` ${amount}` : ''}`);

        // Load game from Redis
        const gameData = await GameStateStorage.loadGameState(gameId);
        if (!gameData) {
          return res.status(404).json({ error: 'Game not found' });
        }

        const game = Game.fromJSON(gameData);

        // Find player by userId (need to get playerId from connectedPlayers or playerGameMap)
        let playerId: string | undefined;
        
        // Check if user is connected via WebSocket
        for (const [socketId, playerInfo] of this.connectedPlayers.entries()) {
          if (playerInfo.userId === userId) {
            playerId = playerInfo.playerId;
            break;
          }
        }

        // If not in connectedPlayers, check playerGameMap
        if (!playerId) {
          for (const [pid, gid] of this.playerGameMap.entries()) {
            if (gid === gameId) {
              // Check if this player matches the userId
              const players = game.getPlayers();
              for (const player of players) {
                if (player.id === pid) {
                  // We found a player in this game, but we need to verify userId
                  // For now, use the first player in the game (agent bots)
                  playerId = pid;
                  break;
                }
              }
              if (playerId) break;
            }
          }
        }

        if (!playerId) {
          return res.status(404).json({ error: 'Player not found in game' });
        }

        // Perform the action
        const result = game.handleAction(playerId, action as any, amount);

        if (!result.valid) {
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
          console.log(`🏆 Game ${gameId} completed (agent action)`);
          
          // Record hand history (fire and forget)
          this.recordHandHistory(gameId, game).catch(err => {
            console.error(`❌ Failed to record hand history for ${gameId}:`, err.message);
          });
          
          await this.processGamePayouts(gameId, game);
          
          setTimeout(async () => {
            game.startHand();
            await GameStateStorage.saveGameState(gameId, game.toJSON());
            
            // Start action timer for new hand
            const timeoutSeconds = game.getGameState().actionTimeoutSeconds;
            if (timeoutSeconds) {
              this.startActionTimer(gameId, timeoutSeconds);
            }
            
            await this.broadcastGameState(gameId);
          }, 3000);
        }

        // Return the updated game state
        const playerGameState = game.getPlayerGameState(playerId);
        res.json({
          success: true,
          gameState: playerGameState
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

        // Load game from Redis
        const gameData = await GameStateStorage.loadGameState(gameId);
        if (!gameData) {
          return res.status(404).json({ error: 'Game not found' });
        }

        const game = Game.fromJSON(gameData);

        // Find player by userId
        let playerId: string | undefined;
        for (const [socketId, playerInfo] of this.connectedPlayers.entries()) {
          if (playerInfo.userId === Number(userId)) {
            playerId = playerInfo.playerId;
            break;
          }
        }

        // If not found in connectedPlayers, use first player in game (for agent bots)
        if (!playerId) {
          const players = game.getPlayers();
          if (players.length > 0) {
            playerId = players[0].id;
          }
        }

        if (!playerId) {
          return res.status(404).json({ error: 'Player not found in game' });
        }

        // Return player-specific game state
        const playerGameState = game.getPlayerGameState(playerId);
        res.json({
          gameState: playerGameState
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

        // Fetch table configuration including action_timeout_seconds
        let actionTimeoutSeconds: number | undefined;
        try {
          const tableResponse = await axios.get(`${FASTAPI_URL}/api/internal/tables/${table_id}`);
          actionTimeoutSeconds = tableResponse.data.action_timeout_seconds;
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

        // Check if player already seated
        const existingPlayer = game.getPlayers().find(p => p.name === username);
        if (existingPlayer) {
          return res.status(400).json({ 
            error: 'Player already seated at this table' 
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
        // TODO: Get max_seats from table config, for now use 9
        const maxSeats = 9;
        if (game.getPlayers().length >= maxSeats) {
          return res.status(400).json({ 
            error: 'Table is full' 
          });
        }

        // Add player to game
        game.addPlayer(player);
        console.log(`✅ Player ${username} added to game at seat ${seat_number}. Total players: ${game.getPlayers().length}`);        // Save game state to Redis
        await GameStateStorage.saveGameState(gameId, game.toJSON());

        // Map player to game for future lookups
        this.playerGameMap.set(playerId, gameId);

        // Track seated player for readiness check
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
        tableState.seatedPlayers.add(user_id.toString());
        console.log(`📋 Table ${table_id}: ${tableState.seatedPlayers.size} seated, ${tableState.connectedPlayers.size} connected`);

        // Broadcast game state update to all connected players at this table
        for (const [socketId, playerInfo] of this.connectedPlayers.entries()) {
          if (playerInfo.gameId === gameId) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
              const playerState = game.getPlayerGameState(playerInfo.playerId);
              socket.emit('game_state_update', playerState);
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
          message: `Player ${username} seated successfully`,
          game_id: gameId,
          player_id: playerId,
          players_count: currentPlayerCount,
          max_seats: maxSeats
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
