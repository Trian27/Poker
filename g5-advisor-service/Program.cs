using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    options.SerializerOptions.WriteIndented = false;
});

builder.Services.AddSingleton(_ => new G5AdvisorOptions
{
    RuntimeBundleSourceDir = builder.Configuration["G5_RUNTIME_BUNDLE_SOURCE_DIR"] ?? "/opt/g5-bundle",
    RuntimeWorkDir = builder.Configuration["G5_RUNTIME_WORK_DIR"] ?? "/var/lib/g5-runtime/current",
    RecentHandsCount = int.TryParse(builder.Configuration["G5_RECENT_HANDS_COUNT"], out var recentHandsCount) ? recentHandsCount : 15,
    PreflopChartsLevel = int.TryParse(builder.Configuration["G5_PREFLOP_CHARTS_LEVEL"], out var preflopChartsLevel) ? preflopChartsLevel : 4,
    IncludeDebugResponse = bool.TryParse(builder.Configuration["G5_DEBUG_RESPONSE"], out var includeDebug) && includeDebug,
    EnvMode = builder.Configuration["ENV_MODE"] ?? "dev",
    ServicePort = int.TryParse(builder.Configuration["G5_SERVICE_PORT"], out var servicePort) ? servicePort : 8002,
});
builder.Services.AddSingleton<G5RuntimeHost>();

var app = builder.Build();
var runtimeHost = app.Services.GetRequiredService<G5RuntimeHost>();
runtimeHost.StartInitialization(app.Lifetime.ApplicationStopping);

app.MapGet("/health", (G5RuntimeHost host) =>
{
    var response = host.GetHealthResponse();
    return Results.Json(response, statusCode: response.Ready ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
});

app.MapPost("/api/v1/advisor/g5/analyze-decision", async (AnalyzeDecisionRequest request, G5RuntimeHost host, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    try
    {
        var response = await host.AnalyzeAsync(request, cancellationToken);
        return Results.Json(response, statusCode: StatusCodes.Status200OK);
    }
    catch (ServiceApiException ex)
    {
        logger.LogWarning(ex, "G5 advisor request failed with {ErrorCode}", ex.ErrorCode);
        return Results.Json(
            new ErrorResponse
            {
                Error = ex.ErrorCode,
                Message = ex.Message,
                StartupStage = host.GetHealthResponse().StartupStage,
            },
            statusCode: ex.StatusCode);
    }
    catch (TargetInvocationException ex) when (ex.InnerException is not null)
    {
        logger.LogError(ex.InnerException, "Unexpected reflected G5 advisor failure");
        return Results.Json(
            new ErrorResponse
            {
                Error = "internal_error",
                Message = $"{ex.InnerException.GetType().FullName}: {ex.InnerException.Message}",
                StartupStage = host.GetHealthResponse().StartupStage,
            },
            statusCode: StatusCodes.Status500InternalServerError);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Unexpected G5 advisor failure");
        return Results.Json(
            new ErrorResponse
            {
                Error = "internal_error",
                Message = ex.Message,
                StartupStage = host.GetHealthResponse().StartupStage,
            },
            statusCode: StatusCodes.Status500InternalServerError);
    }
});

app.Run();
