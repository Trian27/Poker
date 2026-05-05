using Xunit;

[Collection("g5-runtime")]
public sealed class G5RuntimeHostIntegrationTests
{
    private readonly G5RuntimeHostFixture _fixture;

    public G5RuntimeHostIntegrationTests(G5RuntimeHostFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public void Health_IsReadyForBothProfiles()
    {
        var health = _fixture.Host.GetHealthResponse();
        Assert.True(health.Ready);
        Assert.True(health.Profiles.TryGetValue("heads_up", out var headsUp) && headsUp.Ready);
        Assert.True(health.Profiles.TryGetValue("six_max", out var sixMax) && sixMax.Ready);
    }

    [Fact]
    public void HeadsUp_FlopCheck_ReplaySnapshotsMatch()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateHeadsUpFlopCheckRequest());

        Assert.Equal("g5", result.Response.Engine);
        Assert.Equal("heads_up", result.Response.Debug?.TableProfile);
        Assert.Equal("flop", result.Response.Debug?.TargetStreet);
        AssertSnapshotSequence(
            result.Snapshots,
            new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }));
    }

    [Theory]
    [InlineData("flop")]
    [InlineData("turn")]
    [InlineData("river")]
    public void HeadsUp_CallPaths_ReplaySnapshotsMatch(string street)
    {
        var result = _fixture.Host.AnalyzeForTesting(street switch
        {
            "flop" => CreateHeadsUpFlopCallRequest(),
            "turn" => CreateHeadsUpTurnCallRequest(),
            "river" => CreateHeadsUpRiverCallRequest(),
            _ => throw new InvalidOperationException($"Unsupported test street {street}"),
        });

        Assert.Equal("heads_up", result.Response.Debug?.TableProfile);
        Assert.Equal(street, result.Response.Debug?.TargetStreet);

        var expected = street switch
        {
            "flop" => new[]
            {
                new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:5:bet", "flop", 300, 100, 0, 2, 2, new[] { 100, 200 }, new[] { 9900, 9800 }),
            },
            "turn" => new[]
            {
                new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:5:check", "flop", 200, 0, 0, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:6:check", "flop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:turn", "turn", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:7:bet", "turn", 350, 150, 0, 2, 2, new[] { 100, 250 }, new[] { 9900, 9750 }),
            },
            "river" => new[]
            {
                new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:5:check", "flop", 200, 0, 0, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:6:check", "flop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:turn", "turn", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:7:check", "turn", 200, 0, 0, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:8:check", "turn", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("transition:river", "river", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
                new ExpectedSnapshot("action:9:bet", "river", 400, 200, 0, 2, 2, new[] { 100, 300 }, new[] { 9900, 9700 }),
            },
            _ => throw new InvalidOperationException($"Unsupported test street {street}"),
        };

        AssertSnapshotSequence(result.Snapshots, expected);
    }

    [Fact]
    public void HeadsUp_BetPath_ReplaySnapshotsMatch()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateHeadsUpBetPathRequest());

        Assert.Equal("heads_up", result.Response.Debug?.TableProfile);
        AssertSnapshotSequence(
            result.Snapshots,
            new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("action:5:bet", "flop", 320, 120, 0, 2, 2, new[] { 100, 220 }, new[] { 9900, 9780 }),
            new ExpectedSnapshot("action:6:call", "flop", 440, 0, -1, 2, 2, new[] { 220, 220 }, new[] { 9780, 9780 }),
            new ExpectedSnapshot("transition:turn", "turn", 440, 0, 1, 2, 2, new[] { 220, 220 }, new[] { 9780, 9780 }));
    }

    [Fact]
    public void HeadsUp_RaisePath_ReplaySnapshotsMatch()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateHeadsUpRaisePathRequest());

        Assert.Equal("heads_up", result.Response.Debug?.TableProfile);
        AssertSnapshotSequence(
            result.Snapshots,
            new ExpectedSnapshot("action:3:call", "preflop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("action:4:check", "preflop", 200, 0, -1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("transition:flop", "flop", 200, 0, 1, 2, 2, new[] { 100, 100 }, new[] { 9900, 9900 }),
            new ExpectedSnapshot("action:5:bet", "flop", 300, 100, 0, 2, 2, new[] { 100, 200 }, new[] { 9900, 9800 }),
            new ExpectedSnapshot("action:6:raise", "flop", 600, 200, 1, 2, 2, new[] { 400, 200 }, new[] { 9600, 9800 }),
            new ExpectedSnapshot("action:7:call", "flop", 800, 0, -1, 2, 2, new[] { 400, 400 }, new[] { 9600, 9600 }),
            new ExpectedSnapshot("transition:turn", "turn", 800, 0, 1, 2, 2, new[] { 400, 400 }, new[] { 9600, 9600 }),
            new ExpectedSnapshot("action:8:check", "turn", 800, 0, 0, 2, 2, new[] { 400, 400 }, new[] { 9600, 9600 }));
    }

    [Fact]
    public void ThreePlayer_ShortAllInCall_UsesSixMaxAndPreservesStackState()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateThreePlayerShortAllInCallRequest());

        Assert.Equal("six_max", result.Response.Debug?.TableProfile);
        Assert.Equal(3, result.Response.Debug?.SeatedPlayerCount);
        Assert.Contains(result.Snapshots, snapshot => snapshot.Label == "action:7:all-in" && snapshot.StackByPlayer[2] == 0);
        AssertSnapshotSequence(
            result.Snapshots,
            new ExpectedSnapshot("action:3:call", "preflop", 250, 50, 1, 3, 3, new[] { 100, 50, 100 }, new[] { 9900, 9950, 80 }),
            new ExpectedSnapshot("action:4:call", "preflop", 300, 0, 2, 3, 3, new[] { 100, 100, 100 }, new[] { 9900, 9900, 80 }),
            new ExpectedSnapshot("action:5:check", "preflop", 300, 0, -1, 3, 3, new[] { 100, 100, 100 }, new[] { 9900, 9900, 80 }),
            new ExpectedSnapshot("transition:flop", "flop", 300, 0, 1, 3, 3, new[] { 100, 100, 100 }, new[] { 9900, 9900, 80 }),
            new ExpectedSnapshot("action:6:bet", "flop", 500, 80, 2, 3, 3, new[] { 100, 300, 100 }, new[] { 9900, 9700, 80 }),
            new ExpectedSnapshot("action:7:all-in", "flop", 580, 200, 0, 3, 2, new[] { 100, 300, 180 }, new[] { 9900, 9700, 0 }),
            new ExpectedSnapshot("action:8:call", "flop", 780, 0, -1, 3, 2, new[] { 300, 300, 180 }, new[] { 9700, 9700, 0 }),
            new ExpectedSnapshot("transition:turn", "turn", 780, 0, 1, 3, 2, new[] { 300, 300, 180 }, new[] { 9700, 9700, 0 }));
    }

    [Fact]
    public void SixMax_MultiwayFallback_AppearsOnlyWhenFiveOrMorePlayersRemainActive()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateSixMaxMultiwayFallbackRequest());

        Assert.Equal("six_max", result.Response.Debug?.TableProfile);
        Assert.Equal(6, result.Response.Debug?.ActivePlayers);
        Assert.Contains("multiway_postflop_fallback", result.Response.Warnings);
        AssertSnapshotSequence(
            result.Snapshots,
            new ExpectedSnapshot("action:3:call", "preflop", 250, 100, 4, 6, 6, new[] { 0, 50, 100, 100, 0, 0 }, new[] { 10000, 9950, 9900, 9900, 10000, 10000 }),
            new ExpectedSnapshot("action:4:call", "preflop", 350, 100, 5, 6, 6, new[] { 0, 50, 100, 100, 100, 0 }, new[] { 10000, 9950, 9900, 9900, 9900, 10000 }),
            new ExpectedSnapshot("action:5:call", "preflop", 450, 100, 0, 6, 6, new[] { 0, 50, 100, 100, 100, 100 }, new[] { 10000, 9950, 9900, 9900, 9900, 9900 }),
            new ExpectedSnapshot("action:6:call", "preflop", 550, 50, 1, 6, 6, new[] { 100, 50, 100, 100, 100, 100 }, new[] { 9900, 9950, 9900, 9900, 9900, 9900 }),
            new ExpectedSnapshot("action:7:call", "preflop", 600, 0, 2, 6, 6, new[] { 100, 100, 100, 100, 100, 100 }, new[] { 9900, 9900, 9900, 9900, 9900, 9900 }),
            new ExpectedSnapshot("action:8:check", "preflop", 600, 0, -1, 6, 6, new[] { 100, 100, 100, 100, 100, 100 }, new[] { 9900, 9900, 9900, 9900, 9900, 9900 }),
            new ExpectedSnapshot("transition:flop", "flop", 600, 0, 1, 6, 6, new[] { 100, 100, 100, 100, 100, 100 }, new[] { 9900, 9900, 9900, 9900, 9900, 9900 }));
    }

    [Fact]
    public void SixMax_TwoActivePlayersStillUsesSixMaxProfile()
    {
        var result = _fixture.Host.AnalyzeForTesting(CreateSixMaxHeadsUpByFlopRequest());

        Assert.Equal("six_max", result.Response.Debug?.TableProfile);
        Assert.Equal(6, result.Response.Debug?.SeatedPlayerCount);
        Assert.Equal(2, result.Response.Debug?.ActivePlayers);
    }

    [Fact]
    public void TransitionBeforeRoundComplete_Fails()
    {
        var ex = Assert.Throws<ServiceApiException>(() => _fixture.Host.AnalyzeForTesting(CreateIncompleteFlopRoundRequest()));
        Assert.Equal("stage_transition_before_round_complete", ex.ErrorCode);
    }

    private static void AssertSnapshotSequence(IReadOnlyList<ReplayStateSnapshot> actual, params ExpectedSnapshot[] expected)
    {
        Assert.Equal(expected.Length, actual.Count);
        for (var index = 0; index < expected.Length; index += 1)
        {
            AssertSnapshot(actual[index], expected[index]);
        }
    }

    private static void AssertSnapshot(ReplayStateSnapshot actual, ExpectedSnapshot expected)
    {
        Assert.Equal(expected.Label, actual.Label);
        Assert.Equal(expected.Street, actual.Street);
        Assert.Equal(expected.PotSize, actual.PotSize);
        Assert.Equal(expected.AmountToCall, actual.AmountToCall);
        Assert.Equal(expected.PlayerToActIndex, actual.PlayerToActIndex);
        Assert.Equal(expected.ActivePlayers, actual.ActivePlayers);
        Assert.Equal(expected.ActiveNonAllInPlayers, actual.ActiveNonAllInPlayers);
        Assert.Equal(expected.MoneyInPotByPlayer, actual.MoneyInPotByPlayer);
        Assert.Equal(expected.StackByPlayer, actual.StackByPlayer);
    }

    private static AnalyzeDecisionRequest CreateHeadsUpFlopCheckRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 5,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "villain",
                SmallBlindPlayerId = "villain",
                BigBlindPlayerId = "hero",
                Players = new List<PlayerSnapshot>
                {
                    Player("villain", 1, 1),
                    Player("hero", 2, 2, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                },
                StartingStacks = Stacks(("villain", 10000), ("hero", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "villain", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "hero", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "villain", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateHeadsUpFlopCallRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 6,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "hero",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "villain",
                Players = new List<PlayerSnapshot>
                {
                    Player("hero", 1, 1, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                    Player("villain", 2, 2),
                },
                StartingStacks = Stacks(("hero", 10000), ("villain", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "villain", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "villain", "bet", requestedAmount: 100, committedChips: 100, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 200, playerStackBefore: 9900, playerStackAfter: 9800),
                    Entry(6, "flop", "hero", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 100, playerBetAfter: 200, playerStackBefore: 9900, playerStackAfter: 9800),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateHeadsUpTurnCallRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 8,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "hero",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "villain",
                Players = new List<PlayerSnapshot>
                {
                    Player("hero", 1, 1, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                    Player("villain", 2, 2),
                },
                StartingStacks = Stacks(("hero", 10000), ("villain", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "villain", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(6, "flop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(7, "turn", "villain", "bet", requestedAmount: 150, committedChips: 150, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 250, playerStackBefore: 9900, playerStackAfter: 9750),
                    Entry(8, "turn", "hero", "call", requestedAmount: 150, committedChips: 150, toCallBefore: 150, playerBetBefore: 100, playerBetAfter: 250, playerStackBefore: 9900, playerStackAfter: 9750),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateHeadsUpRiverCallRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 10,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts"), ("K", "clubs")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "hero",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "villain",
                Players = new List<PlayerSnapshot>
                {
                    Player("hero", 1, 1, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                    Player("villain", 2, 2),
                },
                StartingStacks = Stacks(("hero", 10000), ("villain", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "villain", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(6, "flop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(7, "turn", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(8, "turn", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(9, "river", "villain", "bet", requestedAmount: 200, committedChips: 200, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 300, playerStackBefore: 9900, playerStackAfter: 9700),
                    Entry(10, "river", "hero", "call", requestedAmount: 200, committedChips: 200, toCallBefore: 200, playerBetBefore: 100, playerBetAfter: 300, playerStackBefore: 9900, playerStackAfter: 9700),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateHeadsUpBetPathRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 7,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "villain",
                SmallBlindPlayerId = "villain",
                BigBlindPlayerId = "hero",
                Players = new List<PlayerSnapshot>
                {
                    Player("villain", 1, 1),
                    Player("hero", 2, 2, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                },
                StartingStacks = Stacks(("villain", 10000), ("hero", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "villain", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "hero", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "villain", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "hero", "bet", requestedAmount: 120, committedChips: 120, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 220, playerStackBefore: 9900, playerStackAfter: 9780),
                    Entry(6, "flop", "villain", "call", requestedAmount: 120, committedChips: 120, toCallBefore: 120, playerBetBefore: 100, playerBetAfter: 220, playerStackBefore: 9900, playerStackAfter: 9780),
                    Entry(7, "turn", "hero", "check", toCallBefore: 0, playerBetBefore: 220, playerBetAfter: 220, playerStackBefore: 9780, playerStackAfter: 9780),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateHeadsUpRaisePathRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 9,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "hero",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "villain",
                Players = new List<PlayerSnapshot>
                {
                    Player("hero", 1, 1, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                    Player("villain", 2, 2),
                },
                StartingStacks = Stacks(("hero", 10000), ("villain", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "villain", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "villain", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "villain", "bet", requestedAmount: 100, committedChips: 100, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 200, playerStackBefore: 9900, playerStackAfter: 9800),
                    Entry(6, "flop", "hero", "raise", requestedAmount: 300, committedChips: 300, toCallBefore: 100, playerBetBefore: 100, playerBetAfter: 400, playerStackBefore: 9900, playerStackAfter: 9600),
                    Entry(7, "flop", "villain", "call", requestedAmount: 200, committedChips: 200, toCallBefore: 200, playerBetBefore: 200, playerBetAfter: 400, playerStackBefore: 9800, playerStackAfter: 9600),
                    Entry(8, "turn", "villain", "check", toCallBefore: 0, playerBetBefore: 400, playerBetAfter: 400, playerStackBefore: 9600, playerStackAfter: 9600),
                    Entry(9, "turn", "hero", "check", toCallBefore: 0, playerBetBefore: 400, playerBetAfter: 400, playerStackBefore: 9600, playerStackAfter: 9600),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateThreePlayerShortAllInCallRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 9,
            HandData = new HandData
            {
                CommunityCards = Cards(("Q", "hearts"), ("8", "clubs"), ("3", "spades"), ("2", "diamonds")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "button",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "shorty",
                Players = new List<PlayerSnapshot>
                {
                    Player("button", 1, 1),
                    Player("hero", 2, 2, holeCards: HoleCards(("A", "spades"), ("K", "diamonds"))),
                    Player("shorty", 3, 3),
                },
                StartingStacks = Stacks(("button", 10000), ("hero", 10000), ("shorty", 180)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "shorty", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 180, playerStackAfter: 80),
                    Entry(3, "preflop", "button", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(4, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(5, "preflop", "shorty", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 80, playerStackAfter: 80),
                    Entry(6, "flop", "hero", "bet", requestedAmount: 200, committedChips: 200, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 300, playerStackBefore: 9900, playerStackAfter: 9700),
                    Entry(7, "flop", "shorty", "all-in", requestedAmount: 80, committedChips: 80, toCallBefore: 200, playerBetBefore: 100, playerBetAfter: 180, playerStackBefore: 80, playerStackAfter: 0),
                    Entry(8, "flop", "button", "call", requestedAmount: 200, committedChips: 200, toCallBefore: 200, playerBetBefore: 100, playerBetAfter: 300, playerStackBefore: 9900, playerStackAfter: 9700),
                    Entry(9, "turn", "hero", "check", toCallBefore: 0, playerBetBefore: 300, playerBetAfter: 300, playerStackBefore: 9700, playerStackAfter: 9700),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateSixMaxMultiwayFallbackRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 9,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "button",
                SmallBlindPlayerId = "hero",
                BigBlindPlayerId = "bb",
                Players = new List<PlayerSnapshot>
                {
                    Player("button", 1, 1),
                    Player("hero", 2, 2, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                    Player("bb", 3, 3),
                    Player("utg", 4, 4),
                    Player("hj", 5, 5),
                    Player("co", 6, 6),
                },
                StartingStacks = Stacks(("button", 10000), ("hero", 10000), ("bb", 10000), ("utg", 10000), ("hj", 10000), ("co", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "hero", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "bb", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "utg", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(4, "preflop", "hj", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(5, "preflop", "co", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(6, "preflop", "button", "call", requestedAmount: 100, committedChips: 100, toCallBefore: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(7, "preflop", "hero", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(8, "preflop", "bb", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(9, "flop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateSixMaxHeadsUpByFlopRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "sb",
            DecisionSequence = 9,
            HandData = new HandData
            {
                CommunityCards = Cards(("Q", "hearts"), ("8", "clubs"), ("3", "spades")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "button",
                SmallBlindPlayerId = "sb",
                BigBlindPlayerId = "bb",
                Players = new List<PlayerSnapshot>
                {
                    Player("button", 1, 1),
                    Player("sb", 2, 2, holeCards: HoleCards(("A", "spades"), ("K", "diamonds"))),
                    Player("bb", 3, 3),
                    Player("utg", 4, 4),
                    Player("hj", 5, 5),
                    Player("co", 6, 6),
                },
                StartingStacks = Stacks(("button", 10000), ("sb", 10000), ("bb", 10000), ("utg", 10000), ("hj", 10000), ("co", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "sb", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "bb", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "utg", "fold", toCallBefore: 100, playerStackBefore: 10000, playerStackAfter: 10000),
                    Entry(4, "preflop", "hj", "fold", toCallBefore: 100, playerStackBefore: 10000, playerStackAfter: 10000),
                    Entry(5, "preflop", "co", "fold", toCallBefore: 100, playerStackBefore: 10000, playerStackAfter: 10000),
                    Entry(6, "preflop", "button", "fold", toCallBefore: 100, playerStackBefore: 10000, playerStackAfter: 10000),
                    Entry(7, "preflop", "sb", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(8, "preflop", "bb", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(9, "flop", "sb", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                },
            },
        };
    }

    private static AnalyzeDecisionRequest CreateIncompleteFlopRoundRequest()
    {
        return new AnalyzeDecisionRequest
        {
            HeroPlayerId = "hero",
            DecisionSequence = 6,
            HandData = new HandData
            {
                CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "villain",
                SmallBlindPlayerId = "villain",
                BigBlindPlayerId = "hero",
                Players = new List<PlayerSnapshot>
                {
                    Player("villain", 1, 1),
                    Player("hero", 2, 2, holeCards: HoleCards(("A", "hearts"), ("K", "diamonds"))),
                },
                StartingStacks = Stacks(("villain", 10000), ("hero", 10000)),
                ActionLog = new List<ActionLogEntry>
                {
                    Entry(1, "preflop", "villain", "small-blind", source: "forced", requestedAmount: 50, committedChips: 50, playerBetBefore: 0, playerBetAfter: 50, playerStackBefore: 10000, playerStackAfter: 9950),
                    Entry(2, "preflop", "hero", "big-blind", source: "forced", requestedAmount: 100, committedChips: 100, playerBetBefore: 0, playerBetAfter: 100, playerStackBefore: 10000, playerStackAfter: 9900),
                    Entry(3, "preflop", "villain", "call", requestedAmount: 50, committedChips: 50, toCallBefore: 50, playerBetBefore: 50, playerBetAfter: 100, playerStackBefore: 9950, playerStackAfter: 9900),
                    Entry(4, "preflop", "hero", "check", toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 100, playerStackBefore: 9900, playerStackAfter: 9900),
                    Entry(5, "flop", "hero", "bet", requestedAmount: 100, committedChips: 100, toCallBefore: 0, playerBetBefore: 100, playerBetAfter: 200, playerStackBefore: 9900, playerStackAfter: 9800),
                    Entry(6, "turn", "hero", "check", toCallBefore: 0, playerBetBefore: 200, playerBetAfter: 200, playerStackBefore: 9800, playerStackAfter: 9800),
                },
            },
        };
    }

    private static PlayerSnapshot Player(string playerId, int seatNumber, int userId, List<CardDto>? holeCards = null) => new()
    {
        PlayerId = playerId,
        Username = playerId,
        UserId = userId,
        SeatNumber = seatNumber,
        HoleCards = holeCards ?? new List<CardDto>(),
    };

    private static List<CardDto> HoleCards(params (string Rank, string Suit)[] cards) => Cards(cards);

    private static List<CardDto> Cards(params (string Rank, string Suit)[] cards)
    {
        return cards.Select(card => new CardDto { Rank = card.Rank, Suit = card.Suit }).ToList();
    }

    private static Dictionary<string, int> Stacks(params (string PlayerId, int Stack)[] values)
    {
        return values.ToDictionary(value => value.PlayerId, value => value.Stack, StringComparer.Ordinal);
    }

    private static ActionLogEntry Entry(
        int sequence,
        string stage,
        string playerId,
        string action,
        string source = "player",
        int? requestedAmount = null,
        int? committedChips = null,
        int? toCallBefore = null,
        int? playerBetBefore = null,
        int? playerBetAfter = null,
        int? playerStackBefore = null,
        int? playerStackAfter = null) => new()
        {
            Sequence = sequence,
            Stage = stage,
            PlayerId = playerId,
            Action = action,
            Source = source,
            RequestedAmount = requestedAmount,
            CommittedChips = committedChips,
            ToCallBefore = toCallBefore,
            PlayerBetBefore = playerBetBefore,
            PlayerBetAfter = playerBetAfter,
            PlayerStackBefore = playerStackBefore,
            PlayerStackAfter = playerStackAfter,
        };

    private sealed record ExpectedSnapshot(
        string Label,
        string Street,
        int PotSize,
        int AmountToCall,
        int PlayerToActIndex,
        int ActivePlayers,
        int ActiveNonAllInPlayers,
        int[] MoneyInPotByPlayer,
        int[] StackByPlayer);
}
