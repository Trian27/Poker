import { Game, type GameConfig, type GameState } from '../../Game';
import { Player } from '../../Player';

type StateExpectation = {
  stage?: GameState['stage'];
  currentPlayerIndex?: number;
  currentBet?: number;
  pot?: number;
  minRaiseSize?: number;
  currentPlayerId?: string;
  activePlayerIds?: string[];
  waitingPlayerIds?: string[];
  communityCards?: number;
};

export interface TrajectoryPlayerSpec {
  id: string;
  name: string;
  stack: number;
  seatNumber?: number;
}

export interface TrajectoryStep {
  actorId?: string;
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
  amount?: number;
  expectBefore?: StateExpectation;
  expectAfter?: StateExpectation;
}

export interface TrajectoryScenario {
  config: GameConfig;
  players: TrajectoryPlayerSpec[];
  startHand?: boolean;
  expectInitial?: StateExpectation;
  steps: TrajectoryStep[];
}

const expectState = (game: Game, expectation: StateExpectation | undefined): void => {
  if (!expectation) {
    return;
  }

  const state = game.getGameState();

  if (expectation.stage !== undefined) {
    expect(state.stage).toBe(expectation.stage);
  }
  if (expectation.currentPlayerIndex !== undefined) {
    expect(state.currentPlayerIndex).toBe(expectation.currentPlayerIndex);
  }
  if (expectation.currentBet !== undefined) {
    expect(state.currentBet).toBe(expectation.currentBet);
  }
  if (expectation.pot !== undefined) {
    expect(state.pot).toBe(expectation.pot);
  }
  if (expectation.minRaiseSize !== undefined) {
    expect(state.minRaiseSize).toBe(expectation.minRaiseSize);
  }
  if (expectation.currentPlayerId !== undefined) {
    expect(state.players[state.currentPlayerIndex]?.id).toBe(expectation.currentPlayerId);
  }
  if (expectation.communityCards !== undefined) {
    expect(state.communityCards).toHaveLength(expectation.communityCards);
  }
  if (expectation.activePlayerIds !== undefined) {
    const activeIds = state.players
      .filter((player) => player.isActive)
      .map((player) => player.id)
      .sort();
    expect(activeIds).toEqual([...expectation.activePlayerIds].sort());
  }
  if (expectation.waitingPlayerIds !== undefined) {
    const waitingIds = state.players
      .filter((player) => player.waitingForBigBlind)
      .map((player) => player.id)
      .sort();
    expect(waitingIds).toEqual([...expectation.waitingPlayerIds].sort());
  }
};

export const createScenarioGame = (scenario: Omit<TrajectoryScenario, 'steps'>): Game => {
  const game = new Game(scenario.config);
  scenario.players.forEach((playerSpec) => {
    game.addPlayer(new Player(playerSpec.id, playerSpec.name, playerSpec.stack, playerSpec.seatNumber));
  });
  if (scenario.startHand !== false) {
    game.startHand();
  }
  expectState(game, scenario.expectInitial);
  return game;
};

export const runTrajectoryScenario = (scenario: TrajectoryScenario): Game => {
  const game = createScenarioGame(scenario);

  scenario.steps.forEach((step) => {
    expectState(game, step.expectBefore);

    const stateBeforeAction = game.getGameState();
    const actorId = step.actorId ?? stateBeforeAction.players[stateBeforeAction.currentPlayerIndex]?.id;
    expect(actorId).toBeTruthy();

    const result = game.handleAction(actorId!, step.action, step.amount);
    expect(result.valid).toBe(true);
    expectState(game, step.expectAfter);
  });

  return game;
};
