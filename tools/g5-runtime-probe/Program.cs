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
        var manifestPath = Path.Combine(runtimeDir, "bundle-manifest.json");
        ValidateManifest(manifestPath);

        var g5GymPath = Path.Combine(runtimeDir, "G5Gym.dll");
        if (!File.Exists(g5GymPath))
        {
            throw new ProbeException($"Missing G5Gym.dll in runtime directory: {g5GymPath}");
        }

        var loadContext = new RuntimeLoadContext(g5GymPath, runtimeDir);
        try
        {
            PrintStage("G5Gym.dll load");
            var g5GymAssembly = loadContext.LoadFromAssemblyPath(g5GymPath);

            PrintStage("dependency resolution");
            _ = loadContext.LoadFromAssemblyName(new AssemblyName("G5.Logic"));

            var pythonApiType = g5GymAssembly.GetType("G5Gym.PythonAPI", throwOnError: true)
                ?? throw new ProbeException("Failed to resolve type G5Gym.PythonAPI");

            var constructor = FindConstructorOrThrow(pythonApiType, typeof(int), typeof(int));

            PrintStage("PythonAPI construction");
            var pythonApi = InvokeConstructor(constructor, 6, 15);
            try
            {
                var createGameMethod = FindMethodOrThrow(
                    pythonApiType,
                    "createGame",
                    typeof(string),
                    typeof(string[]),
                    typeof(int[]),
                    typeof(int),
                    typeof(int),
                    typeof(int),
                    typeof(bool),
                    typeof(int));

                var startNewHandMethod = FindMethodOrThrow(
                    pythonApiType,
                    "startNewHand",
                    typeof(string),
                    typeof(int),
                    typeof(List<int>));

                var dealHoleCardsMethod = FindMethodOrThrow(
                    pythonApiType,
                    "dealHoleCards",
                    typeof(string),
                    typeof(string),
                    typeof(string));

                var calculateHeroActionMethod = FindMethodOrThrow(
                    pythonApiType,
                    "calculateHeroAction",
                    typeof(string));

                var playerNames = new[] { "P1", "P2", "P3", "P4", "P5", "P6" };
                var stackSizes = new[] { 10000, 10000, 10000, 10000, 10000, 10000 };
                const string gameName = "probe-game";

                PrintStage("createGame");
                InvokeMethod(
                    pythonApi,
                    createGameMethod,
                    "createGame",
                    gameName,
                    playerNames,
                    stackSizes,
                    3,
                    0,
                    100,
                    false,
                    4);

                PrintStage("startNewHand");
                InvokeMethod(
                    pythonApi,
                    startNewHandMethod,
                    "startNewHand",
                    gameName,
                    0,
                    new List<int>());

                PrintStage("dealHoleCards");
                InvokeMethod(
                    pythonApi,
                    dealHoleCardsMethod,
                    "dealHoleCards",
                    gameName,
                    "As",
                    "Kd");

                PrintStage("calculateHeroAction");
                var result = InvokeMethod(
                    pythonApi,
                    calculateHeroActionMethod,
                    "calculateHeroAction",
                    gameName);

                if (result is null)
                {
                    throw new ProbeException("calculateHeroAction returned null");
                }

                var actionType = ReadRequiredProperty(result, "actionType");
                var byAmount = ReadRequiredProperty(result, "byAmount");
                var checkCallEv = ReadRequiredProperty(result, "checkCallEV");
                var betRaiseEv = ReadRequiredProperty(result, "betRaiseEV");
                var timeSpentSeconds = ReadRequiredProperty(result, "timeSpentSeconds");
                var message = ReadRequiredProperty(result, "message");

                Console.WriteLine(
                    "probe success: " +
                    $"actionType={FormatValue(actionType)} " +
                    $"byAmount={FormatValue(byAmount)} " +
                    $"checkCallEV={FormatValue(checkCallEv)} " +
                    $"betRaiseEV={FormatValue(betRaiseEv)} " +
                    $"timeSpentSeconds={FormatValue(timeSpentSeconds)} " +
                    $"message={FormatValue(message)}");
            }
            finally
            {
                if (pythonApi is IDisposable disposable)
                {
                    disposable.Dispose();
                }
            }
        }
        finally
        {
            loadContext.Unload();
        }
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

    private static void ValidateManifest(string manifestPath)
    {
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

    private static void PrintStage(string stageName)
    {
        Console.WriteLine($"stage: {stageName}");
    }

    private static ConstructorInfo FindConstructorOrThrow(Type type, params Type[] parameterTypes)
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

    private static MethodInfo FindMethodOrThrow(Type type, string methodName, params Type[] parameterTypes)
    {
        var methods = type
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(method => method.Name == methodName)
            .ToArray();

        foreach (var method in methods)
        {
            var parameters = method.GetParameters();
            if (parameters.Length != parameterTypes.Length)
            {
                continue;
            }

            var allMatch = true;
            for (var index = 0; index < parameters.Length; index += 1)
            {
                if (parameters[index].ParameterType != parameterTypes[index])
                {
                    allMatch = false;
                    break;
                }
            }

            if (allMatch)
            {
                return method;
            }
        }

        var overloads = methods.Select(FormatSignature).ToArray();
        var availableText = overloads.Length > 0
            ? string.Join("; ", overloads)
            : "(no public instance overloads found)";

        throw new ProbeException(
            $"Failed to find method {type.FullName}.{methodName} with parameters ({FormatParameterTypes(parameterTypes)}). " +
            $"Available overloads: {availableText}");
    }

    private static object InvokeConstructor(ConstructorInfo constructor, params object[] args)
    {
        try
        {
            return constructor.Invoke(args)
                ?? throw new ProbeException($"Constructor returned null for {constructor.DeclaringType?.FullName}");
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw new ProbeException($"PythonAPI construction failure: {DescribeException(ex.InnerException)}");
        }
    }

    private static object? InvokeMethod(object instance, MethodInfo method, string stageName, params object[] args)
    {
        try
        {
            return method.Invoke(instance, args);
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw new ProbeException($"{stageName} failed: {DescribeException(ex.InnerException)}");
        }
    }

    private static object? ReadRequiredProperty(object instance, string propertyName)
    {
        var property = instance.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
        if (property is null)
        {
            var available = instance
                .GetType()
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(info => info.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray();

            throw new ProbeException(
                $"calculateHeroAction result is missing property '{propertyName}'. " +
                $"Available properties: {string.Join(", ", available)}");
        }

        return property.GetValue(instance);
    }

    private static string FormatSignature(MethodBase methodBase)
    {
        var parameters = string.Join(
            ", ",
            methodBase
                .GetParameters()
                .Select(parameter => $"{FormatTypeName(parameter.ParameterType)} {parameter.Name}"));

        return methodBase switch
        {
            MethodInfo method => $"{FormatTypeName(method.ReturnType)} {method.Name}({parameters})",
            ConstructorInfo constructor => $"{constructor.DeclaringType?.Name}({parameters})",
            _ => methodBase.ToString() ?? "<unknown signature>",
        };
    }

    private static string FormatParameterTypes(IEnumerable<Type> parameterTypes)
    {
        return string.Join(", ", parameterTypes.Select(FormatTypeName));
    }

    private static string FormatTypeName(Type type)
    {
        if (type.IsArray)
        {
            return $"{FormatTypeName(type.GetElementType() ?? typeof(object))}[]";
        }

        if (type.IsGenericType)
        {
            var genericName = type.Name[..type.Name.IndexOf('`')];
            var arguments = string.Join(", ", type.GetGenericArguments().Select(FormatTypeName));
            return $"{genericName}<{arguments}>";
        }

        return type.Name;
    }

    private static string FormatValue(object? value)
    {
        if (value is null)
        {
            return "null";
        }

        return value switch
        {
            string message => message.Replace("\r", " ").Replace("\n", " ").Trim(),
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? value.ToString() ?? "null",
        };
    }

    private static string DescribeException(Exception exception)
    {
        return $"{exception.GetType().FullName}: {exception.Message}";
    }

    private sealed class RuntimeLoadContext : AssemblyLoadContext
    {
        private readonly AssemblyDependencyResolver _resolver;
        private readonly string _runtimeDir;

        public RuntimeLoadContext(string entryAssemblyPath, string runtimeDir)
            : base(isCollectible: true)
        {
            _resolver = new AssemblyDependencyResolver(entryAssemblyPath);
            _runtimeDir = runtimeDir;
        }

        protected override Assembly? Load(AssemblyName assemblyName)
        {
            var resolvedPath = _resolver.ResolveAssemblyToPath(assemblyName);
            if (resolvedPath is not null)
            {
                return LoadFromAssemblyPath(resolvedPath);
            }

            var fallbackPath = Path.Combine(_runtimeDir, $"{assemblyName.Name}.dll");
            if (File.Exists(fallbackPath))
            {
                return LoadFromAssemblyPath(fallbackPath);
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

            foreach (var candidate in GetNativeCandidates(unmanagedDllName))
            {
                if (File.Exists(candidate))
                {
                    return LoadUnmanagedDllFromPath(candidate);
                }
            }

            return IntPtr.Zero;
        }

        private IEnumerable<string> GetNativeCandidates(string unmanagedDllName)
        {
            var names = new HashSet<string>(StringComparer.Ordinal)
            {
                unmanagedDllName,
            };

            if (!Path.HasExtension(unmanagedDllName))
            {
                names.Add($"{unmanagedDllName}.dll");
                names.Add($"{unmanagedDllName}.so");
                names.Add($"lib{unmanagedDllName}.so");
            }

            foreach (var name in names)
            {
                yield return Path.Combine(_runtimeDir, name);
            }
        }
    }

    private sealed class ProbeException : Exception
    {
        public ProbeException(string message)
            : base(message)
        {
        }
    }
}
