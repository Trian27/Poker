using System.Globalization;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging;

internal sealed class G5RuntimeHost
{
    private const string ReadyStage = "ready";
    private readonly ILogger<G5RuntimeHost> _logger;
    private readonly G5AdvisorOptions _options;
    private readonly SemaphoreSlim _requestGate = new(1, 1);
    private readonly object _stateLock = new();

    private InitializationState _state = InitializationState.NotStarted();
    private Task? _initializationTask;

    private G5RuntimeLoadContext? _loadContext;
    private G5ReflectionBindings? _bindings;
    private object? _sharedOpponentModeling;
    private string? _runtimeDir;
    private string? _bundleVersion;

    public G5RuntimeHost(ILogger<G5RuntimeHost> logger, G5AdvisorOptions options)
    {
        _logger = logger;
        _options = options;
    }

    public void StartInitialization(CancellationToken stoppingToken)
    {
        lock (_stateLock)
        {
            _initializationTask ??= Task.Run(() => InitializeAsync(stoppingToken), CancellationToken.None);
        }
    }

    public HealthResponse GetHealthResponse()
    {
        lock (_stateLock)
        {
            return new HealthResponse
            {
                Status = _state.Ready ? "ready" : "unready",
                Ready = _state.Ready,
                StartupStage = _state.Stage,
                Error = _state.Error,
                BundleVersion = _bundleVersion,
                RuntimeLoaded = _state.RuntimeLoaded,
                WarmModelReady = _state.WarmModelReady,
            };
        }
    }

    public async Task<AnalyzeDecisionResponse> AnalyzeAsync(AnalyzeDecisionRequest request, CancellationToken cancellationToken)
    {
        EnsureReady();
        await _requestGate.WaitAsync(cancellationToken);
        try
        {
            EnsureReady();
            return AnalyzeCore(request);
        }
        finally
        {
            _requestGate.Release();
        }
    }

    private void EnsureReady()
    {
        lock (_stateLock)
        {
            if (_state.Ready)
            {
                return;
            }

            throw new ServiceApiException(
                StatusCodes.Status503ServiceUnavailable,
                "runtime_unready",
                _state.Error is not null
                    ? $"G5 runtime is not ready. Stage: {_state.Stage}. Error: {_state.Error}"
                    : $"G5 runtime is not ready. Stage: {_state.Stage}");
        }
    }

    private async Task InitializeAsync(CancellationToken stoppingToken)
    {
        try
        {
            UpdateStage("runtime_copy");
            var runtimeDir = CopyRuntimeBundle(_options.RuntimeBundleSourceDir, _options.RuntimeWorkDir);
            _runtimeDir = runtimeDir;

            UpdateStage("manifest_validation");
            var manifest = ValidateManifestAndLayout(runtimeDir);
            _bundleVersion = manifest.BundleVersion;

            UpdateStage("assembly_load");
            var g5GymAssemblyPath = Path.Combine(runtimeDir, "G5Gym.dll");
            if (!File.Exists(g5GymAssemblyPath))
            {
                throw new InvalidOperationException($"Missing G5Gym.dll in copied runtime: {g5GymAssemblyPath}");
            }

            Environment.SetEnvironmentVariable(
                "LD_LIBRARY_PATH",
                string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LD_LIBRARY_PATH"))
                    ? runtimeDir
                    : $"{runtimeDir}:{Environment.GetEnvironmentVariable("LD_LIBRARY_PATH")}");

            _loadContext = new G5RuntimeLoadContext(g5GymAssemblyPath, runtimeDir);
            _ = _loadContext.LoadFromAssemblyPath(g5GymAssemblyPath);
            var logicAssembly = _loadContext.LoadFromAssemblyName(new AssemblyName("G5.Logic"));

            UpdateStage("reflection_binding");
            _bindings = G5ReflectionBindings.Create(logicAssembly);
            foreach (var binding in _bindings.BindingDump)
            {
                _logger.LogInformation("G5 binding: {Binding}", binding);
            }

            UpdateStage("warm_model_initialization", runtimeLoaded: true);
            _sharedOpponentModeling = WarmOpponentModeling(runtimeDir, _bindings, _options.RecentHandsCount);

            UpdateStage("startup_self_check", runtimeLoaded: true, warmModelReady: true);
            await RunStartupSelfCheckAsync(_bindings, _sharedOpponentModeling, stoppingToken);

            lock (_stateLock)
            {
                _state = InitializationState.CreateReady(runtimeLoaded: true, warmModelReady: true);
            }
            _logger.LogInformation("G5 advisor service is ready using bundle version {BundleVersion}", _bundleVersion ?? "unknown");
        }
        catch (Exception ex)
        {
            var stage = GetCurrentStage();
            var inner = (ex as TargetInvocationException)?.InnerException;
            var exposedMessage = inner is not null
                ? $"{inner.GetType().FullName}: {inner.Message}"
                : ex.Message;
            lock (_stateLock)
            {
                _state = _state with { Ready = false, Error = exposedMessage };
            }
            _logger.LogError(ex, "G5 advisor initialization failed at stage {Stage}", stage);
        }
    }

    private AnalyzeDecisionResponse AnalyzeCore(AnalyzeDecisionRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var bindings = _bindings ?? throw new ServiceApiException(StatusCodes.Status503ServiceUnavailable, "runtime_unready", "G5 bindings are not ready");
        var sharedOpponentModeling = _sharedOpponentModeling ?? throw new ServiceApiException(StatusCodes.Status503ServiceUnavailable, "runtime_unready", "G5 opponent model is not ready");

        var prepared = PrepareReplayRequest(request);
        _logger.LogInformation(
            "Analyzing preflop decision: sequence={Sequence} hero={HeroPlayerId} replayed_actions={ActionCount}",
            prepared.TargetEntry.Sequence,
            prepared.Hero.PlayerId,
            prepared.ReplayEntries.Count);

        var modelingEstimator = CreateModelingEstimator(bindings, sharedOpponentModeling);
        try
        {
            var botGameState = CreateBotGameState(bindings, prepared, modelingEstimator);
            try
            {
                bindings.StartNewHandMethod.Invoke(botGameState, new object?[] { new List<int>() });
                bindings.DealHoleCardsMethod.Invoke(
                    botGameState,
                    new[]
                    {
                        CreateCard(bindings, prepared.HeroCards[0]),
                        CreateCard(bindings, prepared.HeroCards[1]),
                    });

                var replayedActionCount = 0;
                foreach (var entry in prepared.ReplayEntries)
                {
                    if (ShouldSkipForcedBlind(entry))
                    {
                        continue;
                    }

                    var currentPlayerToActIndex = ConvertToInt(bindings.GetPlayerToActIndMethod.Invoke(botGameState, null), "getPlayerToActInd result");
                    if (!prepared.PlayerIdToIndex.TryGetValue(entry.PlayerId, out var actorIndex))
                    {
                        throw new ServiceApiException(StatusCodes.Status400BadRequest, "unknown_action_actor", $"Unknown action actor in replay: {entry.PlayerId}");
                    }
                    if (currentPlayerToActIndex != actorIndex)
                    {
                        throw new ServiceApiException(
                            StatusCodes.Status400BadRequest,
                            "player_to_act_mismatch",
                            $"Replay desync before sequence {entry.Sequence}: expected actor index {actorIndex}, G5 expects {currentPlayerToActIndex}");
                    }

                    ReplayAction(bindings, botGameState, entry);
                    replayedActionCount += 1;
                }

                var playerToActIndex = ConvertToInt(bindings.GetPlayerToActIndMethod.Invoke(botGameState, null), "getPlayerToActInd result");
                if (playerToActIndex != prepared.HeroIndex)
                {
                    throw new ServiceApiException(
                        StatusCodes.Status400BadRequest,
                        "target_turn_mismatch",
                        $"Replay reached player index {playerToActIndex}, but hero index is {prepared.HeroIndex}");
                }

                var activePlayers = ConvertToInt(bindings.NumActivePlayersMethod.Invoke(botGameState, null), "numActivePlayers result");
                var rawDecision = bindings.CalculateHeroActionMethod.Invoke(botGameState, null)
                    ?? throw new ServiceApiException(StatusCodes.Status500InternalServerError, "g5_null_decision", "G5 returned a null decision object");

                var rawActionType = Convert.ToString(bindings.DecisionActionTypeMember.Read(rawDecision), CultureInfo.InvariantCulture)?.Trim() ?? string.Empty;
                var rawByAmount = ConvertToInt(bindings.DecisionByAmountMember.Read(rawDecision), "decision.byAmount");
                var checkCallEv = ConvertToDouble(bindings.DecisionCheckCallEvMember.Read(rawDecision), "decision.checkCallEV");
                var betRaiseEv = ConvertToDouble(bindings.DecisionBetRaiseEvMember.Read(rawDecision), "decision.betRaiseEV");
                var timeSpentSeconds = ConvertToDouble(bindings.DecisionTimeSpentSecondsMember.Read(rawDecision), "decision.timeSpentSeconds");
                var message = Convert.ToString(bindings.DecisionMessageMember.Read(rawDecision), CultureInfo.InvariantCulture) ?? string.Empty;

                var warnings = new List<string>(prepared.Warnings);
                if (string.Equals(rawActionType, "NoAction", StringComparison.Ordinal))
                {
                    warnings.Add("no_action_returned");
                }

                return new AnalyzeDecisionResponse
                {
                    DecisionSequence = prepared.TargetEntry.Sequence,
                    RecommendedAction = NormalizeAction(rawActionType, prepared.TargetEntry.ToCallBefore ?? 0, warnings),
                    Amount = DeriveNormalizedAmount(rawActionType, rawByAmount),
                    RawActionType = rawActionType,
                    RawByAmount = rawByAmount,
                    CheckCallEv = checkCallEv,
                    BetRaiseEv = betRaiseEv,
                    TimeSpentSeconds = timeSpentSeconds,
                    Message = message,
                    Warnings = warnings,
                    Debug = _options.ShouldIncludeDebugResponse
                        ? new AnalyzeDecisionDebug
                        {
                            ReplayedActionCount = replayedActionCount,
                            TargetStreet = "preflop",
                            ActivePlayers = activePlayers,
                            G5PlayerToActIndex = playerToActIndex,
                        }
                        : null,
                };
            }
            finally
            {
                if (botGameState is IDisposable disposable)
                {
                    disposable.Dispose();
                }
            }
        }
        finally
        {
            if (modelingEstimator is IDisposable disposable)
            {
                disposable.Dispose();
            }
        }
    }

    private PreparedReplayRequest PrepareReplayRequest(AnalyzeDecisionRequest request)
    {
        if (request.HandData is null)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "missing_hand_data", "hand_data is required");
        }

        var players = request.HandData.Players ?? new List<PlayerSnapshot>();
        if (players.Count < 2)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_players", "hand_data.players must contain at least two players");
        }

        var orderedPlayers = players
            .OrderBy(player => player.SeatNumber ?? int.MaxValue)
            .ToList();

        var seenSeats = new HashSet<int>();
        foreach (var player in orderedPlayers)
        {
            if (string.IsNullOrWhiteSpace(player.PlayerId))
            {
                throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_player_id", "Every player must include player_id");
            }
            if (player.SeatNumber is null)
            {
                throw new ServiceApiException(StatusCodes.Status400BadRequest, "missing_seat_number", $"Player {player.PlayerId} is missing seat_number");
            }
            if (!seenSeats.Add(player.SeatNumber.Value))
            {
                throw new ServiceApiException(StatusCodes.Status400BadRequest, "duplicate_seat_number", $"Duplicate seat_number {player.SeatNumber.Value}");
            }
        }

        var playerIdToIndex = orderedPlayers
            .Select((player, index) => new { player.PlayerId, Index = index })
            .ToDictionary(item => item.PlayerId, item => item.Index, StringComparer.Ordinal);

        if (!playerIdToIndex.TryGetValue(request.HeroPlayerId ?? string.Empty, out var heroIndex))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "unknown_hero_player", $"hero_player_id {request.HeroPlayerId} was not found in hand_data.players");
        }

        var dealerPlayerId = request.HandData.DealerPlayerId?.Trim();
        if (string.IsNullOrWhiteSpace(dealerPlayerId) || !playerIdToIndex.TryGetValue(dealerPlayerId, out var buttonIndex))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "unknown_dealer_player", "dealer_player_id must match a player in hand_data.players");
        }

        var bigBlindSize = request.HandData.Blinds?.BigBlind ?? 0;
        if (bigBlindSize <= 0)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_big_blind", "hand_data.blinds.big_blind must be greater than zero");
        }

        var hero = orderedPlayers[heroIndex];
        if (hero.HoleCards is null || hero.HoleCards.Count != 2)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_hero_hole_cards", "Hero must have exactly two hole cards");
        }

        var warnings = new List<string>();
        if ((request.HandData.CommunityCards?.Count ?? 0) > 0)
        {
            warnings.Add("trimmed_future_board_cards");
        }
        if (orderedPlayers.Any(player => player.PlayerId != hero.PlayerId && (player.HoleCards?.Count ?? 0) > 0))
        {
            warnings.Add("ignored_opponent_hole_cards");
        }

        var actionLog = request.HandData.ActionLog?
            .OrderBy(entry => entry.Sequence)
            .ToList() ?? new List<ActionLogEntry>();

        if (actionLog.Count == 0)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "missing_action_log", "hand_data.action_log must not be empty");
        }

        var duplicates = actionLog.GroupBy(entry => entry.Sequence).FirstOrDefault(group => group.Count() > 1);
        if (duplicates is not null)
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "duplicate_sequence", $"Duplicate action_log sequence {duplicates.Key}");
        }

        var targetEntry = actionLog.FirstOrDefault(entry => entry.Sequence == request.DecisionSequence)
            ?? throw new ServiceApiException(StatusCodes.Status400BadRequest, "decision_sequence_not_found", $"No action_log entry found for sequence {request.DecisionSequence}");

        if (!string.Equals(targetEntry.PlayerId, hero.PlayerId, StringComparison.Ordinal))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "decision_not_hero_action", $"Sequence {request.DecisionSequence} does not belong to hero_player_id {hero.PlayerId}");
        }

        if (!string.Equals(NormalizeStage(targetEntry.Stage), "preflop", StringComparison.Ordinal))
        {
            throw new ServiceApiException(StatusCodes.Status422UnprocessableEntity, "unsupported_street", "v1 only supports target actions where stage == preflop");
        }

        if (ShouldSkipForcedBlind(targetEntry))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "decision_not_playable_action", "The target decision_sequence points to a forced blind entry, not a hero decision");
        }

        var firstForcedBlind = actionLog.FirstOrDefault(ShouldSkipForcedBlind);
        if (firstForcedBlind is not null && (firstForcedBlind.PotBefore ?? 0) > 0)
        {
            throw new ServiceApiException(
                StatusCodes.Status422UnprocessableEntity,
                "unsupported_hidden_forced_contribution",
                "The stored hand appears to contain forced pre-blind pot contribution not representable through current blind fields");
        }

        var replayEntries = actionLog.Where(entry => entry.Sequence < targetEntry.Sequence).ToList();
        if (replayEntries.Any(entry => !string.Equals(NormalizeStage(entry.Stage), "preflop", StringComparison.Ordinal)))
        {
            throw new ServiceApiException(StatusCodes.Status400BadRequest, "unexpected_preceding_stage", "Found a non-preflop action before the target preflop decision");
        }

        var startingStacks = request.HandData.StartingStacks ?? new Dictionary<string, int>(StringComparer.Ordinal);
        var stackSizes = new int[orderedPlayers.Count];
        for (var index = 0; index < orderedPlayers.Count; index += 1)
        {
            var player = orderedPlayers[index];
            if (!startingStacks.TryGetValue(player.PlayerId, out var stackSize))
            {
                throw new ServiceApiException(StatusCodes.Status400BadRequest, "missing_starting_stack", $"Missing starting stack for player {player.PlayerId}");
            }
            if (stackSize < 0)
            {
                throw new ServiceApiException(StatusCodes.Status400BadRequest, "invalid_starting_stack", $"Starting stack for player {player.PlayerId} must be non-negative");
            }
            stackSizes[index] = stackSize;
        }

        var playerNames = orderedPlayers
            .Select(player => string.IsNullOrWhiteSpace(player.Username) ? player.PlayerId : player.Username.Trim())
            .ToArray();

        return new PreparedReplayRequest(
            Hero: hero,
            HeroIndex: heroIndex,
            ButtonIndex: buttonIndex,
            BigBlindSize: bigBlindSize,
            PlayerNames: playerNames,
            StackSizes: stackSizes,
            OrderedPlayers: orderedPlayers,
            PlayerIdToIndex: playerIdToIndex,
            ReplayEntries: replayEntries,
            TargetEntry: targetEntry,
            HeroCards: new[] { ToG5Card(hero.HoleCards[0]), ToG5Card(hero.HoleCards[1]) },
            Warnings: warnings);
    }

    private object CreateModelingEstimator(G5ReflectionBindings bindings, object sharedOpponentModeling)
    {
        return bindings.ModelingEstimatorConstructor.Invoke(new[]
        {
            sharedOpponentModeling,
            bindings.PokerClientPokerKingValue,
        });
    }

    private object CreateBotGameState(G5ReflectionBindings bindings, PreparedReplayRequest prepared, object modelingEstimator)
    {
        return bindings.BotGameStateConstructor.Invoke(new object?[]
        {
            prepared.PlayerNames,
            prepared.StackSizes,
            prepared.HeroIndex,
            prepared.ButtonIndex,
            prepared.BigBlindSize,
            bindings.PokerClientPokerKingValue,
            bindings.TableTypeSixMaxValue,
            modelingEstimator,
            false,
            _options.PreflopChartsLevel,
        });
    }

    private object CreateCard(G5ReflectionBindings bindings, string g5Card)
    {
        return bindings.CardStringConstructor.Invoke(new object[] { g5Card });
    }

    private void ReplayAction(G5ReflectionBindings bindings, object botGameState, ActionLogEntry entry)
    {
        var action = NormalizeActionName(entry.Action);
        switch (action)
        {
            case "fold":
                bindings.PlayerFoldsMethod.Invoke(botGameState, null);
                return;
            case "check":
            case "call":
                bindings.PlayerCheckCallsMethod.Invoke(botGameState, null);
                return;
            case "bet":
            case "raise":
            {
                var requestedAmount = entry.RequestedAmount ?? 0;
                if (requestedAmount <= 0)
                {
                    throw new ServiceApiException(StatusCodes.Status422UnprocessableEntity, "invalid_raise_amount", $"Sequence {entry.Sequence} is missing a positive requested_amount");
                }
                bindings.PlayerBetRaisesByMethod.Invoke(botGameState, new object[] { requestedAmount });
                return;
            }
            case "all-in":
            {
                var committed = entry.CommittedChips ?? 0;
                var toCall = entry.ToCallBefore ?? 0;
                if (committed <= 0)
                {
                    throw new ServiceApiException(StatusCodes.Status422UnprocessableEntity, "invalid_all_in_amount", $"Sequence {entry.Sequence} is missing committed_chips");
                }
                if (committed <= toCall)
                {
                    bindings.PlayerCheckCallsMethod.Invoke(botGameState, null);
                }
                else
                {
                    bindings.PlayerBetRaisesByMethod.Invoke(botGameState, new object[] { committed - toCall });
                }
                return;
            }
            default:
                throw new ServiceApiException(StatusCodes.Status422UnprocessableEntity, "unsupported_action", $"Unsupported preflop replay action '{entry.Action}' at sequence {entry.Sequence}");
        }
    }

    private object WarmOpponentModeling(string runtimeDir, G5ReflectionBindings bindings, int recentHandsCount)
    {
        var options = bindings.OpponentModelingOptionsConstructor.Invoke(Array.Empty<object>());
        bindings.RecentHandsCountField.SetValue(options, recentHandsCount);
        var statsFile = Path.Combine(runtimeDir, "full_stats_list_6max.bin");
        if (!File.Exists(statsFile))
        {
            throw new InvalidOperationException($"Missing six-max stats file: {statsFile}");
        }

        return bindings.OpponentModelingConstructor.Invoke(new object?[]
        {
            statsFile,
            bindings.TableTypeSixMaxValue,
            options,
        });
    }

    private async Task RunStartupSelfCheckAsync(G5ReflectionBindings bindings, object sharedOpponentModeling, CancellationToken stoppingToken)
    {
        var request = new AnalyzeDecisionRequest
        {
            HeroPlayerId = "player_4",
            DecisionSequence = 3,
            HandData = new HandData
            {
                Blinds = new BlindConfig { SmallBlind = 50, BigBlind = 100 },
                DealerPlayerId = "player_1",
                SmallBlindPlayerId = "player_2",
                BigBlindPlayerId = "player_3",
                Players = new List<PlayerSnapshot>
                {
                    new() { PlayerId = "player_1", Username = "P1", SeatNumber = 1 },
                    new() { PlayerId = "player_2", Username = "P2", SeatNumber = 2 },
                    new() { PlayerId = "player_3", Username = "P3", SeatNumber = 3 },
                    new() { PlayerId = "player_4", Username = "P4", SeatNumber = 4, HoleCards = new List<CardDto> { new() { Rank = "A", Suit = "spades" }, new() { Rank = "K", Suit = "diamonds" } } },
                    new() { PlayerId = "player_5", Username = "P5", SeatNumber = 5 },
                    new() { PlayerId = "player_6", Username = "P6", SeatNumber = 6 },
                },
                StartingStacks = new Dictionary<string, int>(StringComparer.Ordinal)
                {
                    ["player_1"] = 10000,
                    ["player_2"] = 10000,
                    ["player_3"] = 10000,
                    ["player_4"] = 10000,
                    ["player_5"] = 10000,
                    ["player_6"] = 10000,
                },
                ActionLog = new List<ActionLogEntry>
                {
                    new() { Sequence = 1, Stage = "preflop", PlayerId = "player_2", Action = "small-blind", Source = "forced", RequestedAmount = 50, CommittedChips = 50, PotBefore = 0, ToCallBefore = 0 },
                    new() { Sequence = 2, Stage = "preflop", PlayerId = "player_3", Action = "big-blind", Source = "forced", RequestedAmount = 100, CommittedChips = 100, PotBefore = 50, ToCallBefore = 0 },
                    new() { Sequence = 3, Stage = "preflop", PlayerId = "player_4", Action = "raise", Source = "player", RequestedAmount = 300, CommittedChips = 400, ToCallBefore = 100 },
                },
            },
        };

        await Task.Yield();
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        linkedCts.CancelAfter(TimeSpan.FromSeconds(30));
        var response = AnalyzeCore(request);
        if (string.IsNullOrWhiteSpace(response.RawActionType))
        {
            throw new InvalidOperationException("Startup self-check returned an empty raw action type");
        }
    }

    private RuntimeManifest ValidateManifestAndLayout(string runtimeDir)
    {
        var manifestPath = Path.Combine(runtimeDir, "bundle-manifest.json");
        if (!File.Exists(manifestPath))
        {
            throw new InvalidOperationException($"Missing runtime manifest: {manifestPath}");
        }

        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("bundle-manifest.json must contain a JSON object");
        }

        var engine = ReadRequiredString(root, "engine");
        if (!string.Equals(engine, "g5", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Runtime manifest engine must be 'g5', got '{engine}'");
        }

        var platform = ReadRequiredString(root, "platform");
        if (!string.Equals(platform, "linux-x64", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Runtime manifest platform must be 'linux-x64', got '{platform}'");
        }

        var bundleVersion = ReadRequiredString(root, "bundle_version");
        ValidateManifestEntries(runtimeDir, root, "required_files", requireFile: false);
        ValidateManifestEntries(runtimeDir, root, "managed_assemblies", requireFile: true);
        ValidateManifestEntries(runtimeDir, root, "native_libraries", requireFile: true);

        return new RuntimeManifest(bundleVersion);
    }

    private static void ValidateManifestEntries(string runtimeDir, JsonElement root, string fieldName, bool requireFile)
    {
        if (!root.TryGetProperty(fieldName, out var property) || property.ValueKind != JsonValueKind.Array || property.GetArrayLength() == 0)
        {
            throw new InvalidOperationException($"Runtime manifest field '{fieldName}' must be a non-empty array");
        }

        foreach (var entry in property.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.String)
            {
                throw new InvalidOperationException($"Runtime manifest field '{fieldName}' entries must be strings");
            }

            var rawPath = entry.GetString() ?? string.Empty;
            var (normalized, expectsDirectory) = NormalizeManifestPath(rawPath);
            var target = Path.Combine(runtimeDir, normalized.Replace('/', Path.DirectorySeparatorChar));

            if (requireFile)
            {
                if (!File.Exists(target))
                {
                    throw new InvalidOperationException($"Missing runtime file declared in {fieldName}: {rawPath}");
                }
                continue;
            }

            if (expectsDirectory)
            {
                if (!Directory.Exists(target))
                {
                    throw new InvalidOperationException($"Missing runtime directory declared in {fieldName}: {rawPath}");
                }
            }
            else if (!File.Exists(target) && !Directory.Exists(target))
            {
                throw new InvalidOperationException($"Missing runtime path declared in {fieldName}: {rawPath}");
            }
        }
    }

    private static (string NormalizedPath, bool ExpectsDirectory) NormalizeManifestPath(string rawPath)
    {
        var value = rawPath.Trim();
        if (value.Length == 0)
        {
            throw new InvalidOperationException("Runtime manifest path entries must not be empty");
        }
        if (value.Contains('\\'))
        {
            throw new InvalidOperationException($"Runtime manifest path must use forward slashes only: {rawPath}");
        }

        var expectsDirectory = value.EndsWith("/", StringComparison.Ordinal);
        var trimmed = value.TrimEnd('/');
        if (trimmed.Length == 0)
        {
            throw new InvalidOperationException($"Runtime manifest path must not resolve to root: {rawPath}");
        }

        var parts = trimmed.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Any(part => part is "." or ".."))
        {
            throw new InvalidOperationException($"Runtime manifest path contains unsupported segment: {rawPath}");
        }

        return (string.Join("/", parts), expectsDirectory);
    }

    private static string ReadRequiredString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException($"Runtime manifest is missing required string field '{propertyName}'");
        }

        var value = property.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"Runtime manifest field '{propertyName}' must not be empty");
        }

        return value;
    }

    private static string CopyRuntimeBundle(string sourceDir, string destinationDir)
    {
        if (!Directory.Exists(sourceDir))
        {
            throw new InvalidOperationException($"Runtime bundle source directory does not exist: {sourceDir}");
        }

        if (Directory.Exists(destinationDir))
        {
            Directory.Delete(destinationDir, recursive: true);
        }

        Directory.CreateDirectory(destinationDir);
        CopyDirectoryContents(new DirectoryInfo(sourceDir), new DirectoryInfo(destinationDir));
        return Path.GetFullPath(destinationDir);
    }

    private static void CopyDirectoryContents(DirectoryInfo source, DirectoryInfo destination)
    {
        foreach (var directory in source.GetDirectories())
        {
            var target = destination.CreateSubdirectory(directory.Name);
            CopyDirectoryContents(directory, target);
        }

        foreach (var file in source.GetFiles())
        {
            file.CopyTo(Path.Combine(destination.FullName, file.Name), overwrite: true);
        }
    }

    private string GetCurrentStage()
    {
        lock (_stateLock)
        {
            return _state.Stage;
        }
    }

    private void UpdateStage(string stage, bool? runtimeLoaded = null, bool? warmModelReady = null)
    {
        lock (_stateLock)
        {
            _state = _state with
            {
                Stage = stage,
                Ready = false,
                RuntimeLoaded = runtimeLoaded ?? _state.RuntimeLoaded,
                WarmModelReady = warmModelReady ?? _state.WarmModelReady,
                Error = null,
            };
        }
        _logger.LogInformation("G5 advisor startup stage: {Stage}", stage);
    }

    private static int ConvertToInt(object? value, string label)
    {
        if (value is null)
        {
            throw new InvalidOperationException($"{label} returned null");
        }

        return value switch
        {
            int direct => direct,
            _ => Convert.ToInt32(value, CultureInfo.InvariantCulture),
        };
    }

    private static double ConvertToDouble(object? value, string label)
    {
        if (value is null)
        {
            throw new InvalidOperationException($"{label} returned null");
        }

        return value switch
        {
            double direct => direct,
            float single => single,
            _ => Convert.ToDouble(value, CultureInfo.InvariantCulture),
        };
    }

    private static string NormalizeActionName(string action)
    {
        return action.Trim().ToLowerInvariant();
    }

    private static string NormalizeStage(string stage)
    {
        return stage.Trim().ToLowerInvariant();
    }

    private static bool ShouldSkipForcedBlind(ActionLogEntry entry)
    {
        var action = NormalizeActionName(entry.Action);
        return string.Equals(NormalizeStage(entry.Stage), "preflop", StringComparison.Ordinal)
            && string.Equals(entry.Source?.Trim(), "forced", StringComparison.OrdinalIgnoreCase)
            && (action == "small-blind" || action == "big-blind");
    }

    private static string ToG5Card(CardDto card)
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

    private static string? NormalizeAction(string rawActionType, int toCallBefore, List<string> warnings)
    {
        return rawActionType switch
        {
            "Raise" => toCallBefore == 0 ? "bet" : "raise",
            "Bet" => "bet",
            "Check" => "check",
            "Call" => "call",
            "Fold" => "fold",
            "AllIn" => "all-in",
            "NoAction" => null,
            _ => warnings.AppendAndReturnNull("no_action_returned"),
        };
    }

    private static int? DeriveNormalizedAmount(string rawActionType, int rawByAmount)
    {
        return rawActionType switch
        {
            "Raise" or "Bet" or "Call" or "AllIn" => rawByAmount,
            _ => null,
        };
    }

    private sealed record PreparedReplayRequest(
        PlayerSnapshot Hero,
        int HeroIndex,
        int ButtonIndex,
        int BigBlindSize,
        string[] PlayerNames,
        int[] StackSizes,
        IReadOnlyList<PlayerSnapshot> OrderedPlayers,
        IReadOnlyDictionary<string, int> PlayerIdToIndex,
        IReadOnlyList<ActionLogEntry> ReplayEntries,
        ActionLogEntry TargetEntry,
        string[] HeroCards,
        List<string> Warnings);

    private sealed record RuntimeManifest(string BundleVersion);

    private sealed record InitializationState(string Stage, bool Ready, bool RuntimeLoaded, bool WarmModelReady, string? Error)
    {
        public static InitializationState NotStarted() => new("not_started", false, false, false, null);
        public static InitializationState CreateReady(bool runtimeLoaded, bool warmModelReady) => new(ReadyStage, true, runtimeLoaded, warmModelReady, null);
    }
}

internal sealed class ServiceApiException : Exception
{
    public ServiceApiException(int statusCode, string errorCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }

    public int StatusCode { get; }
    public string ErrorCode { get; }
}

internal static class WarningListExtensions
{
    public static string? AppendAndReturnNull(this List<string> warnings, string warning)
    {
        warnings.Add(warning);
        return null;
    }
}
