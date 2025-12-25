import { 
  generateBlindStructure, 
  createFastStructure, 
  createStandardStructure,
  createDeepStackStructure,
  formatBlindStructure,
  BlindStructureConfig 
} from '../BlindStructure';

describe('BlindStructure', () => {
  describe('generateBlindStructure', () => {
    it('should generate a basic structure with correct number of levels', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      // 240 minutes / 20 minutes = 12 levels
      expect(structure.totalLevels).toBe(12);
      expect(structure.levels).toHaveLength(12);
    });

    it('should calculate correct total chips in play', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      expect(structure.totalChipsInPlay).toBe(200000); // 10000 * 20
    });

    it('should calculate target final BB as 7% of total chips by default', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      expect(structure.targetFinalBB).toBeCloseTo(14000, 0); // 200000 * 0.07
    });

    it('should use custom final BB percentage if provided', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100,
        finalBBPercentage: 0.05
      };

      const structure = generateBlindStructure(config);

      expect(structure.targetFinalBB).toBe(10000); // 200000 * 0.05
    });

    it('should have exponentially increasing blinds', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      // Each level should be larger than previous
      for (let i = 1; i < structure.levels.length; i++) {
        expect(structure.levels[i].bigBlind).toBeGreaterThan(
          structure.levels[i - 1].bigBlind
        );
      }
    });

    it('should start antes at configured level', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100,
        anteStartLevel: 4
      };

      const structure = generateBlindStructure(config);

      // Levels 1-3 should have no ante
      expect(structure.levels[0].ante).toBe(0);
      expect(structure.levels[1].ante).toBe(0);
      expect(structure.levels[2].ante).toBe(0);

      // Level 4 and beyond should have antes
      expect(structure.levels[3].ante).toBeGreaterThan(0);
      expect(structure.levels[4].ante).toBeGreaterThan(0);
    });

    it('should have SB equal to half of BB', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      for (const level of structure.levels) {
        // SB should be approximately half of BB (within rounding tolerance)
        const ratio = level.bigBlind / level.smallBlind;
        expect(ratio).toBeGreaterThanOrEqual(1.8);
        expect(ratio).toBeLessThanOrEqual(2.2);
      }
    });

    it('should round blinds to sensible denominations', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      // Check that all blinds are "round" numbers
      for (const level of structure.levels) {
        // Should be divisible by at least 5 or 10
        const bb = level.bigBlind;
        const sb = level.smallBlind;
        
        // All blinds should be divisible by 5 at minimum
        if (bb >= 100) {
          expect(bb % 5).toBe(0); // Should be divisible by 5 for larger values
        }
        if (sb >= 100) {
          expect(sb % 5).toBe(0); // Should be divisible by 5
        }
      }
    });

    it('should include breaks when configured', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100,
        useBreaks: true,
        breakInterval: 3,
        breakDuration: 10
      };

      const structure = generateBlindStructure(config);

      // Should have breaks every 3 levels
      const breaks = structure.levels.filter(l => l.level === 0);
      expect(breaks.length).toBeGreaterThan(0);

      // Check break duration
      for (const breakLevel of breaks) {
        expect(breakLevel.duration).toBe(10);
        expect(breakLevel.smallBlind).toBe(0);
        expect(breakLevel.bigBlind).toBe(0);
        expect(breakLevel.ante).toBe(0);
      }
    });

    it('should calculate correct estimated duration with breaks', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100,
        useBreaks: true,
        breakInterval: 6,
        breakDuration: 10
      };

      const structure = generateBlindStructure(config);

      // Calculate expected duration
      const totalDuration = structure.levels.reduce(
        (sum, level) => sum + level.duration, 
        0
      );

      expect(structure.estimatedDuration).toBe(totalDuration);
    });

    it('should have reasonable multiplier (typically 1.3 - 2.0)', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      expect(structure.multiplier).toBeGreaterThan(1.2);
      expect(structure.multiplier).toBeLessThan(2.5);
    });

    it('should reach near target final BB', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 240,
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);

      const finalBB = structure.levels[structure.levels.length - 1].bigBlind;
      const target = structure.targetFinalBB;

      // Final BB should be within 50% of target (rounding causes variance)
      expect(finalBB).toBeGreaterThan(target * 0.5);
      expect(finalBB).toBeLessThan(target * 2);
    });
  });

  describe('preset structures', () => {
    it('should create fast structure', () => {
      const structure = createFastStructure(20, 1500);

      expect(structure.config.desiredDuration).toBe(120); // 2 hours
      expect(structure.config.levelLength).toBe(10); // 10 minutes
      expect(structure.config.startingStack).toBe(1500);
    });

    it('should create standard structure', () => {
      const structure = createStandardStructure(20, 10000);

      expect(structure.config.desiredDuration).toBe(240); // 4 hours
      expect(structure.config.levelLength).toBe(20); // 20 minutes
      expect(structure.config.startingStack).toBe(10000);
      expect(structure.config.useBreaks).toBe(true);
    });

    it('should create deep stack structure', () => {
      const structure = createDeepStackStructure(20, 20000);

      expect(structure.config.desiredDuration).toBe(360); // 6 hours
      expect(structure.config.levelLength).toBe(30); // 30 minutes
      expect(structure.config.startingStack).toBe(20000);
      expect(structure.config.useBreaks).toBe(true);
    });
  });

  describe('formatBlindStructure', () => {
    it('should format structure as readable table', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 20,
        desiredDuration: 120, // Shorter for testing
        levelLength: 20,
        startingBigBlind: 100
      };

      const structure = generateBlindStructure(config);
      const formatted = formatBlindStructure(structure);

      // Should contain table borders
      expect(formatted).toContain('╔');
      expect(formatted).toContain('╠');
      expect(formatted).toContain('║');
      
      // Should contain key info
      expect(formatted).toContain('10,000'); // Starting stack
      expect(formatted).toContain('20'); // Number of players
      expect(formatted).toContain('Level');
      expect(formatted).toContain('SB');
      expect(formatted).toContain('BB');
      expect(formatted).toContain('Ante');
    });
  });

  describe('edge cases', () => {
    it('should handle minimum number of levels', () => {
      const config: BlindStructureConfig = {
        startingStack: 1000,
        numberOfPlayers: 10,
        desiredDuration: 60, // Very short
        levelLength: 20,
        startingBigBlind: 50
      };

      const structure = generateBlindStructure(config);

      // Should have at least 5 levels
      expect(structure.totalLevels).toBeGreaterThanOrEqual(5);
    });

    it('should handle very large tournaments', () => {
      const config: BlindStructureConfig = {
        startingStack: 50000,
        numberOfPlayers: 1000,
        desiredDuration: 600, // 10 hours
        levelLength: 60,
        startingBigBlind: 250
      };

      const structure = generateBlindStructure(config);

      expect(structure.totalChipsInPlay).toBe(50000000);
      expect(structure.totalLevels).toBeGreaterThan(0);
    });

    it('should handle heads-up tournament', () => {
      const config: BlindStructureConfig = {
        startingStack: 10000,
        numberOfPlayers: 2,
        desiredDuration: 120,
        levelLength: 15,
        startingBigBlind: 50
      };

      const structure = generateBlindStructure(config);

      expect(structure.totalChipsInPlay).toBe(20000);
      expect(structure.totalLevels).toBeGreaterThan(0);
    });
  });
});
