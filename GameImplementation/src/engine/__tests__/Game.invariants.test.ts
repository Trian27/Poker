import { Game, type GameConfig } from '../Game';
import { Player } from '../Player';

interface CandidateAction {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
  amount?: number;
}

const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 10,
  bigBlind: 20,
  initialStack: 1000,
  actionTimeoutSeconds: 15,
};

const createRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const uniqueCards = (game: Game): string[] => {
  const state = game.getGameState();
  const cards = state.communityCards.map((card) => `${card.rank}${card.suit}`);
  game.getPlayers().forEach((player) => {
    player.getHoleCards().forEach((card) => {
      cards.push(`${card.rank}${card.suit}`);
    });
  });
  return cards;
};

const assertGameInvariants = (game: Game, startingChipTotal: number): void => {
  const state = game.getGameState();
  const totalStacks = game.getPlayers().reduce((sum, player) => sum + player.getStack(), 0);
  if (state.stage === 'complete') {
    expect(totalStacks).toBe(startingChipTotal);
  } else {
    expect(totalStacks + state.pot).toBe(startingChipTotal);
  }

  game.getPlayers().forEach((player) => {
    expect(player.getStack()).toBeGreaterThanOrEqual(0);
    expect(player.getCurrentBet()).toBeGreaterThanOrEqual(0);
  });

  const liveCards = uniqueCards(game);
  expect(new Set(liveCards).size).toBe(liveCards.length);

  const actionablePlayers = state.players.filter((player) => player.isActive && !player.hasFolded && !player.isAllIn);
  if (state.stage === 'waiting' || state.stage === 'complete' || state.stage === 'showdown') {
    expect(state.currentPlayerIndex === -1 || state.currentPlayerIndex >= 0).toBe(true);
  } else if (actionablePlayers.length > 0) {
    expect(state.currentPlayerIndex).toBeGreaterThanOrEqual(0);
    const currentPlayer = state.players[state.currentPlayerIndex];
    expect(currentPlayer).toBeTruthy();
    expect(currentPlayer.isActive).toBe(true);
    expect(currentPlayer.hasFolded).toBe(false);
    expect(currentPlayer.isAllIn).toBe(false);
  }

  const communityCount = state.communityCards.length;
  if (state.stage === 'preflop') {
    expect(communityCount).toBe(0);
  } else if (state.stage === 'flop') {
    expect(communityCount).toBe(3);
  } else if (state.stage === 'turn') {
    expect(communityCount).toBe(4);
  } else if (state.stage === 'river' || state.stage === 'showdown' || state.stage === 'complete') {
    expect(communityCount).toBeLessThanOrEqual(5);
  }

  expect(state.minRaiseSize).toBeGreaterThanOrEqual(DEFAULT_CONFIG.bigBlind);
};

const getActionCandidates = (game: Game): CandidateAction[] => {
  const state = game.getGameState();
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) {
    return [];
  }

  const highestBet = Math.max(...state.players.map((player) => player.currentBet));
  const callAmount = Math.max(0, highestBet - currentPlayer.currentBet);
  const minRaiseSize = Math.max(DEFAULT_CONFIG.bigBlind, state.minRaiseSize || DEFAULT_CONFIG.bigBlind);
  const bigBlind = state.bigBlind || DEFAULT_CONFIG.bigBlind;

  const candidates: CandidateAction[] = [
    { action: 'fold' },
    { action: 'check' },
    { action: 'call' },
    { action: 'all-in' },
  ];

  if (callAmount === 0) {
    candidates.push({ action: 'bet', amount: minRaiseSize });
    candidates.push({ action: 'bet', amount: minRaiseSize + bigBlind });
  } else {
    candidates.push({ action: 'raise', amount: minRaiseSize });
    candidates.push({ action: 'raise', amount: minRaiseSize + bigBlind });
  }

  return candidates;
};

const getValidActions = (game: Game): CandidateAction[] => {
  const state = game.getGameState();
  const actorId = state.players[state.currentPlayerIndex]?.id;
  if (!actorId) {
    return [];
  }

  return getActionCandidates(game).filter((candidate) => {
    const clone = Game.fromJSON(game.toJSON());
    return clone.handleAction(actorId, candidate.action, candidate.amount).valid;
  });
};

const playRandomGame = (seed: number, playerCount: number): void => {
  const rng = createRng(seed);
  const config = { ...DEFAULT_CONFIG };
  const game = new Game(config);
  const players: Player[] = [];

  for (let index = 0; index < playerCount; index += 1) {
    const stack = 300 + Math.floor(rng() * 900);
    const player = new Player(`p${index + 1}`, `Player ${index + 1}`, stack, index + 1);
    players.push(player);
    game.addPlayer(player);
  }

  game.startHand();
  const initialState = game.getGameState();
  const startingChipTotal = game.getPlayers().reduce((sum, player) => sum + player.getStack(), 0) + initialState.pot;
  assertGameInvariants(game, startingChipTotal);

  let guard = 0;
  while (game.getStage() !== 'complete' && guard < 200) {
    const validActions = getValidActions(game);
    expect(validActions.length).toBeGreaterThan(0);

    const choice = validActions[Math.floor(rng() * validActions.length)];
    const actorId = game.getGameState().players[game.getGameState().currentPlayerIndex]?.id;
    expect(actorId).toBeTruthy();

    const result = game.handleAction(actorId!, choice.action, choice.amount);
    expect(result.valid).toBe(true);
    assertGameInvariants(game, startingChipTotal);
    guard += 1;
  }

  expect(guard).toBeLessThan(200);
  expect(game.getStage()).toBe('complete');
};

describe('Game invariants under randomized trajectories', () => {
  const seeds = Array.from({ length: 10 }, (_, index) => index + 1);

  it.each(seeds)('preserves core invariants for 2-player game seed %s', (seed) => {
    playRandomGame(seed, 2);
  });

  it.each(seeds)('preserves core invariants for 3-player game seed %s', (seed) => {
    playRandomGame(seed + 100, 3);
  });
});
