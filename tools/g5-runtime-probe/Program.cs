using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            Run(args);
            return 0;
        }
        catch (ProbeException ex)
        {
            Console.Error.WriteLine($"ERROR: {ex.Message}");
            return 1;
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            Console.Error.WriteLine($"ERROR: {DescribeException(ex.InnerException)}");
            return 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR: {DescribeException(ex)}");
            return 1;
        }
    }

    private static void Run(string[] args)
    {
        var runtimeDir = ParseRuntimeDir(args);

        PrintStage("manifest check");
        var manifest = LoadManifest(runtimeDir);

        var g5GymPath = Path.Combine(runtimeDir, "G5Gym.dll");
        if (!File.Exists(g5GymPath))
        {
            throw new ProbeException($"Missing G5Gym.dll in runtime directory: {g5GymPath}");
        }

        var loadContext = new RuntimeLoadContext(g5GymPath, runtimeDir);
        try
        {
            PrintStage("G5 runtime assembly load");
            _ = loadContext.LoadFromAssemblyPath(g5GymPath);

            PrintStage("dependency resolution");
            var logicAssembly = loadContext.LoadFromAssemblyName(new AssemblyName("G5.Logic"));
            var bindings = ProbeBindings.Create(logicAssembly);

            var results = new List<ProfileProbeResult>();
            foreach (var profile in manifest.TableProfiles.OrderBy(profile => profile.PlayerCountMin))
            {
                results.Add(RunProfileProbe(bindings, runtimeDir, profile));
            }

            Console.WriteLine(
                "probe success: " +
                string.Join(
                    " ",
                    results.Select(result =>
                        $"{result.Profile}.actionType={FormatValue(result.ActionType)} " +
                        $"{result.Profile}.byAmount={FormatValue(result.ByAmount)} " +
                        $"{result.Profile}.checkCallEV={FormatValue(result.CheckCallEv)} " +
                        $"{result.Profile}.betRaiseEV={FormatValue(result.BetRaiseEv)} " +
                        $"{result.Profile}.timeSpentSeconds={FormatValue(result.TimeSpentSeconds)} " +
                        $"{result.Profile}.message={FormatValue(result.Message)}")));
        }
        finally
        {
            loadContext.Unload();
        }
    }

    private static ProfileProbeResult RunProfileProbe(ProbeBindings bindings, string runtimeDir, TableProfileManifest profile)
    {
        PrintStage($"{profile.Profile} direct G5.Logic warm");
        var opponentModeling = CreateOpponentModeling(bindings, runtimeDir, profile);
        try
        {
            var modelingEstimator = bindings.ModelingEstimatorConstructor.Invoke(new[]
            {
                opponentModeling,
                bindings.PokerClientPokerKingValue,
            });
            try
            {
                var scenario = profile.Profile switch
                {
                    "heads_up" => CreateHeadsUpScenario(profile, bindings),
                    "six_max" => CreateSixMaxScenario(profile, bindings),
                    _ => throw new ProbeException($"Unsupported table profile '{profile.Profile}' in manifest"),
                };

                PrintStage($"{profile.Profile} BotGameState construction");
                var botGameState = bindings.BotGameStateConstructor.Invoke(new object?[]
                {
                    scenario.PlayerNames,
                    scenario.StackSizes,
                    scenario.HeroIndex,
                    scenario.ButtonIndex,
                    scenario.BigBlindSize,
                    bindings.PokerClientPokerKingValue,
                    ResolveTableTypeValue(bindings, profile.TableType),
                    modelingEstimator,
                    false,
                    4,
                });
                try
                {
                    PrintStage($"{profile.Profile} startNewHand");
                    bindings.StartNewHandMethod.Invoke(botGameState, new object?[] { new List<int>() });

                    PrintStage($"{profile.Profile} dealHoleCards");
                    bindings.DealHoleCardsMethod.Invoke(
                        botGameState,
                        new[]
                        {
                            bindings.CardStringConstructor.Invoke(new object[] { scenario.HeroCards[0] }),
                            bindings.CardStringConstructor.Invoke(new object[] { scenario.HeroCards[1] }),
                        });

                    PrintStage($"{profile.Profile} calculateHeroAction");
                    var rawDecision = bindings.CalculateHeroActionMethod.Invoke(botGameState, null)
                        ?? throw new ProbeException($"{profile.Profile} calculateHeroAction returned null");

                    var actionType = bindings.DecisionActionTypeMember.Read(rawDecision);
                    var byAmount = bindings.DecisionByAmountMember.Read(rawDecision);
                    var checkCallEv = bindings.DecisionCheckCallEvMember.Read(rawDecision);
                    var betRaiseEv = bindings.DecisionBetRaiseEvMember.Read(rawDecision);
                    var timeSpentSeconds = bindings.DecisionTimeSpentSecondsMember.Read(rawDecision);
                    var message = bindings.DecisionMessageMember.Read(rawDecision);

                    return new ProfileProbeResult(
                        profile.Profile,
                        actionType,
                        byAmount,
                        checkCallEv,
                        betRaiseEv,
                        timeSpentSeconds,
                        message);
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
        finally
        {
            if (opponentModeling is IDisposable disposable)
            {
                disposable.Dispose();
            }
        }
    }

    private static object CreateOpponentModeling(ProbeBindings bindings, string runtimeDir, TableProfileManifest profile)
    {
        var options = bindings.OpponentModelingOptionsConstructor.Invoke(Array.Empty<object>());
        bindings.RecentHandsCountField.SetValue(options, 15);

        var statsFile = Path.Combine(runtimeDir, profile.OpponentStatsFile.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(statsFile))
        {
            throw new ProbeException($"Missing stats file for profile '{profile.Profile}': {statsFile}");
        }

        return bindings.OpponentModelingConstructor.Invoke(new object?[]
        {
            statsFile,
            ResolveTableTypeValue(bindings, profile.TableType),
            options,
        });
    }

    private static object ResolveTableTypeValue(ProbeBindings bindings, string tableTypeName)
    {
        return tableTypeName switch
        {
            "HeadsUp" => bindings.TableTypeHeadsUpValue,
            "SixMax" => bindings.TableTypeSixMaxValue,
            _ => throw new ProbeException($"Unsupported table_type '{tableTypeName}' in manifest"),
        };
    }

    private static ProbeScenario CreateHeadsUpScenario(TableProfileManifest profile, ProbeBindings bindings)
    {
        if (profile.PlayerCountMin != 2 || profile.PlayerCountMax != 2)
        {
            throw new ProbeException("heads_up manifest profile must cover exactly 2..2");
        }

        return new ProbeScenario(
            PlayerNames: new[] { "HU1", "HU2" },
            StackSizes: new[] { 10000, 10000 },
            HeroIndex: 0,
            ButtonIndex: 0,
            BigBlindSize: 100,
            HeroCards: new[] { "As", "Kd" });
    }

    private static ProbeScenario CreateSixMaxScenario(TableProfileManifest profile, ProbeBindings bindings)
    {
        if (profile.PlayerCountMin != 3 || profile.PlayerCountMax != 6)
        {
            throw new ProbeException("six_max manifest profile must cover exactly 3..6");
        }

        return new ProbeScenario(
            PlayerNames: new[] { "P1", "P2", "P3", "P4", "P5", "P6" },
            StackSizes: new[] { 10000, 10000, 10000, 10000, 10000, 10000 },
            HeroIndex: 3,
            ButtonIndex: 0,
            BigBlindSize: 100,
            HeroCards: new[] { "As", "Kd" });
    }

    private static RuntimeManifest LoadManifest(string runtimeDir)
    {
        var manifestPath = Path.Combine(runtimeDir, "bundle-manifest.json");
        if (!File.Exists(manifestPath))
        {
            throw new ProbeException($"Missing bundle-manifest.json: {manifestPath}");
        }

        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ProbeException("bundle-manifest.json must contain a JSON object");
        }

        var engine = ReadRequiredString(root, "engine");
        if (!string.Equals(engine, "g5", StringComparison.Ordinal))
        {
            throw new ProbeException($"bundle-manifest.json engine must be 'g5', got '{engine}'");
        }

        var platform = ReadRequiredString(root, "platform");
        if (!string.Equals(platform, "linux-x64", StringComparison.Ordinal))
        {
            throw new ProbeException($"bundle-manifest.json platform must be 'linux-x64', got '{platform}'");
        }

        var requiredFiles = ReadRequiredStringArray(root, "required_files");
        if (!requiredFiles.Contains("full_stats_list_hu.bin", StringComparer.Ordinal) || !requiredFiles.Contains("full_stats_list_6max.bin", StringComparer.Ordinal))
        {
            throw new ProbeException("bundle-manifest.json required_files must include both full_stats_list_hu.bin and full_stats_list_6max.bin");
        }

        if (!root.TryGetProperty("table_profile_schema_version", out var schemaVersionProperty) || schemaVersionProperty.ValueKind != JsonValueKind.Number || !schemaVersionProperty.TryGetInt32(out var schemaVersion) || schemaVersion != 1)
        {
            throw new ProbeException("bundle-manifest.json table_profile_schema_version must be integer 1");
        }

        if (!root.TryGetProperty("table_profiles", out var tableProfilesProperty) || tableProfilesProperty.ValueKind != JsonValueKind.Array || tableProfilesProperty.GetArrayLength() == 0)
        {
            throw new ProbeException("bundle-manifest.json table_profiles must be a non-empty array");
        }

        var tableProfiles = new List<TableProfileManifest>();
        var seenProfiles = new HashSet<string>(StringComparer.Ordinal);
        foreach (var profileElement in tableProfilesProperty.EnumerateArray())
        {
            if (profileElement.ValueKind != JsonValueKind.Object)
            {
                throw new ProbeException("bundle-manifest.json table_profiles entries must be objects");
            }

            var profile = ReadRequiredString(profileElement, "profile");
            if (!seenProfiles.Add(profile))
            {
                throw new ProbeException($"bundle-manifest.json contains duplicate table profile '{profile}'");
            }

            var playerCountMin = ReadRequiredInt(profileElement, "player_count_min");
            var playerCountMax = ReadRequiredInt(profileElement, "player_count_max");
            var tableType = ReadRequiredString(profileElement, "table_type");
            var opponentStatsFile = ReadRequiredString(profileElement, "opponent_stats_file");

            if (!requiredFiles.Contains(opponentStatsFile, StringComparer.Ordinal))
            {
                throw new ProbeException($"bundle-manifest.json table profile '{profile}' references stats file not present in required_files: {opponentStatsFile}");
            }

            var statsPath = Path.Combine(runtimeDir, opponentStatsFile.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(statsPath))
            {
                throw new ProbeException($"bundle-manifest.json table profile '{profile}' stats file is missing: {opponentStatsFile}");
            }

            tableProfiles.Add(new TableProfileManifest(profile, playerCountMin, playerCountMax, tableType, opponentStatsFile));
        }

        if (tableProfiles.Count != 2 || !seenProfiles.SetEquals(new[] { "heads_up", "six_max" }))
        {
            throw new ProbeException("bundle-manifest.json table_profiles must include exactly heads_up and six_max");
        }

        return new RuntimeManifest(tableProfiles.OrderBy(profile => profile.PlayerCountMin).ToList());
    }

    private static string[] ReadRequiredStringArray(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array || property.GetArrayLength() == 0)
        {
            throw new ProbeException($"bundle-manifest.json field '{propertyName}' must be a non-empty array");
        }

        var values = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                throw new ProbeException($"bundle-manifest.json field '{propertyName}' entries must be strings");
            }

            var value = item.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ProbeException($"bundle-manifest.json field '{propertyName}' must not contain empty strings");
            }

            values.Add(value);
        }

        return values.ToArray();
    }

    private static string ReadRequiredString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            throw new ProbeException($"bundle-manifest.json missing required string field '{propertyName}'");
        }

        var value = property.GetString();
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ProbeException($"bundle-manifest.json field '{propertyName}' must not be empty");
        }

        return value.Trim();
    }

    private static int ReadRequiredInt(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Number || !property.TryGetInt32(out var value))
        {
            throw new ProbeException($"bundle-manifest.json missing required integer field '{propertyName}'");
        }

        return value;
    }

    private static string ParseRuntimeDir(string[] args)
    {
        if (args.Length == 2 && args[0] == "--runtime-dir")
        {
            var runtimeDir = args[1].Trim();
            if (runtimeDir.Length == 0)
            {
                throw new ProbeException("Runtime directory must not be empty");
            }

            var fullPath = Path.GetFullPath(runtimeDir);
            if (!Directory.Exists(fullPath))
            {
                throw new ProbeException($"Runtime directory does not exist: {fullPath}");
            }

            return fullPath;
        }

        throw new ProbeException("Usage: dotnet run --project tools/g5-runtime-probe -- --runtime-dir <path>");
    }

    private static void PrintStage(string stageName)
    {
        Console.WriteLine($"stage: {stageName}");
    }

    private static string FormatValue(object? value)
    {
        return value switch
        {
            null => "null",
            string text => text.Replace('\n', ' ').Replace('\r', ' ').Trim(),
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? value.ToString() ?? "null",
        };
    }

    private static string DescribeException(Exception exception)
    {
        return $"{exception.GetType().FullName}: {exception.Message}";
    }

    private sealed record RuntimeManifest(IReadOnlyList<TableProfileManifest> TableProfiles);

    private sealed record TableProfileManifest(
        string Profile,
        int PlayerCountMin,
        int PlayerCountMax,
        string TableType,
        string OpponentStatsFile);

    private sealed record ProbeScenario(
        string[] PlayerNames,
        int[] StackSizes,
        int HeroIndex,
        int ButtonIndex,
        int BigBlindSize,
        string[] HeroCards);

    private sealed record ProfileProbeResult(
        string Profile,
        object? ActionType,
        object? ByAmount,
        object? CheckCallEv,
        object? BetRaiseEv,
        object? TimeSpentSeconds,
        object? Message);
}

internal sealed class ProbeBindings
{
    public Type OpponentModelingOptionsType { get; }
    public Type OpponentModelingType { get; }
    public Type ModelingEstimatorType { get; }
    public Type IActionEstimatorType { get; }
    public Type BotGameStateType { get; }
    public Type CardType { get; }
    public Type TableTypeType { get; }
    public Type PokerClientType { get; }

    public ConstructorInfo OpponentModelingOptionsConstructor { get; }
    public ConstructorInfo OpponentModelingConstructor { get; }
    public ConstructorInfo ModelingEstimatorConstructor { get; }
    public ConstructorInfo BotGameStateConstructor { get; }
    public ConstructorInfo CardStringConstructor { get; }

    public FieldInfo RecentHandsCountField { get; }

    public MethodInfo StartNewHandMethod { get; }
    public MethodInfo DealHoleCardsMethod { get; }
    public MethodInfo CalculateHeroActionMethod { get; }

    public BoundMember DecisionActionTypeMember { get; }
    public BoundMember DecisionByAmountMember { get; }
    public BoundMember DecisionCheckCallEvMember { get; }
    public BoundMember DecisionBetRaiseEvMember { get; }
    public BoundMember DecisionTimeSpentSecondsMember { get; }
    public BoundMember DecisionMessageMember { get; }

    public object TableTypeHeadsUpValue { get; }
    public object TableTypeSixMaxValue { get; }
    public object PokerClientPokerKingValue { get; }

    private ProbeBindings(
        Type opponentModelingOptionsType,
        Type opponentModelingType,
        Type modelingEstimatorType,
        Type iActionEstimatorType,
        Type botGameStateType,
        Type cardType,
        Type tableTypeType,
        Type pokerClientType,
        ConstructorInfo opponentModelingOptionsConstructor,
        ConstructorInfo opponentModelingConstructor,
        ConstructorInfo modelingEstimatorConstructor,
        ConstructorInfo botGameStateConstructor,
        ConstructorInfo cardStringConstructor,
        FieldInfo recentHandsCountField,
        MethodInfo startNewHandMethod,
        MethodInfo dealHoleCardsMethod,
        MethodInfo calculateHeroActionMethod,
        BoundMember decisionActionTypeMember,
        BoundMember decisionByAmountMember,
        BoundMember decisionCheckCallEvMember,
        BoundMember decisionBetRaiseEvMember,
        BoundMember decisionTimeSpentSecondsMember,
        BoundMember decisionMessageMember,
        object tableTypeHeadsUpValue,
        object tableTypeSixMaxValue,
        object pokerClientPokerKingValue)
    {
        OpponentModelingOptionsType = opponentModelingOptionsType;
        OpponentModelingType = opponentModelingType;
        ModelingEstimatorType = modelingEstimatorType;
        IActionEstimatorType = iActionEstimatorType;
        BotGameStateType = botGameStateType;
        CardType = cardType;
        TableTypeType = tableTypeType;
        PokerClientType = pokerClientType;
        OpponentModelingOptionsConstructor = opponentModelingOptionsConstructor;
        OpponentModelingConstructor = opponentModelingConstructor;
        ModelingEstimatorConstructor = modelingEstimatorConstructor;
        BotGameStateConstructor = botGameStateConstructor;
        CardStringConstructor = cardStringConstructor;
        RecentHandsCountField = recentHandsCountField;
        StartNewHandMethod = startNewHandMethod;
        DealHoleCardsMethod = dealHoleCardsMethod;
        CalculateHeroActionMethod = calculateHeroActionMethod;
        DecisionActionTypeMember = decisionActionTypeMember;
        DecisionByAmountMember = decisionByAmountMember;
        DecisionCheckCallEvMember = decisionCheckCallEvMember;
        DecisionBetRaiseEvMember = decisionBetRaiseEvMember;
        DecisionTimeSpentSecondsMember = decisionTimeSpentSecondsMember;
        DecisionMessageMember = decisionMessageMember;
        TableTypeHeadsUpValue = tableTypeHeadsUpValue;
        TableTypeSixMaxValue = tableTypeSixMaxValue;
        PokerClientPokerKingValue = pokerClientPokerKingValue;
    }

    public static ProbeBindings Create(Assembly logicAssembly)
    {
        var opponentModelingOptionsType = GetTypeOrThrow(logicAssembly, "G5.Logic.OpponentModeling+Options");
        var opponentModelingType = GetTypeOrThrow(logicAssembly, "G5.Logic.OpponentModeling");
        var modelingEstimatorType = GetTypeOrThrow(logicAssembly, "G5.Logic.Estimators.ModelingEstimator");
        var iActionEstimatorType = GetTypeOrThrow(logicAssembly, "G5.Logic.Estimators.IActionEstimator");
        var botGameStateType = GetTypeOrThrow(logicAssembly, "G5.Logic.BotGameState");
        var cardType = GetTypeOrThrow(logicAssembly, "G5.Logic.Card");
        var tableTypeType = GetTypeOrThrow(logicAssembly, "G5.Logic.TableType");
        var pokerClientType = GetTypeOrThrow(logicAssembly, "G5.Logic.PokerClient");

        var opponentModelingOptionsConstructor = GetConstructorOrThrow(opponentModelingOptionsType, Type.EmptyTypes);
        var recentHandsCountField = GetFieldOrThrow(opponentModelingOptionsType, "recentHandsCount");
        var opponentModelingConstructor = GetConstructorOrThrow(opponentModelingType, typeof(string), tableTypeType, opponentModelingOptionsType);
        var modelingEstimatorConstructor = GetConstructorOrThrow(modelingEstimatorType, opponentModelingType, pokerClientType);
        var botGameStateConstructor = GetConstructorOrThrow(
            botGameStateType,
            typeof(string[]),
            typeof(int[]),
            typeof(int),
            typeof(int),
            typeof(int),
            pokerClientType,
            tableTypeType,
            iActionEstimatorType,
            typeof(bool),
            typeof(int));
        var cardStringConstructor = GetConstructorOrThrow(cardType, typeof(string));

        var startNewHandMethod = GetMethodOrThrow(botGameStateType, "startNewHand", typeof(List<int>));
        var dealHoleCardsMethod = GetMethodOrThrow(botGameStateType, "dealHoleCards", cardType, cardType);
        var calculateHeroActionMethod = GetMethodOrThrow(botGameStateType, "calculateHeroAction", Type.EmptyTypes);

        var decisionType = calculateHeroActionMethod.ReturnType;
        var decisionActionTypeMember = BoundMember.Create(decisionType, "actionType");
        var decisionByAmountMember = BoundMember.Create(decisionType, "byAmount");
        var decisionCheckCallEvMember = BoundMember.Create(decisionType, "checkCallEV");
        var decisionBetRaiseEvMember = BoundMember.Create(decisionType, "betRaiseEV");
        var decisionTimeSpentSecondsMember = BoundMember.Create(decisionType, "timeSpentSeconds");
        var decisionMessageMember = BoundMember.Create(decisionType, "message");

        var tableTypeHeadsUpValue = GetEnumValueOrThrow(tableTypeType, "HeadsUp");
        var tableTypeSixMaxValue = GetEnumValueOrThrow(tableTypeType, "SixMax");
        var pokerClientPokerKingValue = GetEnumValueOrThrow(pokerClientType, "PokerKing");

        return new ProbeBindings(
            opponentModelingOptionsType,
            opponentModelingType,
            modelingEstimatorType,
            iActionEstimatorType,
            botGameStateType,
            cardType,
            tableTypeType,
            pokerClientType,
            opponentModelingOptionsConstructor,
            opponentModelingConstructor,
            modelingEstimatorConstructor,
            botGameStateConstructor,
            cardStringConstructor,
            recentHandsCountField,
            startNewHandMethod,
            dealHoleCardsMethod,
            calculateHeroActionMethod,
            decisionActionTypeMember,
            decisionByAmountMember,
            decisionCheckCallEvMember,
            decisionBetRaiseEvMember,
            decisionTimeSpentSecondsMember,
            decisionMessageMember,
            tableTypeHeadsUpValue,
            tableTypeSixMaxValue,
            pokerClientPokerKingValue);
    }

    private static Type GetTypeOrThrow(Assembly assembly, string fullName)
    {
        return assembly.GetType(fullName, throwOnError: false)
            ?? throw new ProbeException($"Failed to bind reflected type {fullName}");
    }

    private static ConstructorInfo GetConstructorOrThrow(Type type, params Type[] parameterTypes)
    {
        var constructor = type.GetConstructor(parameterTypes);
        if (constructor is not null)
        {
            return constructor;
        }

        var overloads = type
            .GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .Select(FormatSignature)
            .ToArray();

        throw new ProbeException(
            $"Failed to find constructor on {type.FullName} with parameters ({FormatParameterTypes(parameterTypes)}). " +
            $"Available overloads: {string.Join("; ", overloads)}");
    }

    private static MethodInfo GetMethodOrThrow(Type type, string methodName, params Type[] parameterTypes)
    {
        var method = type.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance, binder: null, parameterTypes, modifiers: null);
        if (method is not null)
        {
            return method;
        }

        var overloads = type
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(candidate => candidate.Name == methodName)
            .Select(FormatSignature)
            .ToArray();

        throw new ProbeException(
            $"Failed to find method {type.FullName}.{methodName}({FormatParameterTypes(parameterTypes)}). " +
            $"Available overloads: {string.Join("; ", overloads)}");
    }

    private static FieldInfo GetFieldOrThrow(Type type, string fieldName)
    {
        return type.GetField(fieldName, BindingFlags.Public | BindingFlags.Instance)
            ?? throw new ProbeException($"Failed to find field {type.FullName}.{fieldName}");
    }

    private static object GetEnumValueOrThrow(Type enumType, string valueName)
    {
        if (!enumType.IsEnum)
        {
            throw new ProbeException($"Type {enumType.FullName} is not an enum");
        }

        return Enum.Parse(enumType, valueName, ignoreCase: false);
    }

    private static string FormatSignature(MethodBase method)
    {
        var parameters = string.Join(
            ", ",
            method.GetParameters().Select(parameter => $"{parameter.ParameterType.FullName} {parameter.Name}"));
        return method switch
        {
            ConstructorInfo constructor => $"{constructor.DeclaringType?.FullName}({parameters})",
            MethodInfo methodInfo => $"{methodInfo.ReturnType.FullName} {methodInfo.DeclaringType?.FullName}.{methodInfo.Name}({parameters})",
            _ => method.ToString() ?? method.Name,
        };
    }

    private static string FormatParameterTypes(IEnumerable<Type> parameterTypes)
    {
        return string.Join(", ", parameterTypes.Select(type => type.FullName ?? type.Name));
    }
}

internal sealed class BoundMember
{
    private BoundMember(string signature, Func<object, object?> reader)
    {
        Signature = signature;
        _reader = reader;
    }

    private readonly Func<object, object?> _reader;

    public string Signature { get; }

    public object? Read(object instance) => _reader(instance);

    public static BoundMember Create(Type declaringType, string memberName)
    {
        var property = declaringType.GetProperty(memberName, BindingFlags.Public | BindingFlags.Instance);
        if (property is not null)
        {
            return new BoundMember($"{property.PropertyType.FullName} {declaringType.FullName}.{property.Name}", instance => property.GetValue(instance));
        }

        var field = declaringType.GetField(memberName, BindingFlags.Public | BindingFlags.Instance);
        if (field is not null)
        {
            return new BoundMember($"{field.FieldType.FullName} {declaringType.FullName}.{field.Name}", instance => field.GetValue(instance));
        }

        throw new ProbeException($"Failed to bind decision member {declaringType.FullName}.{memberName}");
    }
}

internal sealed class ProbeException : Exception
{
    public ProbeException(string message)
        : base(message)
    {
    }
}

internal sealed class RuntimeLoadContext : AssemblyLoadContext
{
    private readonly AssemblyDependencyResolver _resolver;
    private readonly string _runtimeDir;

    public RuntimeLoadContext(string rootAssemblyPath, string runtimeDir)
        : base(isCollectible: true)
    {
        _resolver = new AssemblyDependencyResolver(rootAssemblyPath);
        _runtimeDir = runtimeDir;
    }

    protected override Assembly? Load(AssemblyName assemblyName)
    {
        var resolvedPath = _resolver.ResolveAssemblyToPath(assemblyName);
        if (resolvedPath is not null)
        {
            return LoadFromAssemblyPath(resolvedPath);
        }

        var candidatePath = Path.Combine(_runtimeDir, $"{assemblyName.Name}.dll");
        if (File.Exists(candidatePath))
        {
            return LoadFromAssemblyPath(candidatePath);
        }

        return null;
    }

    protected override nint LoadUnmanagedDll(string unmanagedDllName)
    {
        var resolvedPath = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
        if (resolvedPath is not null)
        {
            return LoadUnmanagedDllFromPath(resolvedPath);
        }

        foreach (var candidate in EnumerateUnmanagedCandidates(unmanagedDllName))
        {
            if (File.Exists(candidate))
            {
                return LoadUnmanagedDllFromPath(candidate);
            }
        }

        return IntPtr.Zero;
    }

    private IEnumerable<string> EnumerateUnmanagedCandidates(string unmanagedDllName)
    {
        yield return Path.Combine(_runtimeDir, unmanagedDllName);
        if (!unmanagedDllName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
        {
            yield return Path.Combine(_runtimeDir, $"{unmanagedDllName}.dll");
        }
    }
}
