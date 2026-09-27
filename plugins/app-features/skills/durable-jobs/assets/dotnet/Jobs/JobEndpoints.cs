using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Agent;

namespace MyApp.Api.Jobs;

/// <summary>
///   POST   /api/jobs/{kind}   start one: 202 + the job
///   GET    /api/jobs/{id}     poll it
///   DELETE /api/jobs/{id}     cancel it (idempotent)
///
/// Give polling its own, looser rate limit. Charging polls to the AI bucket
/// starves the AI features themselves.
/// </summary>
public static class JobEndpoints
{
    public static RouteGroupBuilder MapJobs(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/jobs").RequireAuthorization();
        g.MapPost("/{kind}", Start);          // add .RequireRateLimiting(AiRateLimits.Agent) for AI jobs
        g.MapGet("/{id:guid}", Get);          // a separate, looser polling policy
        g.MapDelete("/{id:guid}", Cancel);
        return g;
    }

    public sealed record StartBody(JsonElement Input);

    public sealed record JobView(Guid Id, string Kind, string Status, string? Progress, JsonElement? Result, string? Error,
        DateTime CreatedAt, DateTime? CompletedAt);

    private static JobView View(Job j) => new(j.Id, j.Kind, j.Status.ToString(), j.Progress,
        j.Result is null ? null : JsonDocument.Parse(j.Result).RootElement, j.Error, j.CreatedAt, j.CompletedAt);

    private static async Task<IResult> Start(string kind, StartBody body, ClaimsPrincipal user, AppDb db,
        IEnumerable<IJobHandler> handlers, IServiceProvider services, CancellationToken ct)
    {
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Results.Unauthorized();

        var handler = handlers.FirstOrDefault(h => h.Kind == kind);
        if (handler is null) return Results.NotFound();
        if (handler.Validate(body.Input) is { } bad) return Results.BadRequest(new { code = "badRequest", message = bad });

        // The same gate as the chat (subscription, budget, consent), when the
        // agent-harness seams are registered. Before anything is queued.
        if (services.GetService<IAgentAccess>() is { } access && await access.CheckAsync(userId, ct) is { } denial)
            return Results.Json(new { code = denial.Code, message = denial.Message }, statusCode: denial.Status);

        // A count-based quota (for example 3 imports a week on the free plan)
        // goes here: take one now; IJobRefunds gives it back if the job fails.

        var job = new Job
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = kind,
            Input = body.Input.GetRawText(),
            Status = JobStatus.Queued,
            Progress = "Waiting to start",
            CreatedAt = DateTime.UtcNow,
        };
        db.Add(job);
        await db.SaveChangesAsync(ct);
        return Results.Accepted($"/api/jobs/{job.Id}", View(job));
    }

    private static async Task<IResult> Get(Guid id, ClaimsPrincipal user, AppDb db, CancellationToken ct)
    {
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
        // Scoped to the caller in the SAME query: never reveal that someone
        // else's job id exists.
        var job = await db.Set<Job>().AsNoTracking().FirstOrDefaultAsync(j => j.Id == id && j.UserId == userId, ct);
        return job is null ? Results.NotFound() : Results.Ok(View(job));
    }

    private static async Task<IResult> Cancel(Guid id, ClaimsPrincipal user, AppDb db, IServiceProvider services, CancellationToken ct)
    {
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
        var now = DateTime.UtcNow;

        // Clearing the lease is what stops a running worker: its next
        // heartbeat renews zero rows and it cancels its own work.
        var wasQueued = await db.Set<Job>()
            .Where(j => j.Id == id && j.UserId == userId && j.Status == JobStatus.Queued)
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, JobStatus.Cancelled).SetProperty(j => j.CompletedAt, now), ct);
        var wasRunning = wasQueued == 0 && await db.Set<Job>()
            .Where(j => j.Id == id && j.UserId == userId && j.Status == JobStatus.Running)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Cancelled)
                .SetProperty(j => j.CompletedAt, now)
                .SetProperty(j => j.LeaseId, (Guid?)null)
                .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null), ct) == 1;

        // Nothing ran, so nothing was spent: give the quota back. A running job
        // may already have spent money; whether to refund that is your call.
        if (wasQueued == 1) await JobWorker.RefundOnceAsync(services, id);

        if (wasQueued == 1 || wasRunning) return Results.NoContent();
        var exists = await db.Set<Job>().AsNoTracking().AnyAsync(j => j.Id == id && j.UserId == userId, ct);
        return exists ? Results.NoContent() : Results.NotFound();
    }
}
