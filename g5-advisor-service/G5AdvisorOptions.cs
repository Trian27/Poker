internal sealed class G5AdvisorOptions
{
    public string RuntimeBundleSourceDir { get; init; } = "/opt/g5-bundle";
    public string RuntimeWorkDir { get; init; } = "/var/lib/g5-runtime/current";
    public int RecentHandsCount { get; init; } = 15;
    public int PreflopChartsLevel { get; init; } = 4;
    public bool IncludeDebugResponse { get; init; }
    public string EnvMode { get; init; } = "dev";
    public int ServicePort { get; init; } = 8002;

    public bool IsProduction =>
        string.Equals(EnvMode, "production", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(EnvMode, "prod", StringComparison.OrdinalIgnoreCase);

    public bool ShouldIncludeDebugResponse => IncludeDebugResponse || !IsProduction;
}
