using System.Security.Claims;

namespace MyApp.Api.Agent;

/// <summary>
/// <c>POST /api/agent/chat</c>: one authenticated POST in, a typed SSE stream out.
///
/// SSE, not SignalR or WebSockets. A hub needs a connection lifecycle,
/// reconnection and the access_token-in-the-query-string dance. This is one
/// POST that answers slowly, and your normal auth covers it.
/// </summary>
public static partial class AgentChatEndpoint
{
    public static RouteHandlerBuilder MapAgentChat(this IEndpointRouteBuilder app, string path = "/api/agent/chat") =>
        app.MapPost(path, Handle).RequireAuthorization();
    // Add .RequireRateLimiting("agent") once the ai-usage-limits skill has added the policy.

    private static async Task<IResult> Handle(
        AgentRequest request,
        // IServiceProvider, NOT AgentLoop. See AgentRegistration: a model client
        // in the signature is built before the checks below can run.
        IServiceProvider services,
        AgentConcurrency concurrency,
        IAgentAccess access,
        HttpContext http,
        ILoggerFactory loggers)
    {
        var ct = http.RequestAborted;
        // "sub", not ClaimTypes.NameIdentifier: the API sets MapInboundClaims = false
        // (backend.md, "Protect the API", step 7).
        var userId = http.User.FindFirstValue("sub");
        if (string.IsNullOrEmpty(userId)) return Results.Unauthorized();

        /*
         * Every refusal happens BEFORE the first byte. Once a frame is flushed,
         * the status is 200 and committed, and a refusal can only be an apology
         * inside a response the client was told had succeeded. Order: cheap to
         * expensive.
         */
        if (AgentLimits.Violation(request) is { } violation)
            return Results.BadRequest(new { code = "badRequest", message = $"Request rejected: {violation}." });

        // Subscription, budget, consent. A code as well as a status: "buy this"
        // and "wait until the 1st" cannot be told apart by a status alone.
        if (await access.CheckAsync(userId, ct) is { } denial)
            return Results.Json(new { code = denial.Code, message = denial.Message }, statusCode: denial.Status);

        using var slot = concurrency.TryEnter(userId);
        if (slot is null)
            return Results.Json(new { code = AgentErrorCodes.RateLimited, message = "Too many answers at once." },
                statusCode: StatusCodes.Status429TooManyRequests);

        // Only now, once the request is worth serving.
        var loop = services.GetRequiredService<AgentLoop>();
        var log = loggers.CreateLogger("Agent");

        var response = http.Response;
        response.Headers.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        // Reverse proxies buffer event streams unless told not to. Without this
        // (and the flush below) the whole "stream" arrives at once at the end,
        // which passes every test that only checks the final text.
        response.Headers["X-Accel-Buffering"] = "no";

        // One writer at a time: the keep-alive timer and the event loop share
        // the response body.
        var gate = new SemaphoreSlim(1, 1);
        async Task Write(string frame)
        {
            await gate.WaitAsync(ct);
            try
            {
                await response.WriteAsync(frame, ct);
                await response.Body.FlushAsync(ct);
            }
            finally { gate.Release(); }
        }

        await Write(Sse.KeepAlive); // commits 200 and the headers at once
        var lastWrite = DateTime.UtcNow;
        using var stopKeepAlive = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var keepAlive = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(AgentLimits.KeepAliveEvery);
            try
            {
                while (await timer.WaitForNextTickAsync(stopKeepAlive.Token))
                    if (DateTime.UtcNow - lastWrite >= AgentLimits.KeepAliveEvery)
                        await Write(Sse.KeepAlive);
            }
            catch (OperationCanceledException) { }
            catch (Exception e) { LogKeepAliveStopped(log, e); }
        });

        try
        {
            await foreach (var evt in loop.RunAsync(request, userId, ct))
            {
                await Write(Sse.Frame(evt));
                lastWrite = DateTime.UtcNow;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // They closed the sheet or tapped stop. Nobody is left to tell.
            LogCancelled(log);
        }
        catch (OperationCanceledException)
        {
            // The client is still there, so this was the run deadline.
            LogDeadline(log, AgentLimits.RunDeadline.TotalSeconds);
            await TryWrite(Write, new RunError(AgentErrorCodes.Timeout, "That took too long. Please try again."), log);
        }
        catch (Exception e)
        {
            // Headers are sent, so the failure goes IN the stream. A code and a
            // plain sentence, never e.Message: database and transport errors
            // carry host names and internal types.
            LogRunFailed(log, e);
            await TryWrite(Write, new RunError(AgentErrorCodes.ProviderError,
                "The assistant could not finish that. Please try again."), log);
        }
        finally
        {
            stopKeepAlive.Cancel();
            await keepAlive;
        }

        return Results.Empty;
    }

    private static async Task TryWrite(Func<string, Task> write, AgentEvent evt, ILogger log)
    {
        try { await write(Sse.Frame(evt)); }
        catch (Exception e) { LogReportFailed(log, e); }
    }

    // Source-generated log lines. The strict analyzers (CA1848) refuse
    // log.LogInformation(...) and the other extension methods.
    [LoggerMessage(Level = LogLevel.Debug, Message = "Keep-alive stopped")]
    private static partial void LogKeepAliveStopped(ILogger log, Exception error);

    [LoggerMessage(Level = LogLevel.Information, Message = "Agent run cancelled by the client")]
    private static partial void LogCancelled(ILogger log);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Agent run hit the {Deadline}s deadline")]
    private static partial void LogDeadline(ILogger log, double deadline);

    [LoggerMessage(Level = LogLevel.Error, Message = "Agent run failed")]
    private static partial void LogRunFailed(ILogger log, Exception error);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Could not report the failure to the client")]
    private static partial void LogReportFailed(ILogger log, Exception error);
}
