using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Jobs;

public enum JobStatus { Queued, Running, Completed, Failed, Cancelled }

/// <summary>
/// One piece of slow work (an import, a long model call, an image job) that
/// must outlive the HTTP request, the app being closed, and an API restart.
/// Rows are the queue: Postgres is already there, so no broker is needed on one box.
/// </summary>
public class Job
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = "";
    /// <summary>Which <see cref="IJobHandler"/> runs it, for example "import".</summary>
    public string Kind { get; set; } = "";
    /// <summary>What to do, as JSON. Keep it small: a URL and a few fields, not a 5 MB photo.</summary>
    public string Input { get; set; } = "{}";
    public JobStatus Status { get; set; }
    /// <summary>One line for the person ("Reading the page"). Safe to show.</summary>
    public string? Progress { get; set; }
    /// <summary>What it produced, as JSON (for example the id of the created row).</summary>
    public string? Result { get; set; }
    /// <summary>A sentence safe to show. Never an exception message; that goes to the log.</summary>
    public string? Error { get; set; }

    /// <summary>
    /// The FENCE. Every write by a worker says "WHERE LeaseId = mine". If
    /// someone else now owns the job, or it was cancelled, the write changes
    /// zero rows and the worker stops.
    /// </summary>
    public Guid? LeaseId { get; set; }
    public DateTime? LeaseExpiresAt { get; set; }
    public int Attempts { get; set; }
    /// <summary>Set by the one transition that gave the quota back, so it happens once.</summary>
    public bool Refunded { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public static class JobModel
{
    public static void Map(ModelBuilder b) =>
        b.Entity<Job>(e =>
        {
            e.ToTable("Jobs");
            e.HasKey(j => j.Id);
            e.Property(j => j.Status).HasConversion<string>();
            e.Property(j => j.Kind).HasMaxLength(64);
            e.HasIndex(j => new { j.Status, j.CreatedAt });   // the claim query
            e.HasIndex(j => new { j.UserId, j.CreatedAt });
        });
}

public static class JobPolicy
{
    /// <summary>How long a claim lasts without a heartbeat. Long enough for a slow model call.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(5);
    /// <summary>
    /// Heartbeat. Short, because it is also how a Cancel from the app reaches a
    /// running job: the renewal fails and the work stops within a few seconds.
    /// </summary>
    public static readonly TimeSpan Heartbeat = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan Idle = TimeSpan.FromSeconds(2);
    public static readonly TimeSpan Keep = TimeSpan.FromDays(30);
    public const int MaxAttempts = 3;

    public static bool IsTerminal(JobStatus s) => s is JobStatus.Completed or JobStatus.Failed or JobStatus.Cancelled;
}

/// <summary>What a handler reports while it works.</summary>
public interface IJobProgress
{
    /// <summary>Fenced: returns false when the job is no longer ours; stop then.</summary>
    Task<bool> ReportAsync(string line, CancellationToken ct);
}

/// <summary>
/// A job kind and its retry rule. <see cref="JobRegistration.AddJobHandler{T}"/>
/// registers it next to the handler, so the worker and the start route read it
/// without building a handler.
/// </summary>
/// <param name="SafeToRetry">
/// True only when running it twice is harmless (it creates nothing, or it
/// checks first). Then a job whose worker died is queued again. False (the
/// default for anything that creates rows or spends money): a job whose worker
/// died is FAILED, and the person can start it again.
/// </param>
public sealed record JobKind(string Kind, bool SafeToRetry);

public static class JobRegistration
{
    /// <summary>
    /// One line per kind:
    ///   builder.Services.AddJobHandler&lt;ImportHandler&gt;("import", safeToRetry: false);
    /// A handler is built only for its own job. One that needs a setting the
    /// server lacks (the model key) then fails its own kind, not every kind.
    /// </summary>
    public static IServiceCollection AddJobHandler<T>(this IServiceCollection services, string kind, bool safeToRetry)
        where T : class, IJobHandler
    {
        services.AddSingleton(new JobKind(kind, safeToRetry));
        services.AddKeyedScoped<IJobHandler, T>(kind);
        return services;
    }
}

/// <summary>
/// Makes the job's owner the current user in the job's DI scope, so the
/// per-user query filter and owner stamp (backend.md, "Keep each user's data
/// apart") work in the worker too. Without it, CurrentUser.Id throws there.
/// Implement it on CurrentUser with its ActAs method, and register:
///   builder.Services.AddScoped&lt;IJobUser&gt;(sp => sp.GetRequiredService&lt;CurrentUser&gt;());
/// </summary>
public interface IJobUser
{
    void ActAs(string userId);
}

public interface IJobHandler
{
    /// <summary>
    /// Do the work and return the result as JSON. Pass <paramref name="ct"/> to
    /// EVERY call inside, including model calls: it is how cancel and a lost
    /// lease stop the work. Throw <see cref="JobFailedException"/> with a sentence for
    /// the person; any other exception shows a generic sentence.
    /// </summary>
    Task<JsonElement> RunAsync(Job job, IJobProgress progress, CancellationToken ct);

    /// <summary>Null when the input is acceptable, else a reason for a 400. Runs before anything is spent.</summary>
    string? Validate(JsonElement input) => null;
}

/// <summary>A failure with a sentence the person may see.</summary>
public sealed class JobFailedException(string userMessage) : Exception(userMessage);

/// <summary>Give back what starting the job took from a quota. Called at most once per job.</summary>
public interface IJobRefunds
{
    Task RefundAsync(Job job, CancellationToken ct);
}

/// <summary>Tell the person it is done, for example with a push notification that opens the result.</summary>
public interface IJobNotifier
{
    Task CompletedAsync(Job job, CancellationToken ct);
}
