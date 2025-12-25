import { Game, GameConfig } from '../engine/Game';
import { Player } from '../engine/Player';
import { BlindStructure, BlindLevel } from './BlindStructure';

/**
 * Tournament state
 */
export type TournamentState = 
  | 'registering'  // Players can register
  | 'starting'     // About to begin
  | 'playing'      // In progress
  | 'break'        // On break
  | 'complete';    // Finished

/**
 * Tournament player with additional tracking
 */
export interface TournamentPlayer {
  player: Player;
  registrationTime: Date;
  eliminationTime?: Date;
  finalPosition?: number;
  isActive: boolean;
}

/**
 * Tournament configuration
 */
export interface TournamentConfig {
  name: string;
  structure: BlindStructure;
  maxPlayers?: number;
  lateRegistrationLevels?: number; // Allow late reg for N levels
}

/**
 * Tournament manages a complete poker tournament with blind escalation
 */
export class Tournament {
  private config: TournamentConfig;
  private players: Map<string, TournamentPlayer> = new Map();
  private state: TournamentState = 'registering';
  private currentLevel: number = 0;
  private currentLevelStartTime?: Date;
  private game?: Game;
  private levelTimer?: NodeJS.Timeout;

  constructor(config: TournamentConfig) {
    this.config = config;
  }

  /**
   * Registers a player for the tournament
   */
  registerPlayer(player: Player): { success: boolean; error?: string } {
    if (this.state !== 'registering' && this.state !== 'starting') {
      // Check if late registration is allowed
      if (this.state === 'playing') {
        const lateRegLevels = this.config.lateRegistrationLevels ?? 0;
        if (this.currentLevel > lateRegLevels) {
          return { 
            success: false, 
            error: 'Late registration has closed' 
          };
        }
      } else {
        return { 
          success: false, 
          error: 'Tournament registration is closed' 
        };
      }
    }

    if (this.players.has(player.id)) {
      return { 
        success: false, 
        error: 'Player already registered' 
      };
    }

    const maxPlayers = this.config.maxPlayers ?? Infinity;
    if (this.players.size >= maxPlayers) {
      return { 
        success: false, 
        error: 'Tournament is full' 
      };
    }

    this.players.set(player.id, {
      player,
      registrationTime: new Date(),
      isActive: true
    });

    return { success: true };
  }

  /**
   * Starts the tournament
   */
  start(): { success: boolean; error?: string } {
    if (this.state !== 'registering' && this.state !== 'starting') {
      return { 
        success: false, 
        error: 'Tournament already started' 
      };
    }

    if (this.players.size < 2) {
      return { 
        success: false, 
        error: 'Need at least 2 players to start' 
      };
    }

    this.state = 'playing';
    this.currentLevel = 0;
    
    // Advance to first level
    this.advanceLevel();

    return { success: true };
  }

  /**
   * Advances to the next blind level
   */
  private advanceLevel(): void {
    // Stop current timer if running
    if (this.levelTimer) {
      clearTimeout(this.levelTimer);
    }

    // Check if tournament is complete
    const activePlayers = Array.from(this.players.values())
      .filter(tp => tp.isActive);
    
    if (activePlayers.length <= 1) {
      this.completeTournament();
      return;
    }

    this.currentLevel++;
    const level = this.config.structure.levels[this.currentLevel - 1];

    if (!level) {
      // No more levels, tournament complete
      this.completeTournament();
      return;
    }

    this.currentLevelStartTime = new Date();

    // Check if this is a break
    if (level.level === 0) {
      this.state = 'break';
      console.log(`\n🛑 BREAK - ${level.duration} minutes\n`);
    } else {
      this.state = 'playing';
      console.log(`\n⬆️  LEVEL ${level.level} - Blinds: ${level.smallBlind}/${level.bigBlind}` + 
                  (level.ante > 0 ? ` (Ante: ${level.ante})` : '') + '\n');
      
      // Update game config if game exists
      if (this.game) {
        // Game is already running, update will happen on next hand
      } else {
        // Create initial game
        this.createGame(level);
      }
    }

    // Schedule next level
    const durationMs = level.duration * 60 * 1000;
    this.levelTimer = setTimeout(() => {
      this.advanceLevel();
    }, durationMs);
  }

  /**
   * Creates a game with the current blind level
   */
  private createGame(level: BlindLevel): void {
    const gameConfig: GameConfig = {
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      initialStack: this.config.structure.config.startingStack,
      ante: level.ante
    };

    this.game = new Game(gameConfig);

    // Add all active players
    for (const tp of this.players.values()) {
      if (tp.isActive) {
        this.game.addPlayer(tp.player);
      }
    }
  }

  /**
   * Gets the current blind level configuration for game updates
   */
  getCurrentLevelConfig(): GameConfig {
    const level = this.config.structure.levels[this.currentLevel - 1];
    if (!level || level.level === 0) {
      // During break or invalid, return previous level
      const prevLevel = this.config.structure.levels[Math.max(0, this.currentLevel - 2)];
      return {
        smallBlind: prevLevel?.smallBlind ?? 50,
        bigBlind: prevLevel?.bigBlind ?? 100,
        initialStack: this.config.structure.config.startingStack,
        ante: prevLevel?.ante ?? 0
      };
    }

    return {
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      initialStack: this.config.structure.config.startingStack,
      ante: level.ante
    };
  }

  /**
   * Eliminates a player from the tournament
   */
  eliminatePlayer(playerId: string): void {
    const tournamentPlayer = this.players.get(playerId);
    if (!tournamentPlayer) return;

    tournamentPlayer.isActive = false;
    tournamentPlayer.eliminationTime = new Date();

    const activePlayers = Array.from(this.players.values())
      .filter(tp => tp.isActive);
    
    tournamentPlayer.finalPosition = activePlayers.length + 1;

    console.log(`\n❌ ${tournamentPlayer.player.name} eliminated - Finish: ${tournamentPlayer.finalPosition}${this.getOrdinalSuffix(tournamentPlayer.finalPosition)} place\n`);
  }

  /**
   * Completes the tournament
   */
  private completeTournament(): void {
    if (this.levelTimer) {
      clearTimeout(this.levelTimer);
    }

    this.state = 'complete';

    const activePlayers = Array.from(this.players.values())
      .filter(tp => tp.isActive);

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.finalPosition = 1;
      console.log(`\n🏆 TOURNAMENT COMPLETE! Winner: ${winner.player.name} 🏆\n`);
    }

    this.printFinalStandings();
  }

  /**
   * Prints final tournament standings
   */
  private printFinalStandings(): void {
    const standings = Array.from(this.players.values())
      .filter(tp => tp.finalPosition !== undefined)
      .sort((a, b) => a.finalPosition! - b.finalPosition!);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║       FINAL TOURNAMENT STANDINGS       ║');
    console.log('╠═══════╦════════════════════════════════╣');
    console.log('║ Place ║ Player                         ║');
    console.log('╠═══════╬════════════════════════════════╣');

    for (const tp of standings) {
      const place = tp.finalPosition!.toString().padStart(5);
      const name = tp.player.name.padEnd(30);
      console.log(`║ ${place} ║ ${name} ║`);
    }

    console.log('╚═══════╩════════════════════════════════╝\n');
  }

  /**
   * Gets ordinal suffix for position (1st, 2nd, 3rd, etc.)
   */
  private getOrdinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  /**
   * Gets tournament state
   */
  getState(): TournamentState {
    return this.state;
  }

  /**
   * Gets current level number
   */
  getCurrentLevel(): number {
    return this.currentLevel;
  }

  /**
   * Gets current level details
   */
  getCurrentLevelDetails(): BlindLevel | undefined {
    return this.config.structure.levels[this.currentLevel - 1];
  }

  /**
   * Gets time remaining in current level (in seconds)
   */
  getTimeRemainingInLevel(): number {
    if (!this.currentLevelStartTime) return 0;

    const level = this.config.structure.levels[this.currentLevel - 1];
    if (!level) return 0;

    const elapsed = Date.now() - this.currentLevelStartTime.getTime();
    const duration = level.duration * 60 * 1000;
    const remaining = Math.max(0, duration - elapsed);

    return Math.floor(remaining / 1000);
  }

  /**
   * Gets active player count
   */
  getActivePlayerCount(): number {
    return Array.from(this.players.values())
      .filter(tp => tp.isActive).length;
  }

  /**
   * Gets total registered player count
   */
  getTotalPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Gets tournament info
   */
  getInfo(): {
    name: string;
    state: TournamentState;
    currentLevel: number;
    activePlayers: number;
    totalPlayers: number;
    timeRemaining: number;
    levelDetails?: BlindLevel;
  } {
    return {
      name: this.config.name,
      state: this.state,
      currentLevel: this.currentLevel,
      activePlayers: this.getActivePlayerCount(),
      totalPlayers: this.getTotalPlayerCount(),
      timeRemaining: this.getTimeRemainingInLevel(),
      levelDetails: this.getCurrentLevelDetails()
    };
  }

  /**
   * Gets the game instance (if tournament is running)
   */
  getGame(): Game | undefined {
    return this.game;
  }

  /**
   * Cleanup when tournament ends
   */
  destroy(): void {
    if (this.levelTimer) {
      clearTimeout(this.levelTimer);
    }
  }
}
