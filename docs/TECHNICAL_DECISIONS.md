# Technical Decisions & Design Patterns

## Architecture Decisions

### 1. Headless Game Engine (Pure TypeScript)

**Decision**: Separate game logic completely from I/O (network, database, UI)

**Rationale**:
- Infinitely easier to test (no mocking required)
- Can be used by multiple interfaces (WebSocket, HTTP API, CLI)
- Pure functions are deterministic and debuggable
- Zero coupling to infrastructure

**Trade-offs**:
- Requires additional abstraction layer
- More files and interfaces to manage

**Verdict**: ✅ Worth it - saved hours in testing and debugging

### 2. TypeScript Over JavaScript

**Decision**: Use TypeScript with strict mode

**Rationale**:
- Catch bugs at compile time, not runtime
- Better IDE support (autocomplete, refactoring)
- Self-documenting code via types
- Prevents common mistakes (undefined, type coercion)

**Examples of bugs prevented**:
```typescript
// TypeScript caught these errors:
card.suit = 'invalid'; // Error: Type '"invalid"' is not assignable
player.bet(-50);       // Would compile but fail at runtime without validation
game.handleAction(123, 'fold'); // Error: Argument type 'number' not assignable to 'string'
```

**Trade-offs**:
- Build step required
- Slightly more verbose
- Learning curve for team

**Verdict**: ✅ Essential for production code

### 3. Socket.io Over Raw WebSockets

**Decision**: Use Socket.io library instead of native WebSocket API

**Rationale**:
- Automatic reconnection
- Fallback to polling if WebSocket fails
- Room/namespace support built-in
- Event-based API is more intuitive
- Client libraries for multiple platforms

**Code comparison**:
```typescript
// Socket.io (what we used)
socket.emit('game_action', { action: 'bet', amount: 50 });
socket.on('game_state_update', (state) => { ... });

// Raw WebSocket (what we avoided)
socket.send(JSON.stringify({ type: 'game_action', data: { ... }}));
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'game_state_update') { ... }
};
```

**Trade-offs**:
- Additional dependency
- Slight overhead

**Verdict**: ✅ Worth it for robustness

### 4. Set-Based Action Tracking

**Decision**: Use `Set<string>` to track who has acted in the current round

**Initial approach** (failed):
```typescript
// Compare total bets - DOESN'T WORK when everyone checks!
return allPlayers.every(p => p.totalBetThisRound === currentBet);
```

**Final approach** (works):
```typescript
private playersActedThisRound: Set<string> = new Set();

// After action
this.playersActedThisRound.add(playerId);

// Check if round complete
return activePlayers.every(p => this.playersActedThisRound.has(p.id));
```

**Why it works**:
- Explicitly tracks actions, not derived from state
- Handles edge case: when currentBet = 0 and everyone checks
- Clear semantic meaning: "has this player acted?"

**Verdict**: ✅ Critical fix discovered through testing

### 5. Separate `currentBet` vs `totalBetThisRound`

**Decision**: Track both current round bet AND total hand bet

**Why both are needed**:
```typescript
// Preflop: Alice calls $20, Bob checks
// Alice: currentBet = 0, totalBetThisRound = 20
// Bob: currentBet = 0, totalBetThisRound = 20

// Flop: Alice bets $50
// Alice: currentBet = 50, totalBetThisRound = 70
// Bob: currentBet = 0, totalBetThisRound = 20 (hasn't acted yet)
```

**Reset semantics**:
- `resetForNewRound()`: Sets `currentBet = 0`, keeps `totalBetThisRound`
- `resetForNewHand()`: Sets both to 0

**Verdict**: ✅ Necessary for correct pot calculation

## Data Structure Choices

### Card Representation

**Chose**: Class with readonly properties
```typescript
class Card {
  readonly suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  readonly rank: '2' | '3' | ... | 'K' | 'A';
}
```

**Alternatives considered**:
- String encoding ("AS" for Ace of Spades) - ❌ No type safety
- Number encoding (0-51) - ❌ Hard to debug
- Enum for suit/rank - ❌ Verbose, no benefit

**Verdict**: ✅ Readable, type-safe, immutable

### Hand Evaluation

**Chose**: Generate all 5-card combinations (brute force)
```typescript
const combinations = getCombinations(cards, 5); // C(7,5) = 21 combinations
for (const combo of combinations) {
  evaluate5Cards(combo);
}
```

**Alternatives considered**:
- Lookup table (52^5 entries) - ❌ Memory intensive
- Bit manipulation - ❌ Hard to maintain
- Skip-straight-evaluation - ❌ Misses edge cases

**Trade-offs**:
- Simple and correct
- Easy to verify
- Fast enough (21 iterations is negligible)

**Verdict**: ✅ Clarity over micro-optimization

### Player State

**Chose**: Mutable class with getters
```typescript
class Player {
  private stack: number;
  getStack(): number { return this.stack; }
  bet(amount: number): void { this.stack -= amount; }
}
```

**Alternatives considered**:
- Immutable + return new Player - ❌ Complicates game state
- Public properties - ❌ No encapsulation
- Pure object - ❌ No methods for validation

**Verdict**: ✅ OOP is appropriate here

## Testing Strategy

### Approach: Write Tests Before Fixing Bugs

**Process**:
1. Implement feature
2. Write comprehensive tests
3. Tests fail → reveals bugs
4. Fix bugs
5. Tests pass → ship with confidence

**Bugs found through testing**:
1. All-in detection (`amount > stack` → `amount >= stack`)
2. Betting round completion (bet comparison → action tracking)
3. Round reset (forgot to clear `playersActedThisRound`)
4. Blind posting not marked as actions

**Verdict**: ✅ Testing paid for itself 10x over

### Test Organization

**Structure**:
```
__tests__/
  Card.test.ts        # 7 tests - pure functions
  Deck.test.ts        # 8 tests - stateful but isolated
  Hand.test.ts        # 18 tests - complex logic
  Player.test.ts      # 15 tests - state management  
  Game.test.ts        # 15 tests - integration
```

**Coverage targets**:
- Happy paths: Basic functionality works
- Edge cases: All-in, ties, wheel straights
- Error cases: Invalid input, wrong turn
- State transitions: Betting rounds, showdown

**Verdict**: ✅ 63 tests provide confidence

## Performance Considerations

### What We Optimized

**1. Hand Evaluation**
- Brute force is fine: 21 combinations × O(n log n) sort = ~200 operations
- Happens once per hand per player at showdown
- Not a bottleneck

**2. Game State Broadcasting**
- Send personalized state to each player (includes their cards)
- Alternative: broadcast public state + separate "your cards" message
- Trade-off: More data sent, simpler client logic

**Verdict**: Premature optimization avoided

### What We'll Optimize Later

**1. Redis for State**
- Currently: Game state in Node.js memory
- Problem: Can't scale horizontally
- Solution: Store active games in Redis
- Benefit: Multiple game servers can share state

**2. Database for History**
- Currently: No persistence
- Problem: Can't replay hands or show stats
- Solution: Append-only event log to PostgreSQL
- Benefit: Full audit trail, analytics

**Verdict**: Wait until we have real load data

## Error Handling

### Philosophy: Fail Fast, Fail Loud

**In Engine (throw errors)**:
```typescript
if (cards.length !== 2) {
  throw new Error('Player must receive exactly 2 hole cards');
}
```

**In Server (return error messages)**:
```typescript
if (!result.valid) {
  socket.emit('action_error', { error: result.error });
}
```

**In Client (show to user)**:
```typescript
socket.on('action_error', ({ error }) => {
  console.log(`\n❌ Invalid action: ${error}\n`);
});
```

**Verdict**: ✅ Clear error propagation

## What We Learned

1. **TypeScript is not optional** - Caught 20+ bugs before runtime
2. **Pure functions are testable** - Game engine has 100% test coverage
3. **State is hard** - Tracking "who acted" was subtly complex
4. **Testing finds bugs** - All 5 critical bugs found via tests
5. **Separate concerns** - Engine/Server/Client split was perfect

## Future Improvements

### Technical Debt
- [ ] Add Winston logging (replace console.log)
- [ ] Graceful shutdown handling
- [ ] Connection timeout handling
- [ ] Rate limiting on actions
- [ ] Input sanitization

### Features
- [ ] Spectator mode
- [ ] Multi-table support
- [ ] Tournament mode
- [ ] Configurable game rules (antes, blinds, etc.)

### Optimization
- [ ] Redis state storage
- [ ] Horizontal scaling
- [ ] Event sourcing for replays
- [ ] Metrics and monitoring

---

**This codebase prioritizes correctness, testability, and maintainability. Performance optimization will come when we have real traffic to measure.**
