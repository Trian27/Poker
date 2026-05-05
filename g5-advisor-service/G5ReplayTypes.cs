internal sealed record ReplayPlan(
    IReadOnlyList<ReplayPlanStep> Steps,
    IReadOnlyList<string> Warnings);

internal abstract record ReplayPlanStep(string Stage);

internal sealed record ReplayActionStep(ActionLogEntry Entry)
    : ReplayPlanStep(ReplayHelpers.NormalizeStage(Entry.Stage));

internal sealed record ReplayStreetTransitionStep(
    string FromStreet,
    string ToStreet,
    IReadOnlyList<CardDto> Cards)
    : ReplayPlanStep(ToStreet);

internal sealed record PreparedReplayRequest(
    PlayerSnapshot Hero,
    int HeroIndex,
    int ButtonIndex,
    int BigBlindSize,
    string[] PlayerNames,
    int[] StackSizes,
    IReadOnlyList<PlayerSnapshot> OrderedPlayers,
    IReadOnlyDictionary<string, int> PlayerIdToIndex,
    ReplayPlan ReplayPlan,
    ActionLogEntry TargetEntry,
    string[] HeroCards,
    List<string> Warnings,
    RuntimeTableProfile Profile,
    int SeatedPlayerCount,
    string TargetStreet,
    IReadOnlyList<ActionLogEntry> FutureEntries,
    bool HeadsUpButtonActsFirstPostflop);

internal sealed record ReplayStateSnapshot(
    string Label,
    string Street,
    int PotSize,
    int AmountToCall,
    int PlayerToActIndex,
    int ActivePlayers,
    int ActiveNonAllInPlayers,
    IReadOnlyList<int> MoneyInPotByPlayer,
    IReadOnlyList<int> StackByPlayer);

internal sealed record ReplayExecutionResult(
    int ReplayedActionCount,
    int PlayerToActIndex,
    int ActivePlayers,
    int ActiveNonAllInPlayers,
    IReadOnlyList<ReplayStateSnapshot> Snapshots);

internal sealed record AnalyzeForTestingResult(
    AnalyzeDecisionResponse Response,
    IReadOnlyList<ReplayStateSnapshot> Snapshots);

internal sealed record RuntimeTableProfile(
    string Profile,
    int PlayerCountMin,
    int PlayerCountMax,
    string TableType,
    string OpponentStatsFile,
    object TableTypeEnumValue);

internal sealed record TableProfileDefinition(
    string Profile,
    int PlayerCountMin,
    int PlayerCountMax,
    string TableType,
    string OpponentStatsFile);

internal sealed record RuntimeManifest(string BundleVersion, IReadOnlyList<TableProfileDefinition> TableProfiles);
