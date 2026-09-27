using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Jobs;

/// <summary>
/// Runs queued jobs, one at a time per API instance, inside the API process.
///
///   builder.Services.AddHostedService&lt;JobWorker&gt;();
///   builder.Services.AddScoped&lt;IJobHandler, ImportHandler&gt;();
///
/// At-most-once for jobs with side effects: a worker that dies mid-job leaves
/// a lease that expires, and the sweep FAILS that job (or re-queues it when
/// the handler says <see cref="IJobHandler.SafeToRetry"/>). It never replays
/// an import that may already have created its row.
/// </summary>
public sealed class JobWorker(IServiceScopeFactory scopes, ILogger<JobWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        var nextSweep = DateTime.MinValue;
        var nextCleanup = DateTime.MinValue;

        while (!stopping.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.UtcNow;
                if (now >= nextSweep) { await SweepExpiredAsync(stopping); nextSweep = now.AddSeconds(30); }
                if (now >= nextCleanup) { await CleanupAsync(stopping); nextCleanup = now.AddHours(12); }

                if (await ClaimAsync(stopping) is { } claim) await RunAsync(claim.Job, claim.Lease, stopping);
                else await Task.Delay(JobPolicy.Idle, stopping);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                // A database blip must not kill the worker. Queued jobs stay queued.
                log.LogError(e, "Job worker loop failed");
                await Task.Delay(JobPolicy.Idle, stopping);
            }
        }
    }

    /// <summary>
    /// Claim the oldest queued job with ONE conditional update. Two instances
    /// (during a rolling deploy) can both see the row; only one update matches
    /// <c>Status = Queued</c>.
    /// </summary>
    private async Task<(Job Job, Guid Lease)?> ClaimAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var kinds = scope.ServiceProvider.GetServices<IJobHandler>().Select(h => h.Kind).ToList();

        var candidates = await db.Set<Job>().AsNoTracking()
            .Where(j => j.Status == JobStatus.Queued && kinds.Contains(j.Kind))
            .OrderBy(j => j.CreatedAt).Select(j => j.Id).Take(5).ToListAsync(ct);

        foreach (var id in candidates)
        {
            var lease = Guid.NewGuid();
            var now = DateTime.UtcNow;
            var claimed = await db.Set<Job>()
                .Where(j => j.Id == id && j.Status == JobStatus.Queued)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Running)
                    .SetProperty(j => j.LeaseId, lease)
                    .SetProperty(j => j.LeaseExpiresAt, now + JobPolicy.Lease)
                    .SetProperty(j => j.StartedAt, now)
                    .SetProperty(j => j.Attempts, j => j.Attempts + 1), ct);
            if (claimed == 1)
                return (await db.Set<Job>().AsNoTracking().SingleAsync(j => j.Id == id, ct), lease);
        }
        return null;
    }

    private async Task RunAsync(Job job, Guid lease, CancellationToken stopping)
    {
        using var scope = scopes.CreateScope();
        var handler = scope.ServiceProvider.GetServices<IJobHandler>().Single(h => h.Kind == job.Kind);
        using var work = CancellationTokenSource.CreateLinkedTokenSource(stopping);
        using var stopBeat = new CancellationTokenSource();
        var beat = HeartbeatAsync(job.Id, lease, work, stopBeat.Token);

        try
        {
            var result = await handler.RunAsync(job, new FencedProgress(scopes, job.Id, lease), work.Token);
            if (await FinishAsync(job.Id, lease, JobStatus.Completed, result.GetRawText(), null))
            {
                job.Status = JobStatus.Completed;
                job.Result = result.GetRawText();
                // After the fenced write, never before: do not announce what may not have landed.
                var notifier = scope.ServiceProvider.GetService<IJobNotifier>();
                if (notifier is not null) await notifier.CompletedAsync(job, CancellationToken.None);
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested)
        {
            // The API is shutting down mid-job. Same rule as a crash.
            await InterruptedAsync(job.Id, lease, handler.SafeToRetry);
        }
        catch (OperationCanceledException)
        {
            // Cancelled from the app, or the lease was lost. That transition
            // was already written by whoever won; do not overwrite it.
            log.LogInformation("Job {Job} stopped: no longer ours", job.Id);
        }
        catch (JobFailed f)
        {
            await FinishAsync(job.Id, lease, JobStatus.Failed, null, f.Message);
        }
        catch (Exception e)
        {
            log.LogError(e, "Job {Job} ({Kind}) failed", job.Id, job.Kind);
            await FinishAsync(job.Id, lease, JobStatus.Failed, null, "That did not work. Please try again.");
        }
        finally
        {
            stopBeat.Cancel();
            await beat;
        }
    }

    /// <summary>
    /// Renew the lease every few seconds. A renewal that matches zero rows
    /// means cancelled or taken over: stop the work. A renewal that THROWS (a
    /// database blip) is retried until the last confirmed expiry, then stops.
    /// </summary>
    private async Task HeartbeatAsync(Guid id, Guid lease, CancellationTokenSource work, CancellationToken stop)
    {
        var confirmedUntil = DateTime.UtcNow + JobPolicy.Lease;
        using var timer = new PeriodicTimer(JobPolicy.Heartbeat);
        try
        {
            while (await timer.WaitForNextTickAsync(stop))
            {
                // Computed BEFORE the write, so the local idea of the expiry is
                // never later than the one in the database.
                var next = DateTime.UtcNow + JobPolicy.Lease;
                try
                {
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                    var renewed = await db.Set<Job>()
                        .Where(j => j.Id == id && j.LeaseId == lease && j.Status == JobStatus.Running)
                        .ExecuteUpdateAsync(s => s.SetProperty(j => j.LeaseExpiresAt, next), stop);
                    if (renewed == 0) { work.Cancel(); return; }
                    confirmedUntil = next;
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    if (DateTime.UtcNow >= confirmedUntil - JobPolicy.Heartbeat)
                    {
                        log.LogWarning(e, "Could not renew job {Job} before its lease ran out; stopping it", id);
                        work.Cancel();
                        return;
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>
    /// The one fenced way a worker ends a job. Returns false when the job was
    /// no longer ours. A move to Failed gives the quota back, once.
    /// </summary>
    private async Task<bool> FinishAsync(Guid id, Guid lease, JobStatus status, string? result, string? error)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var now = DateTime.UtcNow;
        var done = await db.Set<Job>()
            .Where(j => j.Id == id && j.LeaseId == lease && j.Status == JobStatus.Running)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, status)
                .SetProperty(j => j.Result, result)
                .SetProperty(j => j.Error, error)
                .SetProperty(j => j.Progress, (string?)null)
                .SetProperty(j => j.CompletedAt, now)
                .SetProperty(j => j.LeaseId, (Guid?)null)
                .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null));
        if (done == 1 && status == JobStatus.Failed) await RefundOnceAsync(scope.ServiceProvider, id);
        return done == 1;
    }

    private async Task InterruptedAsync(Guid id, Guid lease, bool safeToRetry)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        if (safeToRetry)
        {
            await db.Set<Job>()
                .Where(j => j.Id == id && j.LeaseId == lease && j.Status == JobStatus.Running && j.Attempts < JobPolicy.MaxAttempts)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Queued)
                    .SetProperty(j => j.LeaseId, (Guid?)null)
                    .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null));
        }
        await FinishAsync(id, lease, JobStatus.Failed, null, "It was interrupted. Please start it again.");
    }

    /// <summary>
    /// Jobs whose worker died. One row at a time, each fenced on the lease it
    /// had, so a refund happens once and a worker that comes back loses.
    /// </summary>
    private async Task SweepExpiredAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var retryable = scope.ServiceProvider.GetServices<IJobHandler>().Where(h => h.SafeToRetry).Select(h => h.Kind).ToHashSet();
        var now = DateTime.UtcNow;

        var expired = await db.Set<Job>().AsNoTracking()
            .Where(j => j.Status == JobStatus.Running && (j.LeaseExpiresAt == null || j.LeaseExpiresAt <= now))
            .Select(j => new { j.Id, j.LeaseId, j.Kind, j.Attempts }).Take(100).ToListAsync(ct);

        foreach (var j in expired)
        {
            if (j.LeaseId is not { } lease) continue;
            if (retryable.Contains(j.Kind) && j.Attempts < JobPolicy.MaxAttempts)
            {
                await db.Set<Job>().Where(x => x.Id == j.Id && x.LeaseId == lease && x.Status == JobStatus.Running)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(x => x.Status, JobStatus.Queued)
                        .SetProperty(x => x.LeaseId, (Guid?)null)
                        .SetProperty(x => x.LeaseExpiresAt, (DateTime?)null), ct);
            }
            else
            {
                await FinishAsync(j.Id, lease, JobStatus.Failed, null, "It was interrupted. Please start it again.");
            }
        }
        if (expired.Count > 0) log.LogWarning("Swept {Count} jobs with expired leases", expired.Count);
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var cutoff = DateTime.UtcNow - JobPolicy.Keep;
        await db.Set<Job>()
            .Where(j => (j.Status == JobStatus.Completed || j.Status == JobStatus.Failed || j.Status == JobStatus.Cancelled)
                && j.CompletedAt < cutoff)
            .ExecuteDeleteAsync(ct);
    }

    /// <summary>Flip <c>Refunded</c> false → true; only the call that flips it refunds.</summary>
    internal static async Task RefundOnceAsync(IServiceProvider services, Guid id)
    {
        var refunds = services.GetService<IJobRefunds>();
        if (refunds is null) return;
        var db = services.GetRequiredService<AppDb>();
        var flipped = await db.Set<Job>().Where(j => j.Id == id && !j.Refunded)
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.Refunded, true));
        if (flipped == 1)
            await refunds.RefundAsync(await db.Set<Job>().AsNoTracking().SingleAsync(j => j.Id == id), CancellationToken.None);
    }

    private sealed class FencedProgress(IServiceScopeFactory scopes, Guid id, Guid lease) : IJobProgress
    {
        public async Task<bool> ReportAsync(string line, CancellationToken ct)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            return await db.Set<Job>()
                .Where(j => j.Id == id && j.LeaseId == lease && j.Status == JobStatus.Running)
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.Progress, line.Length > 200 ? line[..200] : line), ct) == 1;
        }
    }
}
