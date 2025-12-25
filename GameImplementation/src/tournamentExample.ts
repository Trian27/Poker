import { Tournament, TournamentConfig } from './tournament/Tournament';
import { createStandardStructure, formatBlindStructure } from './tournament/BlindStructure';
import { Player } from './engine/Player';

/**
 * Example: Running a poker tournament with blind escalation
 * 
 * This demonstrates how to:
 * 1. Create a tournament with custom blind structure
 * 2. Register players
 * 3. Start the tournament
 * 4. Track blind levels automatically
 */

async function runExampleTournament() {
  console.log('🎰 POKER TOURNAMENT SYSTEM DEMO 🎰\n');

  // Step 1: Generate a blind structure
  const numberOfPlayers = 8;
  const startingStack = 10000;
  
  const structure = createStandardStructure(numberOfPlayers, startingStack);
  
  console.log(formatBlindStructure(structure));
  console.log('\nPress Enter to start registration...');
  
  // Wait for user input (in real implementation)
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Create tournament
  const tournamentConfig: TournamentConfig = {
    name: 'Friday Night Poker',
    structure,
    maxPlayers: numberOfPlayers,
    lateRegistrationLevels: 3 // Allow late reg for first 3 levels
  };

  const tournament = new Tournament(tournamentConfig);

  // Step 3: Register players
  console.log('\n📝 PLAYER REGISTRATION\n');
  
  const playerNames = [
    'Alice', 'Bob', 'Charlie', 'Diana',
    'Eve', 'Frank', 'Grace', 'Henry'
  ];

  for (const name of playerNames) {
    const player = new Player(`p${name}`, name, startingStack);
    const result = tournament.registerPlayer(player);
    
    if (result.success) {
      console.log(`✅ ${name} registered`);
    } else {
      console.log(`❌ ${name} failed: ${result.error}`);
    }
  }

  console.log(`\n📊 Total players: ${tournament.getTotalPlayerCount()}`);

  // Step 4: Start tournament
  console.log('\n🚀 STARTING TOURNAMENT\n');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const startResult = tournament.start();
  if (!startResult.success) {
    console.error(`Failed to start: ${startResult.error}`);
    return;
  }

  // Step 5: Monitor tournament progress
  console.log('\n▶️  TOURNAMENT IN PROGRESS\n');
  
  // Display tournament info
  setInterval(() => {
    const info = tournament.getInfo();
    
    console.clear();
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log(`║  ${info.name.padEnd(52)} ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  State: ${info.state.toUpperCase().padEnd(44)} ║`);
    console.log(`║  Level: ${info.currentLevel.toString().padEnd(44)} ║`);
    
    if (info.levelDetails) {
      const blindText = `${info.levelDetails.smallBlind}/${info.levelDetails.bigBlind}`;
      const anteText = info.levelDetails.ante > 0 ? ` (Ante: ${info.levelDetails.ante})` : '';
      console.log(`║  Blinds: ${(blindText + anteText).padEnd(43)} ║`);
    }
    
    console.log(`║  Players: ${info.activePlayers} / ${info.totalPlayers}${' '.repeat(37)} ║`);
    
    const minutes = Math.floor(info.timeRemaining / 60);
    const seconds = info.timeRemaining % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    console.log(`║  Time Remaining: ${timeStr.padEnd(35)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
  }, 1000);

  // Note: In a real implementation, you would:
  // - Integrate with the Game engine for actual hands
  // - Handle player eliminations when stack reaches 0
  // - Manage table assignments and rebalancing
  // - Persist tournament state
  // - Emit events for UI updates
}

/**
 * Example: Custom tournament structure
 */
function createCustomTournament() {
  const structure = {
    config: {
      startingStack: 15000,
      numberOfPlayers: 50,
      desiredDuration: 300, // 5 hours
      levelLength: 25,
      startingBigBlind: 100,
      anteStartLevel: 5,
      useBreaks: true,
      breakInterval: 5,
      breakDuration: 10
    },
    levels: [], // Will be generated
    totalLevels: 0,
    estimatedDuration: 0,
    multiplier: 0,
    totalChipsInPlay: 0,
    targetFinalBB: 0
  };

  console.log('Custom tournament structure created!');
  console.log(`Starting Stack: ${structure.config.startingStack}`);
  console.log(`Players: ${structure.config.numberOfPlayers}`);
  console.log(`Duration: ${structure.config.desiredDuration} minutes`);
}

/**
 * Example: Different tournament types
 */
function demonstrateTournamentTypes() {
  console.log('🏆 TOURNAMENT TYPE EXAMPLES 🏆\n');

  // Turbo tournament - Fast structure
  console.log('1️⃣  TURBO TOURNAMENT');
  console.log('   • Fast blind levels (5-10 minutes)');
  console.log('   • Quick action, shorter duration');
  console.log('   • Good for casual games\n');

  // Standard tournament
  console.log('2️⃣  STANDARD TOURNAMENT');
  console.log('   • Medium blind levels (15-20 minutes)');
  console.log('   • Balanced play');
  console.log('   • Most common format\n');

  // Deep stack tournament
  console.log('3️⃣  DEEP STACK TOURNAMENT');
  console.log('   • Long blind levels (30+ minutes)');
  console.log('   • More strategic play');
  console.log('   • Professional-style\n');

  // Sit & Go
  console.log('4️⃣  SIT & GO');
  console.log('   • Starts when full (typically 6-9 players)');
  console.log('   • Single table');
  console.log('   • Fast structure\n');

  // Multi-table tournament
  console.log('5️⃣  MULTI-TABLE TOURNAMENT (MTT)');
  console.log('   • Many players across multiple tables');
  console.log('   • Table balancing as players eliminated');
  console.log('   • Large prize pools\n');
}

// Export for use in other modules
export { runExampleTournament, createCustomTournament, demonstrateTournamentTypes };

// Run if executed directly
if (require.main === module) {
  console.log('Starting example tournament...\n');
  runExampleTournament().catch(console.error);
}
