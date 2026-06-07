using Xunit;
using Microsoft.Extensions.Logging.Abstractions;

[CollectionDefinition("g5-runtime")]
public sealed class G5RuntimeCollection : ICollectionFixture<G5RuntimeHostFixture>
{
}

public sealed class G5RuntimeHostFixture : IAsyncLifetime
{
    private string? _tempRuntimeDir;

    internal G5RuntimeHost Host { get; private set; } = null!;
    public string RepoRoot { get; private set; } = string.Empty;
    public string RuntimeSourceDir { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        RepoRoot = FindRepoRoot();
        RuntimeSourceDir = Environment.GetEnvironmentVariable("G5_TEST_RUNTIME_DIR")
            ?? Path.Combine(RepoRoot, ".runtime", "engines", "g5", "current", "app");

        if (!Directory.Exists(RuntimeSourceDir))
        {
            throw new InvalidOperationException($"G5 test runtime directory was not found: {RuntimeSourceDir}");
        }

        _tempRuntimeDir = Path.Combine(Path.GetTempPath(), "g5-advisor-tests", Guid.NewGuid().ToString("n"));
        var options = new G5AdvisorOptions
        {
            RuntimeBundleSourceDir = RuntimeSourceDir,
            RuntimeWorkDir = _tempRuntimeDir,
            IncludeDebugResponse = true,
            EnvMode = "dev",
        };

        Host = new G5RuntimeHost(NullLogger<G5RuntimeHost>.Instance, options);
        Host.StartInitialization(CancellationToken.None);

        var deadline = DateTime.UtcNow.AddMinutes(2);
        while (DateTime.UtcNow < deadline)
        {
            var health = Host.GetHealthResponse();
            if (health.Ready)
            {
                return;
            }

            await Task.Delay(250);
        }

        var finalHealth = Host.GetHealthResponse();
        throw new InvalidOperationException($"G5 runtime host did not become ready. Stage={finalHealth.StartupStage} Error={finalHealth.Error}");
    }

    public Task DisposeAsync()
    {
        if (!string.IsNullOrWhiteSpace(_tempRuntimeDir) && Directory.Exists(_tempRuntimeDir))
        {
            Directory.Delete(_tempRuntimeDir, recursive: true);
        }

        return Task.CompletedTask;
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "docker-compose.yml")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Could not find repository root from test base directory.");
    }
}
