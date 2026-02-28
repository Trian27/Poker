import { Game } from '../engine/Game';
import { Player } from '../engine/Player';

describe('Game action gating after hand completion', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game({
      smallBlind: 10,
      bigBlind: 20,
      initialStack: 1000,
      actionTimeoutSeconds: 15,
    });

    game.addPlayer(new Player('p1', 'Player 1', 1000, 1));
    game.addPlayer(new Player('p2', 'Player 2', 1000, 2));
    game.startHand();
  });

  it('rejects actions when stage is complete', () => {
    (game as any).stage = 'complete';

    const result = game.handleAction('p1', 'check');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Hand is complete. Wait for next hand.');
  });

  it('does not expose action timer once hand is complete', () => {
    (game as any).stage = 'complete';
    (game as any).currentActionPlayerId = 'p1';
    (game as any).actionStartTime = Date.now() - 3000;

    expect(game.getRemainingActionTime()).toBe(0);
    expect(game.getRemainingReserveTime()).toBe(0);
    expect(game.hasActionTimedOut()).toBe(false);
  });
});
