using System.Text.Json.Serialization;

internal sealed class AnalyzeDecisionRequest
{
    public string HeroPlayerId { get; init; } = string.Empty;
    public int DecisionSequence { get; init; }
    public HandData HandData { get; init; } = new();
}

internal sealed class HandData
{
    public List<CardDto> CommunityCards { get; init; } = new();
    public List<PlayerSnapshot> Players { get; init; } = new();
    public BlindConfig Blinds { get; init; } = new();
    public string? DealerPlayerId { get; init; }
    public string? SmallBlindPlayerId { get; init; }
    public string? BigBlindPlayerId { get; init; }
    public Dictionary<string, int> StartingStacks { get; init; } = new(StringComparer.Ordinal);
    public List<ActionLogEntry> ActionLog { get; init; } = new();
}

internal sealed class CardDto
{
    public string Rank { get; init; } = string.Empty;
    public string Suit { get; init; } = string.Empty;
}

internal sealed class PlayerSnapshot
{
    public string PlayerId { get; init; } = string.Empty;
    public int? UserId { get; init; }
    public string Username { get; init; } = string.Empty;
    public int? SeatNumber { get; init; }
    public List<CardDto> HoleCards { get; init; } = new();
    public bool Folded { get; init; }
    public bool AllIn { get; init; }
}

internal sealed class BlindConfig
{
    public int SmallBlind { get; init; }
    public int BigBlind { get; init; }
}

internal sealed class ActionLogEntry
{
    public int Sequence { get; init; }
    public string Stage { get; init; } = string.Empty;
    public string PlayerId { get; init; } = string.Empty;

    [JsonPropertyName("playerId")]
    public string? PlayerIdCamel { get; init; }

    [JsonIgnore]
    public string EffectivePlayerId => !string.IsNullOrWhiteSpace(PlayerId) ? PlayerId : (PlayerIdCamel ?? string.Empty);

    public int? UserId { get; init; }

    [JsonPropertyName("userId")]
    public int? UserIdCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveUserId => UserId ?? UserIdCamel;

    public string? Username { get; init; }
    public string Action { get; init; } = string.Empty;
    public string? Source { get; init; }
    public int? RequestedAmount { get; init; }

    [JsonPropertyName("requestedAmount")]
    public int? RequestedAmountCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveRequestedAmount => RequestedAmount ?? RequestedAmountCamel;

    public int? CommittedChips { get; init; }

    [JsonPropertyName("committedChips")]
    public int? CommittedChipsCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveCommittedChips => CommittedChips ?? CommittedChipsCamel;

    public int? ToCallBefore { get; init; }

    [JsonPropertyName("toCallBefore")]
    public int? ToCallBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveToCallBefore => ToCallBefore ?? ToCallBeforeCamel;

    public int? MinimumRaiseBefore { get; init; }

    [JsonPropertyName("minimumRaiseBefore")]
    public int? MinimumRaiseBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveMinimumRaiseBefore => MinimumRaiseBefore ?? MinimumRaiseBeforeCamel;

    public int? PlayersInHandBefore { get; init; }

    [JsonPropertyName("playersInHandBefore")]
    public int? PlayersInHandBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePlayersInHandBefore => PlayersInHandBefore ?? PlayersInHandBeforeCamel;

    public int? PotBefore { get; init; }

    [JsonPropertyName("potBefore")]
    public int? PotBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePotBefore => PotBefore ?? PotBeforeCamel;

    public int? PotAfter { get; init; }

    [JsonPropertyName("potAfter")]
    public int? PotAfterCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePotAfter => PotAfter ?? PotAfterCamel;

    public int? CurrentBetBefore { get; init; }

    [JsonPropertyName("currentBetBefore")]
    public int? CurrentBetBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveCurrentBetBefore => CurrentBetBefore ?? CurrentBetBeforeCamel;

    public int? CurrentBetAfter { get; init; }

    [JsonPropertyName("currentBetAfter")]
    public int? CurrentBetAfterCamel { get; init; }

    [JsonIgnore]
    public int? EffectiveCurrentBetAfter => CurrentBetAfter ?? CurrentBetAfterCamel;

    public int? PlayerBetBefore { get; init; }

    [JsonPropertyName("playerBetBefore")]
    public int? PlayerBetBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePlayerBetBefore => PlayerBetBefore ?? PlayerBetBeforeCamel;

    public int? PlayerBetAfter { get; init; }

    [JsonPropertyName("playerBetAfter")]
    public int? PlayerBetAfterCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePlayerBetAfter => PlayerBetAfter ?? PlayerBetAfterCamel;

    public int? PlayerStackBefore { get; init; }

    [JsonPropertyName("playerStackBefore")]
    public int? PlayerStackBeforeCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePlayerStackBefore => PlayerStackBefore ?? PlayerStackBeforeCamel;

    public int? PlayerStackAfter { get; init; }

    [JsonPropertyName("playerStackAfter")]
    public int? PlayerStackAfterCamel { get; init; }

    [JsonIgnore]
    public int? EffectivePlayerStackAfter => PlayerStackAfter ?? PlayerStackAfterCamel;
}

internal sealed class AnalyzeDecisionResponse
{
    public string Engine { get; init; } = "g5";
    public int DecisionSequence { get; init; }
    public string? RecommendedAction { get; init; }
    public int? Amount { get; init; }
    public string RawActionType { get; init; } = string.Empty;
    public int RawByAmount { get; init; }
    public double CheckCallEv { get; init; }
    public double BetRaiseEv { get; init; }
    public double TimeSpentSeconds { get; init; }
    public string Message { get; init; } = string.Empty;
    public List<string> Warnings { get; init; } = new();
    public AnalyzeDecisionDebug? Debug { get; init; }
}

internal sealed class AnalyzeDecisionDebug
{
    public int ReplayedActionCount { get; init; }
    public string TargetStreet { get; init; } = string.Empty;
    public int ActivePlayers { get; init; }
    public int G5PlayerToActIndex { get; init; }
}

internal sealed class HealthResponse
{
    public string Service { get; init; } = "g5-advisor-service";
    public string Status { get; init; } = "unready";
    public bool Ready { get; init; }
    public string StartupStage { get; init; } = "not_started";
    public string? Error { get; init; }
    public string? BundleVersion { get; init; }
    public bool RuntimeLoaded { get; init; }
    public bool WarmModelReady { get; init; }
}

internal sealed class ErrorResponse
{
    public string Error { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    public string? StartupStage { get; init; }
}
