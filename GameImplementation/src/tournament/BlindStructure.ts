/**
 * Represents a single blind level in a tournament
 */
export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  duration: number; // Duration in minutes
}

/**
 * Configuration for generating a tournament blind structure
 */
export interface BlindStructureConfig {
  startingStack: number;        // Chips each player starts with
  numberOfPlayers: number;       // Total players in tournament
  desiredDuration: number;       // Tournament duration in minutes
  levelLength: number;           // Length of each level in minutes
  startingBigBlind: number;      // Big blind for level 1
  finalBBPercentage?: number;    // Final BB as % of total chips (default: 0.07)
  anteStartLevel?: number;       // Level to introduce antes (default: 4)
  anteBBRatio?: number;          // Ante as ratio of BB (default: 1.0 for BB ante)
  useBreaks?: boolean;           // Include breaks (default: false)
  breakInterval?: number;        // Levels between breaks (default: 6)
  breakDuration?: number;        // Break duration in minutes (default: 10)
}

/**
 * Complete tournament blind structure
 */
export interface BlindStructure {
  config: BlindStructureConfig;
  levels: BlindLevel[];
  totalLevels: number;
  estimatedDuration: number; // In minutes
  multiplier: number;
  totalChipsInPlay: number;
  targetFinalBB: number;
}

/**
 * Rounds a number to a sensible chip denomination
 * Examples: 155 → 150, 372 → 400, 1382 → 1500
 */
function roundToChipDenomination(value: number): number {
  if (value < 10) return Math.round(value);
  if (value < 50) return Math.round(value / 5) * 5;
  if (value < 100) return Math.round(value / 10) * 10;
  if (value < 500) return Math.round(value / 25) * 25;
  if (value < 1000) return Math.round(value / 50) * 50;
  if (value < 5000) return Math.round(value / 100) * 100;
  if (value < 10000) return Math.round(value / 500) * 500;
  return Math.round(value / 1000) * 1000;
}

/**
 * Generates a tournament blind structure using exponential growth
 * 
 * Algorithm:
 * 1. Calculate total chips in play
 * 2. Determine target final BB (5-7% of total chips)
 * 3. Calculate multiplier: (Final_BB / Starting_BB) ^ (1 / (levels - 1))
 * 4. Generate each level by multiplying previous BB by multiplier
 * 5. Round to sensible chip denominations
 * 6. Add antes starting at configured level
 * 
 * @param config Tournament configuration parameters
 * @returns Complete blind structure with all levels
 */
export function generateBlindStructure(config: BlindStructureConfig): BlindStructure {
  // Set defaults
  const finalBBPercentage = config.finalBBPercentage ?? 0.07;
  const anteStartLevel = config.anteStartLevel ?? 4;
  const anteBBRatio = config.anteBBRatio ?? 1.0;
  const useBreaks = config.useBreaks ?? false;
  const breakInterval = config.breakInterval ?? 6;
  const breakDuration = config.breakDuration ?? 10;

  // Step 1: Calculate total chips in play
  const totalChipsInPlay = config.startingStack * config.numberOfPlayers;

  // Step 2: Calculate target final big blind
  const targetFinalBB = totalChipsInPlay * finalBBPercentage;

  // Step 3: Calculate number of levels (accounting for breaks if enabled)
  let numberOfLevels = Math.floor(config.desiredDuration / config.levelLength);
  
  if (useBreaks) {
    // Subtract levels for breaks
    const numberOfBreaks = Math.floor(numberOfLevels / breakInterval);
    const breakTimeLevels = Math.ceil((numberOfBreaks * breakDuration) / config.levelLength);
    numberOfLevels -= breakTimeLevels;
  }

  // Ensure at least 5 levels
  numberOfLevels = Math.max(numberOfLevels, 5);

  // Step 4: Calculate the multiplier
  // Formula: (Final_BB / Starting_BB) ^ (1 / (levels - 1))
  const multiplier = Math.pow(
    targetFinalBB / config.startingBigBlind,
    1 / (numberOfLevels - 1)
  );

  // Step 5: Generate blind levels
  const levels: BlindLevel[] = [];
  let currentBB = config.startingBigBlind;
  let levelCounter = 1;

  for (let i = 0; i < numberOfLevels; i++) {
    // Round to sensible chip denomination
    const roundedBB = roundToChipDenomination(currentBB);
    const roundedSB = roundToChipDenomination(roundedBB / 2);
    
    // Calculate ante (starts at configured level)
    const ante = i + 1 >= anteStartLevel 
      ? roundToChipDenomination(roundedBB * anteBBRatio)
      : 0;

    levels.push({
      level: levelCounter++,
      smallBlind: roundedSB,
      bigBlind: roundedBB,
      ante: ante,
      duration: config.levelLength
    });

    // Add break if configured
    if (useBreaks && (i + 1) % breakInterval === 0 && i < numberOfLevels - 1) {
      levels.push({
        level: 0, // 0 indicates break
        smallBlind: 0,
        bigBlind: 0,
        ante: 0,
        duration: breakDuration
      });
    }

    // Calculate next level's BB
    currentBB = currentBB * multiplier;
  }

  // Calculate estimated duration including breaks
  const estimatedDuration = levels.reduce((sum, level) => sum + level.duration, 0);

  return {
    config,
    levels,
    totalLevels: numberOfLevels,
    estimatedDuration,
    multiplier,
    totalChipsInPlay,
    targetFinalBB
  };
}

/**
 * Creates a fast tournament structure (shorter levels, faster escalation)
 */
export function createFastStructure(
  numberOfPlayers: number,
  startingStack: number = 1500
): BlindStructure {
  return generateBlindStructure({
    startingStack,
    numberOfPlayers,
    desiredDuration: 120, // 2 hours
    levelLength: 10, // 10-minute levels
    startingBigBlind: startingStack / 150, // 10 for 1500 stack
    anteStartLevel: 3
  });
}

/**
 * Creates a standard tournament structure (balanced pace)
 */
export function createStandardStructure(
  numberOfPlayers: number,
  startingStack: number = 10000
): BlindStructure {
  return generateBlindStructure({
    startingStack,
    numberOfPlayers,
    desiredDuration: 240, // 4 hours
    levelLength: 20, // 20-minute levels
    startingBigBlind: startingStack / 100, // 100 for 10000 stack
    anteStartLevel: 4,
    useBreaks: true,
    breakInterval: 6,
    breakDuration: 10
  });
}

/**
 * Creates a deep-stack tournament structure (more play, slower pace)
 */
export function createDeepStackStructure(
  numberOfPlayers: number,
  startingStack: number = 20000
): BlindStructure {
  return generateBlindStructure({
    startingStack,
    numberOfPlayers,
    desiredDuration: 360, // 6 hours
    levelLength: 30, // 30-minute levels
    startingBigBlind: startingStack / 200, // 100 for 20000 stack
    anteStartLevel: 5,
    useBreaks: true,
    breakInterval: 4,
    breakDuration: 15
  });
}

/**
 * Pretty-prints a blind structure as a formatted table
 */
export function formatBlindStructure(structure: BlindStructure): string {
  let output = '╔════════════════════════════════════════════════════════════╗\n';
  output += '║           TOURNAMENT BLIND STRUCTURE                       ║\n';
  output += '╠════════════════════════════════════════════════════════════╣\n';
  output += `║ Starting Stack:    ${structure.config.startingStack.toLocaleString().padEnd(10)} ║ Players: ${structure.config.numberOfPlayers.toString().padEnd(8)}║\n`;
  output += `║ Total Chips:       ${structure.totalChipsInPlay.toLocaleString().padEnd(10)} ║ Duration: ${structure.estimatedDuration}min   ║\n`;
  output += `║ Target Final BB:   ${structure.targetFinalBB.toLocaleString().padEnd(10)} ║ Multiplier: ${structure.multiplier.toFixed(2).padEnd(5)}║\n`;
  output += '╠═══════╦═════════╦═════════╦═════════╦══════════════════════╣\n';
  output += '║ Level ║   SB    ║   BB    ║  Ante   ║ Duration             ║\n';
  output += '╠═══════╬═════════╬═════════╬═════════╬══════════════════════╣\n';

  for (const level of structure.levels) {
    if (level.level === 0) {
      // Break
      output += `║       ║         ║         ║         ║ BREAK (${level.duration} min)        ║\n`;
    } else {
      const levelStr = level.level.toString().padStart(5);
      const sbStr = level.smallBlind.toLocaleString().padStart(7);
      const bbStr = level.bigBlind.toLocaleString().padStart(7);
      const anteStr = level.ante > 0 ? level.ante.toLocaleString().padStart(7) : '   -   ';
      const durationStr = `${level.duration} min`.padEnd(20);
      output += `║ ${levelStr} ║ ${sbStr} ║ ${bbStr} ║ ${anteStr} ║ ${durationStr} ║\n`;
    }
  }

  output += '╚═══════╩═════════╩═════════╩═════════╩══════════════════════╝\n';
  
  return output;
}
