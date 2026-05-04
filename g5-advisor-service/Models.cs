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
    public int? UserId { get; init; }
    public string? Username { get; init; }
    public string Action { get; init; } = string.Empty;
    public string? Source { get; init; }
    public int? RequestedAmount { get; init; }
    public int? CommittedChips { get; init; }
    public int? ToCallBefore { get; init; }
    public int? MinimumRaiseBefore { get; init; }
    public int? PlayersInHandBefore { get; init; }
    public int? PotBefore { get; init; }
    public int? PotAfter { get; init; }
    public int? CurrentBetBefore { get; init; }
    public int? CurrentBetAfter { get; init; }
    public int? PlayerBetBefore { get; init; }
    public int? PlayerBetAfter { get; init; }
    public int? PlayerStackBefore { get; init; }
    public int? PlayerStackAfter { get; init; }
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
