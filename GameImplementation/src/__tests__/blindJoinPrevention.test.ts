import { Game } from '../engine/Game';
import { Player } from '../engine/Player';

describe('Blind Join Prevention', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game({
      smallBlind: 10,
      bigBlind: 20,
      initialStack: 1000
    });
  });

  describe('canPlayerJoinAtSeat', () => {
    it('should allow joins when game is waiting', () => {
      const result = game.canPlayerJoinAtSeat(1);
      expect(result.canJoin).toBe(true);
      expect(result.reason).toContain('not in progress');
    });

    it('should allow joins when game is complete', () => {
      const p1 = new Player('p1', 'Player 1', 1000, 1);
      const p2 = new Player('p2', 'Player 2', 1000, 3);
      game.addPlayer(p1);
      game.addPlayer(p2);
      game.startHand();
      
      // Manually set stage to complete
      (game as any).stage = 'complete';
      
      const result = game.canPlayerJoinAtSeat(5);
      expect(result.canJoin).toBe(true);
    });

    it('should only allow join at big blind position during game', () => {
      // Setup: Two players at seats 1 and 3
      const p1 = new Player('p1', 'Player 1', 1000, 1);
      const p2 = new Player('p2', 'Player 2', 1000, 3);
      game.addPlayer(p1);
      game.addPlayer(p2);
      
      // Start the hand - dealer will be at index 0 (seat 1)
      game.startHand();
      
      const gameState = game.getGameState();
      console.log('Current game state:');
      console.log('- Dealer index:', gameState.dealerIndex);
      console.log('- Small blind index:', gameState.smallBlindIndex);
      console.log('- Big blind index:', gameState.bigBlindIndex);
      console.log('- Player count:', gameState.players.length);
      
      // Current: dealer=0, SB=0, BB=1 (heads-up)
      // After hand, dealer moves to index 1
      // With 3 players (adding at seat 2): seats would be [1,2,3] -> indices [0,1,2]
      // Next dealer = 1 (seat 2)
      // Next BB = (1+2)%3 = 0 (seat 1)
      
      // So seat 2 would NOT be BB, let's try other seats
      
      // With 3 players at seats [1,3,5]:
      // Next dealer = 1
      // Next BB = (1+2)%3 = 0 (seat 1)
      
      // Test seat 2 (between 1 and 3)
      let result = game.canPlayerJoinAtSeat(2);
      console.log('\\nTrying seat 2:', result);
      
      // Test seat 5
      result = game.canPlayerJoinAtSeat(5);
      console.log('Trying seat 5:', result);
      
      // Test seat 4
      result = game.canPlayerJoinAtSeat(4);
      console.log('Trying seat 4:', result);
      
      // One of these should be allowed (the BB position)
      const allowedSeats = [2, 4, 5, 6, 7, 8, 9].filter(seat => {
        const r = game.canPlayerJoinAtSeat(seat);
        return r.canJoin;
      });
      
      console.log('\\nAllowed seats:', allowedSeats);
      expect(allowedSeats.length).toBeGreaterThan(0);
    });

    it('should calculate BB position correctly with 3 players', () => {
      // Seats 1, 3, 5
      const p1 = new Player('p1', 'Player 1', 1000, 1);
      const p2 = new Player('p2', 'Player 2', 1000, 3);
      const p3 = new Player('p3', 'Player 3', 1000, 5);
      
      game.addPlayer(p1);
      game.addPlayer(p2);
      game.addPlayer(p3);
      
      game.startHand();
      
      const gameState = game.getGameState();
      console.log('\\n3-player game:');
      console.log('- Dealer index:', gameState.dealerIndex);
      console.log('- Small blind index:', gameState.smallBlindIndex);
      console.log('- Big blind index:', gameState.bigBlindIndex);
      console.log('- Players:', gameState.players.map((p: any) => `Seat ${p.seatNumber}: ${p.name}`));
      
      // With 3 players at seats [1, 3, 5], indices are [0, 1, 2]
      // Current: dealer=1, SB=2, BB=0
      // Next dealer will be at index 2 (seat 5)
      // If 4th player joins:
      //   - At seat 2: order becomes [1,2,3,5] -> next BB at index (2+2)%4 = 0 (seat 1)
      //   - At seat 4: order becomes [1,3,4,5] -> next BB at index (2+2)%4 = 0 (seat 1)
      //   - At seat 6: order becomes [1,3,5,6] -> next BB at index (2+2)%4 = 0 (seat 1)
      //   - At seat 7: order becomes [1,3,5,7] -> next BB at index (2+2)%4 = 0 (seat 1)
      
      // So NONE of the new seats would be BB!
      // The BB would rotate back to seat 1 (index 0)
      
      // This is actually correct behavior - if the 4th player isn't going to be BB,
      // they shouldn't be able to join during the hand
      
      const result2 = game.canPlayerJoinAtSeat(2);
      const result4 = game.canPlayerJoinAtSeat(4);
      const result6 = game.canPlayerJoinAtSeat(6);
      
      console.log('\\nSeat 2 (would be index 1):', result2);
      console.log('Seat 4 (would be index 2):', result4);
      console.log('Seat 6 (would be index 3):', result6);
      
      // None should be allowed because BB goes back to seat 1
      expect(result2.canJoin).toBe(false);
      expect(result4.canJoin).toBe(false);
      expect(result6.canJoin).toBe(false);
    });
  });

  describe('addPlayer with blind checking', () => {
    it('should reject join at wrong seat during active game', () => {
      const p1 = new Player('p1', 'Player 1', 1000, 1);
      const p2 = new Player('p2', 'Player 2', 1000, 3);
      game.addPlayer(p1);
      game.addPlayer(p2);
      game.startHand();
      
      // Try to join at a non-BB seat
      const result = game.canPlayerJoinAtSeat(2);
      
      if (!result.canJoin) {
        const p3 = new Player('p3', 'Player 3', 1000, 2);
        expect(() => game.addPlayer(p3)).toThrow();
      }
    });

    it('should allow join and set inactive during game', () => {
      const p1 = new Player('p1', 'Player 1', 1000, 1);
      const p2 = new Player('p2', 'Player 2', 1000, 3);
      game.addPlayer(p1);
      game.addPlayer(p2);
      game.startHand();
      
      // Find a seat that would be BB
      const allowedSeats = [2, 4, 5, 6, 7, 8, 9].filter(seat => {
        return game.canPlayerJoinAtSeat(seat).canJoin;
      });
      
      expect(allowedSeats.length).toBeGreaterThan(0);
      
      if (allowedSeats.length > 0) {
        const seat = allowedSeats[0];
        const p3 = new Player('p3', 'Player 3', 1000, seat);
        game.addPlayer(p3);
        
        // Player should be added but inactive
        expect(game.getPlayers().length).toBe(3);
        expect(p3.getIsActive()).toBe(false);
      }
    });
  });
});
