namespace MyApp.Api.Agent;

/// <summary>
/// Where a run's spend goes. The <c>ai-usage-limits</c> skill replaces this
/// with a Postgres counter that also enforces a monthly budget. Until then the
/// spend is only logged, which is still better than not knowing.
/// </summary>
public interface IUsageRecorder
{
    Task RecordAsync(string userId, string model, int input, int cached, int output, CancellationToken ct);
}

public sealed partial class LogOnlyUsageRecorder(ILogger<LogOnlyUsageRecorder> log) : IUsageRecorder
{
    public Task RecordAsync(string userId, string model, int input, int cached, int output, CancellationToken ct)
    {
        LogUsage(log, userId, model, input, cached, output);
        return Task.CompletedTask;
    }

    // Source-generated, because the strict analyzers (CA1848) refuse log.LogInformation(...).
    [LoggerMessage(Level = LogLevel.Information, Message = "Agent usage {User} {Model}: in={Input} cached={Cached} out={Output}")]
    private static partial void LogUsage(ILogger log, string user, string model, int input, int cached, int output);
}

/// <summary>A refusal before the stream opens: a status code with a code the client knows.</summary>
public sealed record AgentDenial(int Status, string Code, string Message);

/// <summary>
/// May this user reach a model right now? Subscription, budget and AI consent
/// all answer here. The <c>ai-usage-limits</c> and <c>ai-consent</c> skills add
/// the real checks. The app's own gates are presentation; this is enforcement.
/// </summary>
public interface IAgentAccess
{
    /// <summary>Null means allowed.</summary>
    Task<AgentDenial?> CheckAsync(string userId, CancellationToken ct);
}

public sealed class AllowAllAgentAccess : IAgentAccess
{
    public Task<AgentDenial?> CheckAsync(string userId, CancellationToken ct) => Task.FromResult<AgentDenial?>(null);
}
