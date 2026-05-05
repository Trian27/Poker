internal sealed class ReplayPlanningInput
{
    public required IReadOnlyList<ActionLogEntry> ReplayEntries { get; init; }
    public required ActionLogEntry TargetEntry { get; init; }
    public required IReadOnlyList<CardDto> CommunityCards { get; init; }
}

internal static class G5ReplayPlanner
{
    public static ReplayPlan Build(ReplayPlanningInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(input.TargetEntry);

        var steps = new List<ReplayPlanStep>();
        var warnings = new HashSet<string>(StringComparer.Ordinal);

        var targetStreet = ReplayHelpers.NormalizeStage(input.TargetEntry.Stage);
        var targetStageIndex = ReplayHelpers.GetStageIndex(targetStreet);
        var currentStageIndex = ReplayHelpers.GetStageIndex("preflop");
        var targetVisibleBoardCount = ReplayHelpers.VisibleBoardCountForStreet(targetStreet);
        if (input.CommunityCards.Count > targetVisibleBoardCount)
        {
            warnings.Add("trimmed_future_board_cards");
        }

        var orderedReplayEntries = input.ReplayEntries
            .OrderBy(entry => entry.Sequence)
            .ToList();

        foreach (var entry in orderedReplayEntries)
        {
            var entryStreet = ReplayHelpers.NormalizeStage(entry.Stage);
            var entryStageIndex = ReplayHelpers.GetStageIndex(entryStreet);
            if (entryStageIndex < currentStageIndex)
            {
                throw new ServiceApiException(
                    StatusCodes.Status400BadRequest,
                    "unexpected_stage_sequence",
                    $"Replay stage moved backwards before sequence {entry.Sequence}: {entryStreet} after {ReplayHelpers.StageFromIndex(currentStageIndex)}");
            }

            while (currentStageIndex < entryStageIndex)
            {
                steps.Add(BuildStreetTransitionStep(currentStageIndex, input.CommunityCards));
                currentStageIndex += 1;
            }

            if (!ReplayHelpers.ShouldSkipForcedBlind(entry))
            {
                steps.Add(new ReplayActionStep(entry));
            }
        }

        while (currentStageIndex < targetStageIndex)
        {
            steps.Add(BuildStreetTransitionStep(currentStageIndex, input.CommunityCards));
            currentStageIndex += 1;
        }

        return new ReplayPlan(steps, warnings.ToList());
    }

    private static ReplayStreetTransitionStep BuildStreetTransitionStep(
        int currentStageIndex,
        IReadOnlyList<CardDto> communityCards)
    {
        var fromStreet = ReplayHelpers.StageFromIndex(currentStageIndex);
        var toStreet = ReplayHelpers.StageFromIndex(currentStageIndex + 1);

        IReadOnlyList<CardDto> cards = toStreet switch
        {
            "flop" => ReadBoardCards(communityCards, 0, 3, toStreet),
            "turn" => ReadBoardCards(communityCards, 3, 1, toStreet),
            "river" => ReadBoardCards(communityCards, 4, 1, toStreet),
            _ => throw new ServiceApiException(StatusCodes.Status400BadRequest, "unexpected_stage_sequence", $"Unsupported transition target street '{toStreet}'"),
        };

        return new ReplayStreetTransitionStep(fromStreet, toStreet, cards);
    }

    private static IReadOnlyList<CardDto> ReadBoardCards(
        IReadOnlyList<CardDto> communityCards,
        int startIndex,
        int count,
        string targetStreet)
    {
        if (communityCards.Count < startIndex + count)
        {
            throw new ServiceApiException(
                StatusCodes.Status400BadRequest,
                "insufficient_community_cards",
                $"Need {startIndex + count} community cards to reach {targetStreet}, but only found {communityCards.Count}.");
        }

        return communityCards.Skip(startIndex).Take(count).ToArray();
    }
}

internal static class ReplayHelpers
{
    private static readonly IReadOnlyDictionary<string, int> StageOrder = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["preflop"] = 0,
        ["flop"] = 1,
        ["turn"] = 2,
        ["river"] = 3,
    };

    public static string NormalizeStage(string stage)
    {
        var normalized = stage.Trim().ToLowerInvariant();
        if (!StageOrder.ContainsKey(normalized))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_stage", $"Unsupported stage '{stage}'");
        }

        return normalized;
    }

    public static int GetStageIndex(string stage)
    {
        return StageOrder[NormalizeStage(stage)];
    }

    public static int VisibleBoardCountForStreet(string stage)
    {
        return NormalizeStage(stage) switch
        {
            "preflop" => 0,
            "flop" => 3,
            "turn" => 4,
            "river" => 5,
            _ => throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_stage", $"Unsupported stage '{stage}'"),
        };
    }

    public static string StageFromIndex(int index)
    {
        return index switch
        {
            0 => "preflop",
            1 => "flop",
            2 => "turn",
            3 => "river",
            _ => throw new ServiceApiException(StatusCodes.Status400BadRequest, "unexpected_stage_sequence", $"Unsupported stage index {index}"),
        };
    }

    public static string NormalizeActionName(string action)
    {
        return action.Trim().ToLowerInvariant();
    }

    public static bool ShouldSkipForcedBlind(ActionLogEntry entry)
    {
        var action = NormalizeActionName(entry.Action);
        return string.Equals(NormalizeStage(entry.Stage), "preflop", StringComparison.Ordinal)
            && string.Equals(entry.Source?.Trim(), "forced", StringComparison.OrdinalIgnoreCase)
            && (action == "small-blind" || action == "big-blind");
    }

    public static string ToG5Card(CardDto card)
    {
        var rank = (card.Rank ?? string.Empty).Trim().ToUpperInvariant();
        rank = rank switch
        {
            "10" => "T",
            "2" or "3" or "4" or "5" or "6" or "7" or "8" or "9" or "T" or "J" or "Q" or "K" or "A" => rank,
            _ => throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_card_rank", $"Unsupported card rank '{card.Rank}'"),
        };

        var suit = (card.Suit ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "clubs" => "c",
            "diamonds" => "d",
            "hearts" => "h",
            "spades" => "s",
            _ => throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_card_suit", $"Unsupported card suit '{card.Suit}'"),
        };

        return $"{rank}{suit}";
    }
}
