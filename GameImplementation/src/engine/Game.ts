import { Card } from './Card';
import { Deck } from './Deck';
import { HandEvaluator, HandEvaluation } from './Hand';
import { Player, PlayerAction } from './Player';

export type GameStage = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  initialStack: number;
  ante?: number; // Optional ante (used in tournaments)
  actionTimeoutSeconds?: number; // Optional action timeout in seconds (default: 30)
  reserveTimeSeconds?: number; // Per-player total reserve time for this table session
}

export interface ActionResult {
  valid: boolean;
  error?: string;
  gameState?: GameState;
  timeBankExhausted?: boolean;
  exhaustedPlayerId?: string;
  exhaustedPlayerName?: string;
}

export interface GameState {
  stage: GameStage;
  pot: number;
  sidePots: { index: number; amount: number; eligiblePlayerIds: string[] }[];
  communityCards: Card[];
  currentPlayerIndex: number;
  currentBet: number;
  players: ReturnType<Player['getPublicState']>[];
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  smallBlind: number;
  bigBlind: number;
  minRaiseSize: number;
  winners?: { playerId: string; amount: number; hand: string }[];
  lastHandResult?: HandResult | null;
  actionTimeoutSeconds?: number;
  remainingActionTime?: number;
  remainingReserveTime?: number;
}

export interface HandResultWinner {
  playerId: string;
  userId: number | null;
  username: string;
  amount: number;
  handDescription: string;
  bestHandCards: Card[];
  holeCards: Card[];
}

export interface HandResultPlayerCards {
  playerId: string;
  userId: number | null;
  username: string;
  folded: boolean;
  isWinner: boolean;
  holeCards: Card[];
}

export interface HandResult {
  totalPot: number;
  endedByFold: boolean;
  winners: HandResultWinner[];
  players: HandResultPlayerCards[];
}

interface PotSegment {
  index: number;
  amount: number;
  eligiblePlayerIds: string[];
}

export interface HandActionLogEntry {
  sequence: number;
  stage: GameStage;
  playerId: string;
  userId: number | null;
  username: string;
  action: PlayerAction | 'small-blind' | 'big-blind';
  source: 'player' | 'timeout' | 'forced';
  requestedAmount: number | null;
  committedChips: number;
  toCallBefore: number;
  minimumRaiseBefore: number;
  playersInHandBefore: number;
  potBefore: number;
  potAfter: number;
  currentBetBefore: number;
  currentBetAfter: number;
  playerBetBefore: number;
  playerBetAfter: number;
  playerStackBefore: number;
  playerStackAfter: number;
  elapsedMsSinceHandStart: number;
}

/**
 * Main game class that manages the poker game flow
 */
export class Game {
  private players: Player[] = [];
  private deck: Deck;
  private communityCards: Card[] = [];
  private pot: number = 0;
  private stage: GameStage = 'waiting';
  private currentPlayerIndex: number = 0;
  private currentBet: number = 0;
  private dealerIndex: number = 0;
  private smallBlindIndex: number = 0;
  private bigBlindIndex: number = 0;
  private lastRaiserIndex: number = -1;
  private playersActedThisRound: Set<string> = new Set(); // Track who has acted this round
  private lastRaiseSize: number = 0; // Size of the last raise (for minimum raise enforcement)
  private config: GameConfig;
  private actionStartTime: number = 0; // Timestamp when current player's action started
  private currentActionPlayerId: string | null = null; // ID of player currently on the clock
  private lastHandResult: HandResult | null = null;
  private handActionLog: HandActionLogEntry[] = [];
  private handStartingStacks: Record<string, number> = {};
  private handStartedAt: number = 0;

  private isActionStage(): boolean {
    return this.stage === 'preflop' || this.stage === 'flop' || this.stage === 'turn' || this.stage === 'river';
  }

  constructor(config: GameConfig) {
    this.config = {
      ...config,
      reserveTimeSeconds: config.reserveTimeSeconds ?? 30
    };
    this.deck = new Deck();
  }

  /**
   * Adds a player to the game
   */
  addPlayer(player: Player): void {
    if (this.players.length >= 10) {
      throw new Error('Maximum 10 players allowed');
    }
    
    // If game is in progress (not waiting, not complete), seat immediately
    // but keep player inactive until the next hand. If they are not due to
    // be the big blind next hand, keep them queued until their BB hand.
    if (this.stage !== 'waiting' && this.stage !== 'complete' && this.stage !== 'showdown') {
      const joinCheck = this.canPlayerJoinAtSeat(player.seatNumber ?? 0);
      player.setInactive(); // Never joins current in-progress hand
      player.setWaitingForBigBlind(!joinCheck.canJoin);
    }
    
    this.players.push(player);
    
    // Sort players by seat number to maintain turn order
    // Players without seat numbers go to the end
    this.players.sort((a, b) => {
      const seatA = a.seatNumber ?? Infinity;
      const seatB = b.seatNumber ?? Infinity;
      return seatA - seatB;
    });
  }

  /**
   * Removes a player from the game.
   * Used when a player leaves a table so their seat can be reused.
   */
  removePlayer(playerId: string): boolean {
    const playerIndex = this.players.findIndex((player) => player.id === playerId);
    if (playerIndex === -1) {
      return false;
    }

    this.players.splice(playerIndex, 1);
    this.playersActedThisRound.delete(playerId);
    if (this.currentActionPlayerId === playerId) {
      this.currentActionPlayerId = null;
      this.actionStartTime = 0;
    }

    if (this.players.length === 0) {
      this.resetToWaitingState();
      return true;
    }

    if (this.players.length === 1) {
      if (this.pot > 0) {
        this.players[0].addChips(this.pot);
      }
      this.resetToWaitingState();
      return true;
    }

    const remapIndex = (index: number): number => {
      if (index < 0) return index;
      if (index > playerIndex) return index - 1;
      if (index === playerIndex) return Math.min(playerIndex, this.players.length - 1);
      return index;
    };

    this.currentPlayerIndex = remapIndex(this.currentPlayerIndex);
    this.dealerIndex = remapIndex(this.dealerIndex);
    this.smallBlindIndex = remapIndex(this.smallBlindIndex);
    this.bigBlindIndex = remapIndex(this.bigBlindIndex);
    this.lastRaiserIndex = this.lastRaiserIndex === -1 ? -1 : remapIndex(this.lastRaiserIndex);

    // Keep the action moving after a leave.
    if (this.stage !== 'waiting' && this.stage !== 'complete' && this.stage !== 'showdown') {
      const activePlayers = this.players.filter((player) => player.getIsActive() && !player.getHasFolded());
      if (activePlayers.length === 1) {
        this.handleWinner(activePlayers[0]);
      } else {
        const nextActionableIndex = this.players.findIndex(
          (player) => player.getIsActive() && !player.getHasFolded() && !player.getIsAllIn()
        );
        if (nextActionableIndex >= 0) {
          this.currentPlayerIndex = nextActionableIndex;
        }
        this.startActionTimer();
      }
    }

    return true;
  }

  /**
   * Checks if a player can join at a specific seat number.
   * Players can only join if they would be in the big blind position for the next hand.
   * This prevents players from joining to skip blinds and leaving before paying them.
   * 
   * @param seatNumber - The seat number the player wants to join at
   * @returns Object with canJoin boolean and reason string
   */
  canPlayerJoinAtSeat(seatNumber: number): { canJoin: boolean; reason: string } {
    // If game hasn't started yet or is complete, anyone can join
    if (this.stage === 'waiting' || this.stage === 'complete') {
      return { canJoin: true, reason: 'Game not in progress' };
    }

    // If no players, anyone can join
    if (this.players.length === 0) {
      return { canJoin: true, reason: 'No players yet' };
    }

    // Create temporary sorted player list with the new player
    const tempPlayers = [...this.players, { seatNumber } as Player].sort((a, b) => {
      const seatA = a.seatNumber ?? Infinity;
      const seatB = b.seatNumber ?? Infinity;
      return seatA - seatB;
    });

    // Find the index of the new player in the sorted list
    const newPlayerIndex = tempPlayers.findIndex(p => p.seatNumber === seatNumber);

    // Calculate where the dealer button will be NEXT hand
    // (it moves one position after current hand completes)
    const nextDealerIndex = (this.dealerIndex + 1) % tempPlayers.length;

    // Calculate where big blind will be next hand with new player count
    let nextBigBlindIndex: number;
    if (tempPlayers.length === 2) {
      // Heads-up: opponent of dealer is big blind
      nextBigBlindIndex = (nextDealerIndex + 1) % tempPlayers.length;
    } else {
      // Multi-way: two positions after dealer
      nextBigBlindIndex = (nextDealerIndex + 2) % tempPlayers.length;
    }

    // Player can only join if they would be the big blind next hand
    if (newPlayerIndex === nextBigBlindIndex) {
      return { 
        canJoin: true, 
        reason: `You will be the big blind in the next hand` 
      };
    } else {
      return { 
        canJoin: false, 
        reason: `You can only join when you would be the big blind. Wait for the current hand to finish and try a different seat or timing.` 
      };
    }
  }

  /**
   * Starts a new hand
   */
  startHand(): void {
    if (this.players.length < 2) {
      throw new Error('Need at least 2 players to start');
    }

    // Reset for new hand
    this.deck.reset();
    this.deck.shuffle();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaiserIndex = -1;
    this.lastRaiseSize = 0;
    this.playersActedThisRound.clear();
    this.lastHandResult = null;
    this.handActionLog = [];
    this.handStartedAt = Date.now();
    this.handStartingStacks = {};

    // Reset all players
    this.players.forEach(p => p.resetForNewHand());
    this.players.forEach((player) => {
      this.handStartingStacks[player.id] = player.getStack();
    });

    // Post antes if configured
    if (this.config.ante && this.config.ante > 0) {
      for (const player of this.players) {
        const anteAmount = player.bet(this.config.ante);
        this.pot += anteAmount;
      }
    }

    // Move dealer button (always rotate, even on first hand)
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    
    // Set blind positions based on player count
    if (this.players.length === 2) {
      // Heads-up: dealer is small blind, opponent is big blind
      this.smallBlindIndex = this.dealerIndex;
      this.bigBlindIndex = (this.dealerIndex + 1) % this.players.length;
    } else {
      // Multi-way: normal positions
      this.smallBlindIndex = (this.dealerIndex + 1) % this.players.length;
      this.bigBlindIndex = (this.dealerIndex + 2) % this.players.length;
    }

    // Players waiting to post BB only become active once their seat reaches BB.
    const queuedBigBlind = this.players[this.bigBlindIndex];
    if (queuedBigBlind && queuedBigBlind.isWaitingForBigBlind()) {
      queuedBigBlind.setWaitingForBigBlind(false);
      queuedBigBlind.setActive();
    }

    const activePlayers = this.players.filter((player) => player.getIsActive() && player.getStack() > 0);
    if (activePlayers.length < 2) {
      this.stage = 'waiting';
      this.clearActionTimerState();
      return;
    }

    // Post blinds
    const sbPlayer = this.players[this.smallBlindIndex];
    const bbPlayer = this.players[this.bigBlindIndex];
    const sbPotBefore = this.pot;
    const sbAmount = sbPlayer.getIsActive() ? sbPlayer.bet(this.config.smallBlind) : 0;
    const sbPotAfter = sbPotBefore + sbAmount;
    const bbPotBefore = sbPotAfter;
    const bbAmount = bbPlayer.getIsActive() ? bbPlayer.bet(this.config.bigBlind) : 0;
    this.pot += sbAmount + bbAmount;
    this.currentBet = bbAmount > 0 ? this.config.bigBlind : 0;

    this.appendActionLog({
      stage: 'preflop',
      playerId: sbPlayer.id,
      userId: Game.extractUserId(sbPlayer.id),
      username: sbPlayer.name,
      action: 'small-blind',
      source: 'forced',
      requestedAmount: this.config.smallBlind,
      committedChips: sbAmount,
      toCallBefore: 0,
      minimumRaiseBefore: this.config.bigBlind,
      playersInHandBefore: this.players.length,
      potBefore: sbPotBefore,
      potAfter: sbPotAfter,
      currentBetBefore: 0,
      currentBetAfter: sbPlayer.getCurrentBet(),
      playerBetBefore: 0,
      playerBetAfter: sbPlayer.getCurrentBet(),
      playerStackBefore: this.handStartingStacks[sbPlayer.id] ?? (sbPlayer.getStack() + sbAmount),
      playerStackAfter: sbPlayer.getStack(),
    });

    this.appendActionLog({
      stage: 'preflop',
      playerId: bbPlayer.id,
      userId: Game.extractUserId(bbPlayer.id),
      username: bbPlayer.name,
      action: 'big-blind',
      source: 'forced',
      requestedAmount: this.config.bigBlind,
      committedChips: bbAmount,
      toCallBefore: Math.max(0, sbPlayer.getCurrentBet() - bbPlayer.getCurrentBet()),
      minimumRaiseBefore: this.config.bigBlind,
      playersInHandBefore: this.players.length,
      potBefore: bbPotBefore,
      potAfter: this.pot,
      currentBetBefore: sbPlayer.getCurrentBet(),
      currentBetAfter: bbPlayer.getCurrentBet(),
      playerBetBefore: 0,
      playerBetAfter: bbPlayer.getCurrentBet(),
      playerStackBefore: this.handStartingStacks[bbPlayer.id] ?? (bbPlayer.getStack() + bbAmount),
      playerStackAfter: bbPlayer.getStack(),
    });
    
    // Mark blind posters as having acted
    this.playersActedThisRound.add(this.players[this.smallBlindIndex].id);
    this.playersActedThisRound.add(this.players[this.bigBlindIndex].id);

    // Deal hole cards
    for (const player of this.players) {
      if (player.getIsActive()) {
        player.dealHoleCards(this.deck.dealMultiple(2));
      }
    }

    this.stage = 'preflop';
    
    // Set first player to act based on player count
    if (this.players.length === 2) {
      // Heads-up: small blind (dealer) acts first pre-flop
      this.currentPlayerIndex = this.smallBlindIndex;
    } else {
      // Multi-way: player after big blind (UTG) acts first
      this.currentPlayerIndex = (this.bigBlindIndex + 1) % this.players.length;
    }

    // Ensure first turn is assigned to an actionable player.
    let attempts = 0;
    while (attempts < this.players.length) {
      const current = this.players[this.currentPlayerIndex];
      if (current.getIsActive() && !current.getHasFolded() && !current.getIsAllIn()) {
        break;
      }
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      attempts += 1;
    }

    // Start action timer for first player
    this.startActionTimer();
  }

  /**
   * Starts the action timer for the current player
   */
  private startActionTimer(): void {
    if (!this.isActionStage() || this.players.length === 0) {
      this.currentActionPlayerId = null;
      this.actionStartTime = 0;
      return;
    }
    this.actionStartTime = Date.now();
    this.currentActionPlayerId = this.players[this.currentPlayerIndex].id;
  }

  private clearActionTimerState(): void {
    this.currentActionPlayerId = null;
    this.actionStartTime = 0;
  }

  private getPerTurnActionSeconds(): number {
    const configured = Number(this.config.actionTimeoutSeconds ?? 30);
    if (!Number.isFinite(configured) || configured <= 0) {
      return 30;
    }
    return configured;
  }

  private getPerTurnActionMs(): number {
    return Math.floor(this.getPerTurnActionSeconds() * 1000);
  }

  private getCurrentTurnElapsedMs(): number {
    if (this.actionStartTime <= 0) {
      return 0;
    }
    return Math.max(0, Date.now() - this.actionStartTime);
  }

  private getCurrentActionPlayer(): Player | null {
    if (this.players.length === 0) {
      return null;
    }

    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.players.length) {
      return null;
    }

    return this.players[this.currentPlayerIndex];
  }

  private getCurrentPlayerTimeBankRemainingSeconds(): number {
    const currentPlayer = this.getCurrentActionPlayer();
    if (!currentPlayer) {
      return 0;
    }

    const elapsedMs = this.currentActionPlayerId === currentPlayer.id
      ? this.getCurrentTurnElapsedMs()
      : 0;
    const overtimeMs = Math.max(0, elapsedMs - this.getPerTurnActionMs());
    const remainingMs = Math.max(0, currentPlayer.getTimeBankMs() - overtimeMs);
    return remainingMs / 1000;
  }

  private consumeCurrentPlayerTimeBank(): { player: Player | null; exhausted: boolean } {
    const currentPlayer = this.getCurrentActionPlayer();
    if (!currentPlayer) {
      return { player: null, exhausted: false };
    }

    if (this.currentActionPlayerId !== currentPlayer.id || this.actionStartTime <= 0) {
      this.currentActionPlayerId = currentPlayer.id;
      this.actionStartTime = Date.now();
      return { player: currentPlayer, exhausted: currentPlayer.getTimeBankMs() <= 0 };
    }

    const elapsedMs = this.getCurrentTurnElapsedMs();
    const overtimeMs = Math.max(0, elapsedMs - this.getPerTurnActionMs());
    const reserveBefore = currentPlayer.getTimeBankMs();

    if (overtimeMs > 0) {
      currentPlayer.deductTimeBank(Math.min(reserveBefore, overtimeMs));
    }
    this.actionStartTime = Date.now();

    return { player: currentPlayer, exhausted: overtimeMs > 0 && overtimeMs >= reserveBefore };
  }

  private resetToWaitingState(): void {
    this.stage = 'waiting';
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.currentPlayerIndex = 0;
    this.dealerIndex = 0;
    this.smallBlindIndex = 0;
    this.bigBlindIndex = 0;
    this.lastRaiserIndex = -1;
    this.lastRaiseSize = 0;
    this.playersActedThisRound.clear();
    this.clearActionTimerState();
    this.lastHandResult = null;
    this.players.forEach((player) => player.resetForNewHand());
  }

  /**
   * Gets the remaining time in seconds for the current player's action
   */
  getRemainingActionTime(): number {
    if (!this.isActionStage() || !this.getCurrentActionPlayer()) {
      return 0;
    }

    const elapsedSeconds = this.getCurrentTurnElapsedMs() / 1000;
    return Math.max(0, this.getPerTurnActionSeconds() - elapsedSeconds);
  }

  getRemainingReserveTime(): number {
    if (!this.isActionStage()) {
      return 0;
    }
    return Math.max(0, this.getCurrentPlayerTimeBankRemainingSeconds());
  }

  getRemainingTotalTime(): number {
    return this.getRemainingActionTime() + this.getRemainingReserveTime();
  }

  /**
   * Checks if the current action has timed out
   */
  hasActionTimedOut(): boolean {
    if (!this.isActionStage() || !this.getCurrentActionPlayer()) {
      return false;
    }

    return this.getRemainingTotalTime() <= 0;
  }

  /**
   * Handles a timeout by automatically folding or checking the current player
   */
  handleTimeout(): ActionResult {
    if (!this.isActionStage()) {
      return {
        valid: false,
        error: 'No active hand in progress'
      };
    }
    const player = this.players[this.currentPlayerIndex];

    const consumed = this.consumeCurrentPlayerTimeBank();
    if (consumed.exhausted) {
      return {
        valid: false,
        error: 'Time bank exhausted',
        timeBankExhausted: true,
        exhaustedPlayerId: player.id,
        exhaustedPlayerName: player.name
      };
    }
    
    // If player can check (no bet to call), check; otherwise fold
    if (player.getCurrentBet() >= this.currentBet) {
      return this.executeAction(player.id, 'check', undefined, { skipTimeConsumption: true, source: 'timeout' });
    } else {
      return this.executeAction(player.id, 'fold', undefined, { skipTimeConsumption: true, source: 'timeout' });
    }
  }

  /**
   * Handles a player action
   */
  handleAction(playerId: string, action: PlayerAction, amount?: number): ActionResult {
    return this.executeAction(playerId, action, amount);
  }

  private appendActionLog(entry: Omit<HandActionLogEntry, 'sequence' | 'elapsedMsSinceHandStart'>): void {
    const elapsedMs = this.handStartedAt > 0 ? Math.max(0, Date.now() - this.handStartedAt) : 0;
    this.handActionLog.push({
      ...entry,
      sequence: this.handActionLog.length + 1,
      elapsedMsSinceHandStart: elapsedMs,
    });
  }

  private executeAction(
    playerId: string,
    action: PlayerAction,
    amount?: number,
    options: { skipTimeConsumption?: boolean; source?: 'player' | 'timeout' | 'forced' } = {}
  ): ActionResult {
    if (!this.isActionStage()) {
      return { valid: false, error: 'Hand is complete. Wait for next hand.' };
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) {
      return { valid: false, error: 'Player not found' };
    }

    if (this.players[this.currentPlayerIndex].id !== playerId) {
      return { valid: false, error: 'Not your turn' };
    }

    if (!player.getIsActive() || player.getHasFolded()) {
      return { valid: false, error: 'Player is not active in this hand' };
    }

    const timedOutBeforeAction = this.hasActionTimedOut();
    if (!options.skipTimeConsumption) {
      const consumed = this.consumeCurrentPlayerTimeBank();
      if (consumed.exhausted) {
        return {
          valid: false,
          error: 'Time bank exhausted',
          timeBankExhausted: true,
          exhaustedPlayerId: player.id,
          exhaustedPlayerName: player.name
        };
      }
    }

    // Check if action has timed out
    if (timedOutBeforeAction && !options.skipTimeConsumption) {
      return { valid: false, error: 'Action timed out' };
    }

    const potBefore = this.pot;
    const currentBetBefore = this.currentBet;
    const playerBetBefore = player.getCurrentBet();
    const playerStackBefore = player.getStack();
    const toCallBefore = Math.max(0, currentBetBefore - playerBetBefore);
    const minimumRaiseBefore = this.getMinimumRaise();
    const playersInHandBefore = this.players.filter(
      (entry) => entry.getIsActive() && !entry.getHasFolded()
    ).length;
    let committedChips = 0;

    // Process action
    try {
      switch (action) {
        case 'fold':
          player.fold();
          break;

        case 'check':
          if (player.getCurrentBet() < this.currentBet) {
            return { valid: false, error: 'Cannot check, must call or raise' };
          }
          break;

        case 'call': {
          const toCall = this.currentBet - player.getCurrentBet();
          const betAmount = player.bet(toCall);
          this.pot += betAmount;
          committedChips += betAmount;
          break;
        }

        case 'bet':
        case 'raise': {
          if (amount === undefined || amount <= 0) {
            return { valid: false, error: 'Bet/raise amount must be specified and positive' };
          }

          const toCall = this.currentBet - player.getCurrentBet();
          const totalBet = toCall + amount;
          const isAllIn = totalBet >= player.getStack();
          
          // For minimum validation:
          // - For 'bet': amount is the bet size
          // - For 'raise': amount is the additional raise on top of the call
          // In both cases, 'amount' represents the chips being added beyond what's required
          const raiseSize = amount;
          
          // Check minimum bet/raise requirements (except for all-in)
          const minimumRaise = this.getMinimumRaise();
          
          if (!isAllIn && raiseSize < minimumRaise) {
            return { 
              valid: false, 
              error: `Minimum ${action} is $${minimumRaise}` 
            };
          }
          
          if (isAllIn) {
            // All-in - always allowed regardless of minimum
            const betAmount = player.bet(player.getStack());
            this.pot += betAmount;
            committedChips += betAmount;
            const newBet = player.getCurrentBet(); // Use current round bet, not cumulative
            if (newBet > this.currentBet) {
              // Track raise size for next raise minimum (only if this actually raises)
              this.lastRaiseSize = newBet - this.currentBet;
              this.currentBet = newBet;
              this.lastRaiserIndex = this.currentPlayerIndex;
            }
          } else {
            const betAmount = player.bet(totalBet);
            this.pot += betAmount;
            committedChips += betAmount;
            const newBet = player.getCurrentBet(); // Use current round bet, not cumulative
            // Track raise size for next raise minimum
            this.lastRaiseSize = newBet - this.currentBet;
            this.currentBet = newBet;
            this.lastRaiserIndex = this.currentPlayerIndex;
          }
          break;
        }

        case 'all-in': {
          const betAmount = player.bet(player.getStack());
          this.pot += betAmount;
          committedChips += betAmount;
          const newBet = player.getCurrentBet(); // Use current round bet
          if (newBet > this.currentBet) {
            this.lastRaiseSize = newBet - this.currentBet;
            this.currentBet = newBet;
            this.lastRaiserIndex = this.currentPlayerIndex;
          }
          break;
        }

        default:
          return { valid: false, error: 'Invalid action' };
      }

      // Mark that this player has acted this round
      this.playersActedThisRound.add(playerId);

      this.appendActionLog({
        stage: this.stage,
        playerId: player.id,
        userId: Game.extractUserId(player.id),
        username: player.name,
        action,
        source: options.source || 'player',
        requestedAmount: amount ?? null,
        committedChips,
        toCallBefore,
        minimumRaiseBefore,
        playersInHandBefore,
        potBefore,
        potAfter: this.pot,
        currentBetBefore,
        currentBetAfter: this.currentBet,
        playerBetBefore,
        playerBetAfter: player.getCurrentBet(),
        playerStackBefore,
        playerStackAfter: player.getStack(),
      });

      // Move to next player
      this.nextTurn();

      return { valid: true, gameState: this.getGameState() };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }

  /**
   * Moves to the next player's turn
   */
  private nextTurn(): void {
    const activePlayers = this.players.filter(p => p.getIsActive() && !p.getHasFolded());

    // Check if only one player remains
    if (activePlayers.length === 1) {
      this.handleWinner(activePlayers[0]);
      return;
    }

    // Find next active player
    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    let attempts = 0;
    while (attempts < this.players.length) {
      const nextPlayer = this.players[nextIndex];
      if (nextPlayer.getIsActive() && !nextPlayer.getHasFolded() && !nextPlayer.getIsAllIn()) {
        // Check if betting round is complete
        if (this.isBettingRoundComplete(nextIndex)) {
          this.advanceStage();
          return;
        }
        this.currentPlayerIndex = nextIndex;
        this.startActionTimer(); // Start timer for next player
        return;
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      attempts++;
    }

    // All remaining players are all-in, advance to showdown
    this.advanceStage();
  }

  /**
   * Gets the minimum raise amount for the current betting round
   */
  private getMinimumRaise(): number {
    // If no one has bet yet, minimum bet is the big blind
    if (this.currentBet === 0) {
      return this.config.bigBlind;
    }
    
    // If there's been a bet but no raise, minimum raise is the bet size
    if (this.lastRaiseSize === 0) {
      return this.currentBet;
    }
    
    // If there's been a raise, minimum re-raise is the last raise size
    return this.lastRaiseSize;
  }

  /**
   * Checks if the current betting round is complete
   */
  private isBettingRoundComplete(nextIndex: number): boolean {
    // Get all players who can still act
    const activePlayers = this.players.filter(p => p.getIsActive() && !p.getHasFolded() && !p.getIsAllIn());
    
    if (activePlayers.length === 0) {
      return true; // All folded or all-in
    }

    // If we have a raiser this round, we need to come back to them
    if (this.lastRaiserIndex !== -1) {
      return nextIndex === this.lastRaiserIndex;
    }

    // No raises this round - check if all active players have acted
    for (const player of activePlayers) {
      if (!this.playersActedThisRound.has(player.id)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Advances to the next stage of the game
   */
  private advanceStage(): void {
    // Reset player bets for new round
    this.players.forEach(p => p.resetForNewRound());
    this.currentBet = 0;
    this.lastRaiserIndex = -1;
    this.lastRaiseSize = 0; // Reset raise size for new round
    this.playersActedThisRound.clear(); // Reset tracking for new round

    // Check if we should continue or go to showdown
    const activePlayers = this.players.filter(p => p.getIsActive() && !p.getHasFolded());
    const playersWhoCanAct = activePlayers.filter(p => !p.getIsAllIn());
    
    // If only all-in players remain, skip straight to showdown
    if (playersWhoCanAct.length <= 1 && this.stage !== 'river') {
      // Deal remaining community cards without betting
      while (this.communityCards.length < 5) {
        if (this.communityCards.length === 0) {
          this.dealFlop();
        } else if (this.communityCards.length === 3) {
          this.dealTurn();
        } else if (this.communityCards.length === 4) {
          this.dealRiver();
        }
        // Reset for next "round" even though there's no betting
        this.players.forEach(p => p.resetForNewRound());
      }
      this.showdown();
      return;
    }

    // Find first active player starting from small blind (correct post-flop position)
    let firstPlayerIndex = this.smallBlindIndex;
    while (this.players[firstPlayerIndex].getHasFolded() || 
           this.players[firstPlayerIndex].getIsAllIn() || 
           !this.players[firstPlayerIndex].getIsActive()) {
      firstPlayerIndex = (firstPlayerIndex + 1) % this.players.length;
      // Safety check to prevent infinite loop
      if (firstPlayerIndex === this.smallBlindIndex) {
        // All players are folded/all-in/inactive - go to showdown
        this.showdown();
        return;
      }
    }
    this.currentPlayerIndex = firstPlayerIndex;

    switch (this.stage) {
      case 'preflop':
        this.dealFlop();
        break;
      case 'flop':
        this.dealTurn();
        break;
      case 'turn':
        this.dealRiver();
        break;
      case 'river':
        this.showdown();
        break;
    }

    // Start timer only while betting is still active.
    if (this.isActionStage()) {
      this.startActionTimer();
    } else {
      this.clearActionTimerState();
    }
  }

  private dealFlop(): void {
    this.deck.burn(); // Burn card before flop
    this.communityCards.push(...this.deck.dealMultiple(3));
    this.stage = 'flop';
  }

  private dealTurn(): void {
    this.deck.burn(); // Burn card before turn
    this.communityCards.push(this.deck.deal());
    this.stage = 'turn';
  }

  private dealRiver(): void {
    this.deck.burn(); // Burn card before river
    this.communityCards.push(this.deck.deal());
    this.stage = 'river';
  }

  private showdown(): void {
    this.stage = 'showdown';
    const totalPot = this.pot;
    const activePlayers = this.players.filter(p => p.getIsActive() && !p.getHasFolded());
    
    // Evaluate all hands
    const evaluations: { player: Player; evaluation: HandEvaluation }[] = [];
    for (const player of activePlayers) {
      const allCards = [...player.getHoleCards(), ...this.communityCards];
      const evaluation = HandEvaluator.evaluateHand(allCards);
      evaluations.push({ player, evaluation });
    }

    const evaluationsByPlayerId = new Map<string, HandEvaluation>();
    evaluations.forEach(({ player, evaluation }) => evaluationsByPlayerId.set(player.id, evaluation));

    const playersById = new Map<string, Player>();
    this.players.forEach((player) => playersById.set(player.id, player));

    const winnerAmounts = new Map<string, number>();
    const winnerEvaluations = new Map<string, HandEvaluation>();

    const potSegments = this.buildPotSegments();
    const segmentsToAward = potSegments.length > 0
      ? potSegments
      : [{
          index: 1,
          amount: totalPot,
          eligiblePlayerIds: activePlayers.map((player) => player.id),
        }];

    for (const segment of segmentsToAward) {
      const eligibleIds = segment.eligiblePlayerIds.filter((playerId) => evaluationsByPlayerId.has(playerId));
      if (eligibleIds.length === 0 || segment.amount <= 0) {
        continue;
      }

      let bestEvaluation: HandEvaluation | null = null;
      let segmentWinnerIds: string[] = [];

      for (const eligibleId of eligibleIds) {
        const evaluation = evaluationsByPlayerId.get(eligibleId)!;
        if (!bestEvaluation) {
          bestEvaluation = evaluation;
          segmentWinnerIds = [eligibleId];
          continue;
        }
        const compare = HandEvaluator.compareHands(evaluation, bestEvaluation);
        if (compare > 0) {
          bestEvaluation = evaluation;
          segmentWinnerIds = [eligibleId];
        } else if (compare === 0) {
          segmentWinnerIds.push(eligibleId);
        }
      }

      if (!bestEvaluation || segmentWinnerIds.length === 0) {
        continue;
      }

      const segmentPayouts = this.splitPotAmount(segment.amount, segmentWinnerIds);
      segmentPayouts.forEach((amount, winnerId) => {
        if (amount <= 0) {
          return;
        }
        const player = playersById.get(winnerId);
        if (!player) {
          return;
        }
        player.addChips(amount);
        winnerAmounts.set(winnerId, (winnerAmounts.get(winnerId) || 0) + amount);
        if (!winnerEvaluations.has(winnerId)) {
          winnerEvaluations.set(winnerId, evaluationsByPlayerId.get(winnerId)!);
        }
      });
    }

    let totalAwarded = 0;
    winnerAmounts.forEach((amount) => {
      totalAwarded += amount;
    });

    // Defensive fallback: ensure no chips are lost due to malformed pot segments.
    if (totalAwarded < totalPot && evaluations.length > 0) {
      evaluations.sort((a, b) => HandEvaluator.compareHands(b.evaluation, a.evaluation));
      const bestHand = evaluations[0].evaluation;
      const fallbackWinnerIds = evaluations
        .filter((entry) => HandEvaluator.compareHands(entry.evaluation, bestHand) === 0)
        .map((entry) => entry.player.id);
      const remainderPayouts = this.splitPotAmount(totalPot - totalAwarded, fallbackWinnerIds);
      remainderPayouts.forEach((amount, winnerId) => {
        if (amount <= 0) {
          return;
        }
        const player = playersById.get(winnerId);
        if (!player) {
          return;
        }
        player.addChips(amount);
        winnerAmounts.set(winnerId, (winnerAmounts.get(winnerId) || 0) + amount);
        if (!winnerEvaluations.has(winnerId)) {
          const evaluation = evaluationsByPlayerId.get(winnerId);
          if (evaluation) {
            winnerEvaluations.set(winnerId, evaluation);
          }
        }
      });
    }

    const winners = Array.from(winnerAmounts.entries())
      .filter(([, amount]) => amount > 0)
      .map(([playerId, amount]) => ({
        player: playersById.get(playerId)!,
        evaluation: winnerEvaluations.get(playerId) || evaluationsByPlayerId.get(playerId)!,
        amount,
      }))
      .sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount;
        }
        return this.players.findIndex((player) => player.id === a.player.id)
          - this.players.findIndex((player) => player.id === b.player.id);
      });

    this.lastHandResult = {
      totalPot,
      endedByFold: false,
      winners: winners.map(({ player, evaluation, amount }) => ({
        playerId: player.id,
        userId: Game.extractUserId(player.id),
        username: player.name,
        amount,
        handDescription: HandEvaluator.describeHand(evaluation),
        bestHandCards: evaluation.cards,
        holeCards: player.getHoleCards()
      })),
      players: this.buildRevealPlayers(new Set(winners.map(({ player }) => player.id)))
    };

    this.stage = 'complete';
    this.clearActionTimerState();
  }

  private handleWinner(winner: Player): void {
    const totalPot = this.pot;
    winner.addChips(this.pot);
    this.lastHandResult = {
      totalPot,
      endedByFold: true,
      winners: [{
        playerId: winner.id,
        userId: Game.extractUserId(winner.id),
        username: winner.name,
        amount: totalPot,
        handDescription: 'Won by fold',
        bestHandCards: [],
        holeCards: []
      }],
      players: this.buildRevealPlayers(new Set([winner.id]))
    };
    this.stage = 'complete';
    this.clearActionTimerState();
  }

  private buildRevealPlayers(winnerIds: Set<string>): HandResultPlayerCards[] {
    return this.players
      .filter((player) => player.getHoleCards().length > 0)
      .map((player) => ({
        playerId: player.id,
        userId: Game.extractUserId(player.id),
        username: player.name,
        folded: player.getHasFolded(),
        isWinner: winnerIds.has(player.id),
        holeCards: player.getHoleCards()
      }));
  }

  private buildPotSegments(): PotSegment[] {
    const contributions = this.players
      .map((player) => ({
        player,
        amount: Math.max(0, Math.floor(player.getTotalBetThisRound())),
      }))
      .filter((entry) => entry.amount > 0);

    if (contributions.length === 0) {
      return [];
    }

    const uniqueContributionLevels = Array.from(new Set(contributions.map((entry) => entry.amount))).sort((a, b) => a - b);
    const segments: PotSegment[] = [];
    let previousLevel = 0;

    for (const contributionLevel of uniqueContributionLevels) {
      const participants = contributions.filter((entry) => entry.amount >= contributionLevel);
      const segmentAmount = (contributionLevel - previousLevel) * participants.length;
      previousLevel = contributionLevel;

      if (segmentAmount <= 0) {
        continue;
      }

      const eligiblePlayerIds = participants
        .map((entry) => entry.player)
        .filter((player) => !player.getHasFolded())
        .map((player) => player.id);

      if (eligiblePlayerIds.length === 0) {
        continue;
      }

      segments.push({
        index: segments.length + 1,
        amount: segmentAmount,
        eligiblePlayerIds,
      });
    }

    return segments;
  }

  private splitPotAmount(totalAmount: number, winnerIds: string[]): Map<string, number> {
    const payouts = new Map<string, number>();
    if (totalAmount <= 0 || winnerIds.length === 0) {
      return payouts;
    }

    const orderedWinnerIds = [...winnerIds].sort((a, b) => {
      const indexA = this.players.findIndex((player) => player.id === a);
      const indexB = this.players.findIndex((player) => player.id === b);
      return indexA - indexB;
    });
    const baseShare = Math.floor(totalAmount / orderedWinnerIds.length);
    let remainder = totalAmount - (baseShare * orderedWinnerIds.length);

    for (const winnerId of orderedWinnerIds) {
      const amount = baseShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder -= 1;
      }
      payouts.set(winnerId, amount);
    }

    return payouts;
  }

  /**
   * Gets hand history data for recording
   * Should be called after hand completes
   */
  getHandHistory(): any {
    const playersById = new Map(this.players.map((player) => [player.id, player]));
    const participantsFromResult = this.lastHandResult?.players ?? [];
    const participants = participantsFromResult.length > 0
      ? participantsFromResult.map((entry) => {
          const player = playersById.get(entry.playerId);
          return {
            playerId: entry.playerId,
            userId: entry.userId ?? Game.extractUserId(entry.playerId),
            username: entry.username,
            seatNumber: player?.seatNumber,
            holeCards: entry.holeCards,
            finalStack: player?.getStack() ?? 0,
            folded: entry.folded,
            allIn: player?.getIsAllIn() ?? false,
          };
        })
      : this.players
          .filter((player) => player.getHoleCards().length > 0 || player.getHasFolded())
          .map((player) => {
            const state = player.getState();
            return {
              playerId: player.id,
              userId: Game.extractUserId(player.id),
              username: player.name,
              seatNumber: player.seatNumber,
              holeCards: state.holeCards,
              finalStack: player.getStack(),
              folded: player.getHasFolded(),
              allIn: player.getIsAllIn(),
            };
          });
    
    return {
      pot: this.pot,
      community_cards: this.communityCards.map(c => ({ rank: c.rank, suit: c.suit })),
      players: participants.map((entry) => ({
        user_id: entry.userId ?? 0,
        player_id: entry.playerId,
        username: entry.username,
        seat_number: entry.seatNumber,
        hole_cards: entry.holeCards.map((card) => ({ rank: card.rank, suit: card.suit })),
        final_stack: entry.finalStack,
        folded: entry.folded,
        all_in: entry.allIn,
      })),
      winner: this.getWinnerInfo(),
      stage: this.stage,
      blinds: {
        small_blind: this.config.smallBlind,
        big_blind: this.config.bigBlind
      },
      dealer_player_id: this.players[this.dealerIndex]?.id || null,
      small_blind_player_id: this.players[this.smallBlindIndex]?.id || null,
      big_blind_player_id: this.players[this.bigBlindIndex]?.id || null,
      starting_stacks: this.handStartingStacks,
      action_log: this.handActionLog,
    };
  }

  /**
   * Gets winner information for hand history
   */
  private getWinnerInfo(): any {
    if (this.lastHandResult && this.lastHandResult.winners.length > 0) {
      const winner = this.lastHandResult.winners[0];
      return {
        user_id: winner.userId || 0,
        username: winner.username,
        winning_hand: winner.handDescription
      };
    }

    // Find player(s) who won (have chips from pot)
    // This is a simplified version - in a real scenario we'd track this explicitly
    const activePlayers = this.players.filter(p => p.getIsActive() && !p.getHasFolded());
    
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      return {
        user_id: parseInt(winner.id.split('_')[1]) || 0,
        username: winner.name,
        winning_hand: null // Could be null if everyone else folded
      };
    }
    
    // For showdown, we'd need to track the actual winner
    // For now, return null and rely on the pot distribution logic
    return null;
  }

  /**
   * Gets the current game state
   */
  getGameState(): GameState {
    const potSegments = this.buildPotSegments();
    const hasAllInPlayer = this.players.some((player) => player.getIsAllIn());
    return {
      stage: this.stage,
      pot: this.pot,
      // Side pots only exist when at least one player is all-in and
      // remaining players can continue betting beyond that amount.
      sidePots: hasAllInPlayer && potSegments.length > 1 ? potSegments.slice(1) : [],
      communityCards: this.communityCards,
      currentPlayerIndex: this.currentPlayerIndex,
      currentBet: this.currentBet,
      players: this.players.map((player) => {
        const publicState = player.getPublicState();
        const elapsedMs = this.currentActionPlayerId === player.id && this.actionStartTime > 0
          ? this.getCurrentTurnElapsedMs()
          : 0;
        const overtimeMs = Math.max(0, elapsedMs - this.getPerTurnActionMs());
        const remainingMs = Math.max(0, player.getTimeBankMs() - overtimeMs);
        return {
          ...publicState,
          timeBankMs: remainingMs,
          timeBankSeconds: Math.ceil(remainingMs / 1000)
        };
      }),
      dealerIndex: this.dealerIndex,
      smallBlindIndex: this.smallBlindIndex,
      bigBlindIndex: this.bigBlindIndex,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minRaiseSize: this.getMinimumRaise(),
      lastHandResult: this.lastHandResult,
      actionTimeoutSeconds: this.getPerTurnActionSeconds(),
      remainingActionTime: this.getRemainingActionTime(),
      remainingReserveTime: this.getRemainingReserveTime()
    };
  }

  /**
   * Gets the game state for a specific player (includes their hole cards)
   */
  getPlayerGameState(playerId: string): GameState & { myCards: Card[] } {
    const player = this.players.find(p => p.id === playerId);
    return {
      ...this.getGameState(),
      myCards: player ? player.getHoleCards() : []
    };
  }

  getPlayers(): Player[] {
    return this.players;
  }

  getStage(): GameStage {
    return this.stage;
  }

  getLastHandResult(): HandResult | null {
    return this.lastHandResult;
  }

  /**
   * Serialize game to JSON for Redis storage
   */
  toJSON(): any {
    return {
      config: this.config,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        stack: p.getStack(),
        bet: p.getCurrentBet(),
        totalBetThisRound: p.getTotalBetThisRound(),
        timeBankMs: p.getTimeBankMs(),
        waitingForBigBlind: p.isWaitingForBigBlind(),
        holeCards: p.getHoleCards().map(c => ({ rank: c.rank, suit: c.suit })),
        hasFolded: p.getHasFolded(),
        isAllIn: p.getIsAllIn(),
        isActive: p.getIsActive(),
        seatNumber: p.seatNumber
      })),
      communityCards: this.communityCards.map(c => ({ rank: c.rank, suit: c.suit })),
      pot: this.pot,
      stage: this.stage,
      currentPlayerIndex: this.currentPlayerIndex,
      currentBet: this.currentBet,
      dealerIndex: this.dealerIndex,
      smallBlindIndex: this.smallBlindIndex,
      bigBlindIndex: this.bigBlindIndex,
      lastRaiserIndex: this.lastRaiserIndex,
      lastRaiseSize: this.lastRaiseSize,
      playersActedThisRound: Array.from(this.playersActedThisRound),
      deckCards: (this.deck as any).cards.map((c: Card) => ({ rank: c.rank, suit: c.suit })),
      actionStartTime: this.actionStartTime,
      currentActionPlayerId: this.currentActionPlayerId,
      handActionLog: this.handActionLog,
      handStartingStacks: this.handStartingStacks,
      handStartedAt: this.handStartedAt,
      lastHandResult: this.lastHandResult ? {
        totalPot: this.lastHandResult.totalPot,
        endedByFold: this.lastHandResult.endedByFold,
        winners: this.lastHandResult.winners.map((winner) => ({
          ...winner,
          bestHandCards: winner.bestHandCards.map((card) => ({ rank: card.rank, suit: card.suit })),
          holeCards: winner.holeCards.map((card) => ({ rank: card.rank, suit: card.suit }))
        })),
        players: this.lastHandResult.players.map((player) => ({
          ...player,
          holeCards: player.holeCards.map((card) => ({ rank: card.rank, suit: card.suit }))
        }))
      } : null
    };
  }

  /**
   * Restore game from JSON (from Redis)
   */
  static fromJSON(data: any): Game {
    const game = new Game(data.config);
    
    // Restore players
    game.players = data.players.map((pData: any) => {
      const player = new Player(pData.id, pData.name, pData.stack, pData.seatNumber);
      // Access private fields using bracket notation (not ideal but necessary for restoration)
      (player as any).currentBet = pData.bet;
      (player as any).totalBetThisRound = pData.totalBetThisRound;
      player.setWaitingForBigBlind(Boolean(pData.waitingForBigBlind));
      (player as any).hasFolded = pData.hasFolded;
      (player as any).isAllIn = pData.isAllIn;
      (player as any).isActive = pData.isActive;
      (player as any).holeCards = pData.holeCards.map((c: any) => Game.deserializeCard(c));
      player.setTimeBankMs(Number(pData.timeBankMs ?? 30000));
      return player;
    });

    // Restore community cards
    game.communityCards = data.communityCards.map((c: any) => Game.deserializeCard(c));

    // Restore game state
    game.pot = data.pot;
    game.stage = data.stage;
    game.currentPlayerIndex = data.currentPlayerIndex;
    game.currentBet = data.currentBet;
    game.dealerIndex = data.dealerIndex;
    game.smallBlindIndex = data.smallBlindIndex;
    game.bigBlindIndex = data.bigBlindIndex;
    game.lastRaiserIndex = data.lastRaiserIndex;
    game.lastRaiseSize = data.lastRaiseSize;
    game.playersActedThisRound = new Set(data.playersActedThisRound || []);
    game.actionStartTime = data.actionStartTime || 0;
    game.currentActionPlayerId = data.currentActionPlayerId || null;
    game.handActionLog = Array.isArray(data.handActionLog) ? data.handActionLog : [];
    game.handStartingStacks = data.handStartingStacks && typeof data.handStartingStacks === 'object'
      ? data.handStartingStacks
      : {};
    game.handStartedAt = Number(data.handStartedAt || 0);
    game.lastHandResult = data.lastHandResult ? {
      totalPot: Number(data.lastHandResult.totalPot || 0),
      endedByFold: Boolean(data.lastHandResult.endedByFold),
      winners: Array.isArray(data.lastHandResult.winners)
        ? data.lastHandResult.winners.map((winner: any) => ({
            playerId: winner.playerId,
            userId: winner.userId ?? Game.extractUserId(winner.playerId),
            username: winner.username,
            amount: Number(winner.amount || 0),
            handDescription: winner.handDescription || '',
            bestHandCards: Array.isArray(winner.bestHandCards)
              ? winner.bestHandCards.map((card: any) => Game.deserializeCard(card))
              : [],
            holeCards: Array.isArray(winner.holeCards)
              ? winner.holeCards.map((card: any) => Game.deserializeCard(card))
              : []
          }))
        : [],
      players: Array.isArray(data.lastHandResult.players)
        ? data.lastHandResult.players.map((player: any) => ({
            playerId: player.playerId,
            userId: player.userId ?? Game.extractUserId(player.playerId),
            username: player.username,
            folded: Boolean(player.folded),
            isWinner: Boolean(player.isWinner),
            holeCards: Array.isArray(player.holeCards)
              ? player.holeCards.map((card: any) => Game.deserializeCard(card))
              : []
          }))
        : []
    } : null;

    // Restore deck
    const deck = new Deck();
    (deck as any).cards = (data.deckCards || []).map((c: any) => Game.deserializeCard(c));
    game.deck = deck;

    return game;
  }

  private static extractUserId(playerId: string): number | null {
    const match = playerId.match(/^player_(\d+)_/);
    return match ? Number(match[1]) : null;
  }

  private static isSuit(value: unknown): value is Card['suit'] {
    return value === 'hearts' || value === 'diamonds' || value === 'clubs' || value === 'spades';
  }

  private static isRank(value: unknown): value is Card['rank'] {
    return value === '2' || value === '3' || value === '4' || value === '5' || value === '6' ||
      value === '7' || value === '8' || value === '9' || value === '10' ||
      value === 'J' || value === 'Q' || value === 'K' || value === 'A';
  }

  private static deserializeCard(data: any): Card {
    if (Game.isSuit(data?.suit) && Game.isRank(data?.rank)) {
      return new Card(data.suit, data.rank);
    }

    if (Game.isSuit(data?.rank) && Game.isRank(data?.suit)) {
      return new Card(data.rank, data.suit);
    }

    // Fall back to a valid default card to avoid crashing restoration.
    return new Card('spades', 'A');
  }
}
