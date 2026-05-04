using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;

internal sealed class G5RuntimeLoadContext : AssemblyLoadContext
{
    private readonly AssemblyDependencyResolver _resolver;
    private readonly string _runtimeDir;

    public G5RuntimeLoadContext(string entryAssemblyPath, string runtimeDir)
        : base("G5RuntimeLoadContext", isCollectible: false)
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

    public void PrimeNativeLibrary(string fileName)
    {
        var path = Path.Combine(_runtimeDir, fileName);
        if (File.Exists(path))
        {
            NativeLibrary.Load(path);
        }
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
