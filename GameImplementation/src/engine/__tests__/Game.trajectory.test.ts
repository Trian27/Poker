import { Game } from '../Game';
import { Player } from '../Player';
import { createScenarioGame, runTrajectoryScenario } from './helpers/gameTrajectory';

describe('Game trajectory scenarios', () => {
  const config = {
    smallBlind: 10,
    bigBlind: 20,
    initialStack: 1000,
    actionTimeoutSeconds: 15,
  };

  it('preserves heads-up blind order and BB response rights across streets', () => {
    runTrajectoryScenario({
      config,
      players: [
        { id: 'p1', name: 'Alice', stack: 1000, seatNumber: 1 },
        { id: 'p2', name: 'Bob', stack: 1000, seatNumber: 2 },
      ],
      expectInitial: {
        stage: 'preflop',
        currentPlayerId: 'p2',
        currentBet: 20,
      },
      steps: [
        {
          actorId: 'p2',
          action: 'call',
          expectAfter: {
            stage: 'preflop',
            currentPlayerId: 'p1',
            currentBet: 20,
          },
        },
        {
          actorId: 'p1',
          action: 'check',
          expectAfter: {
            stage: 'flop',
            currentPlayerId: 'p1',
            communityCards: 3,
            currentBet: 0,
          },
        },
        {
          actorId: 'p1',
          action: 'check',
          expectAfter: {
            stage: 'flop',
            currentPlayerId: 'p2',
          },
        },
        {
          actorId: 'p2',
          action: 'check',
          expectAfter: {
            stage: 'turn',
            currentPlayerId: 'p1',
            communityCards: 4,
          },
        },
        {
          actorId: 'p1',
          action: 'check',
          expectAfter: {
            stage: 'turn',
            currentPlayerId: 'p2',
          },
        },
        {
          actorId: 'p2',
          action: 'check',
          expectAfter: {
            stage: 'river',
            currentPlayerId: 'p1',
            communityCards: 5,
          },
        },
      ],
    });
  });

  it('keeps waiting-for-big-blind players out of the live hand until activation', () => {
    const game = createScenarioGame({
      config,
      players: [
        { id: 'p1', name: 'Alice', stack: 1000, seatNumber: 1 },
        { id: 'p2', name: 'Bob', stack: 1000, seatNumber: 2 },
      ],
    });

    game.addPlayer(new Player('p3', 'Charlie', 1000, 3));

    let state = game.getGameState();
    expect(state.players.find((player) => player.id === 'p3')?.waitingForBigBlind).toBe(true);
    expect(state.players.find((player) => player.id === 'p3')?.isActive).toBe(false);

    for (let hand = 0; hand < 6; hand += 1) {
      while (true) {
        state = game.getGameState();
        if (state.stage === 'complete') {
          break;
        }
        const actorId = state.players[state.currentPlayerIndex]?.id;
        expect(actorId).toBeTruthy();
        expect(game.handleAction(actorId!, 'fold').valid).toBe(true);
      }

      game.startHand();
      state = game.getGameState();
      const queuedPlayer = state.players.find((player) => player.id === 'p3');
      if (queuedPlayer && !queuedPlayer.waitingForBigBlind) {
        expect(queuedPlayer.isActive).toBe(true);
        expect(state.players[state.currentPlayerIndex]?.id).not.toBe('p3');
        return;
      }
    }

    throw new Error('Queued player never activated at their big blind');
  });

  it('creates side pots and preserves total pot accounting through all-in runout', () => {
    const game = new Game(config);
    game.addPlayer(new Player('p1', 'Alice', 150, 1));
    game.addPlayer(new Player('p2', 'Bob', 300, 2));
    game.addPlayer(new Player('p3', 'Charlie', 500, 3));
    game.startHand();

    let state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

    state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

    state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

    const finalState = game.getGameState();
    expect(finalState.stage).toBe('complete');
    expect((finalState.sidePots || []).length).toBeGreaterThan(0);
    expect(finalState.lastHandResult).toBeTruthy();

    const totalStacks = game.getPlayers().reduce((sum, player) => sum + player.getStack(), 0);
    expect(totalStacks).toBe(950);
    expect(finalState.lastHandResult?.totalPot).toBe(750);
  });

  it('advances directly to showdown-complete once all remaining players are all-in', () => {
    const game = new Game(config);
    game.addPlayer(new Player('p1', 'Alice', 120, 1));
    game.addPlayer(new Player('p2', 'Bob', 120, 2));
    game.startHand();

    let state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

    state = game.getGameState();
    expect(state.stage).toBe('preflop');
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

    const finalState = game.getGameState();
    expect(finalState.stage).toBe('complete');
    expect(finalState.communityCards).toHaveLength(5);
    expect(finalState.lastHandResult).toBeTruthy();
    expect(finalState.lastHandResult?.players).toHaveLength(2);
  });

  it('ends immediately when action folds to a single winner and records fold result', () => {
    const game = createScenarioGame({
      config,
      players: [
        { id: 'p1', name: 'Alice', stack: 1000, seatNumber: 1 },
        { id: 'p2', name: 'Bob', stack: 1000, seatNumber: 2 },
        { id: 'p3', name: 'Charlie', stack: 1000, seatNumber: 3 },
      ],
    });

    let state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'fold').valid).toBe(true);
    state = game.getGameState();
    expect(game.handleAction(state.players[state.currentPlayerIndex].id, 'fold').valid).toBe(true);

    const finalState = game.getGameState();
    expect(finalState.stage).toBe('complete');
    expect(finalState.communityCards).toHaveLength(0);
    expect(finalState.lastHandResult?.endedByFold).toBe(true);
    expect(finalState.lastHandResult?.winners).toHaveLength(1);
  });
});
