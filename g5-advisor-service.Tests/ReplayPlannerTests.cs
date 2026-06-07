using Xunit;

public sealed class ReplayPlannerTests
{
    [Fact]
    public void Build_FlopTarget_SkipsForcedBlindsAndTransitionsOnce()
    {
        var plan = G5ReplayPlanner.Build(new ReplayPlanningInput
        {
            ReplayEntries = new[]
            {
                Entry(1, "preflop", "villain", "small-blind", source: "forced"),
                Entry(2, "preflop", "hero", "big-blind", source: "forced"),
                Entry(3, "preflop", "villain", "call"),
                Entry(4, "preflop", "hero", "check"),
            },
            TargetEntry = Entry(5, "flop", "hero", "check"),
            CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds")),
        });

        Assert.Collection(
            plan.Steps,
            step => Assert.Equal(3, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step => Assert.Equal(4, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step =>
            {
                var transition = Assert.IsType<ReplayStreetTransitionStep>(step);
                Assert.Equal("preflop", transition.FromStreet);
                Assert.Equal("flop", transition.ToStreet);
                Assert.Equal(3, transition.Cards.Count);
            });
        Assert.Empty(plan.Warnings);
    }

    [Fact]
    public void Build_TurnTarget_AddsStreetTransitionBeforeHeroActs()
    {
        var plan = G5ReplayPlanner.Build(new ReplayPlanningInput
        {
            ReplayEntries = new[]
            {
                Entry(1, "preflop", "hero", "small-blind", source: "forced"),
                Entry(2, "preflop", "villain", "big-blind", source: "forced"),
                Entry(3, "preflop", "hero", "call"),
                Entry(4, "preflop", "villain", "check"),
                Entry(5, "flop", "villain", "check"),
                Entry(6, "flop", "hero", "check"),
            },
            TargetEntry = Entry(7, "turn", "hero", "check"),
            CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
        });

        Assert.Collection(
            plan.Steps,
            step => Assert.Equal(3, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step => Assert.Equal(4, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step => Assert.Equal("flop", Assert.IsType<ReplayStreetTransitionStep>(step).ToStreet),
            step => Assert.Equal(5, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step => Assert.Equal(6, Assert.IsType<ReplayActionStep>(step).Entry.Sequence),
            step => Assert.Equal("turn", Assert.IsType<ReplayStreetTransitionStep>(step).ToStreet));

        Assert.DoesNotContain(plan.Steps, step => step is ReplayActionStep actionStep && actionStep.Entry.Sequence == 7);
    }

    [Fact]
    public void Build_BackwardStage_ThrowsUnexpectedStageSequence()
    {
        var ex = Assert.Throws<ServiceApiException>(() => G5ReplayPlanner.Build(new ReplayPlanningInput
        {
            ReplayEntries = new[]
            {
                Entry(3, "flop", "villain", "check"),
                Entry(4, "preflop", "hero", "call"),
            },
            TargetEntry = Entry(5, "flop", "hero", "check"),
            CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds")),
        }));

        Assert.Equal("unexpected_stage_sequence", ex.ErrorCode);
    }

    [Fact]
    public void Build_MissingBoardCards_ThrowsInsufficientCommunityCards()
    {
        var ex = Assert.Throws<ServiceApiException>(() => G5ReplayPlanner.Build(new ReplayPlanningInput
        {
            ReplayEntries = new[]
            {
                Entry(1, "preflop", "hero", "small-blind", source: "forced"),
                Entry(2, "preflop", "villain", "big-blind", source: "forced"),
                Entry(3, "preflop", "hero", "call"),
                Entry(4, "preflop", "villain", "check"),
                Entry(5, "flop", "villain", "check"),
                Entry(6, "flop", "hero", "check"),
                Entry(7, "turn", "villain", "check"),
                Entry(8, "turn", "hero", "check"),
            },
            TargetEntry = Entry(9, "river", "hero", "check"),
            CommunityCards = Cards(("A", "spades"), ("7", "clubs"), ("2", "diamonds"), ("4", "hearts")),
        }));

        Assert.Equal("insufficient_community_cards", ex.ErrorCode);
    }

    [Fact]
    public void Build_TargetStreetWithFutureCards_EmitsTrimmedFutureBoardCards()
    {
        var plan = G5ReplayPlanner.Build(new ReplayPlanningInput
        {
            ReplayEntries = new[]
            {
                Entry(1, "preflop", "villain", "small-blind", source: "forced"),
                Entry(2, "preflop", "hero", "big-blind", source: "forced"),
                Entry(3, "preflop", "villain", "call"),
                Entry(4, "preflop", "hero", "check"),
            },
            TargetEntry = Entry(5, "flop", "hero", "check"),
            CommunityCards = Cards(
                ("A", "spades"),
                ("7", "clubs"),
                ("2", "diamonds"),
                ("4", "hearts"),
                ("K", "clubs")),
        });

        Assert.Contains("trimmed_future_board_cards", plan.Warnings);
    }

    private static ActionLogEntry Entry(int sequence, string stage, string playerId, string action, string source = "player") => new()
    {
        Sequence = sequence,
        Stage = stage,
        PlayerId = playerId,
        Action = action,
        Source = source,
    };

    private static List<CardDto> Cards(params (string Rank, string Suit)[] cards)
    {
        return cards.Select(card => new CardDto { Rank = card.Rank, Suit = card.Suit }).ToList();
    }
}
