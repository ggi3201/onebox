using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace MyApp.Api.Usage;

/// <summary>
/// The rate limit for AI endpoints: a fixed number of runs per ACCOUNT per hour.
///
///   builder.Services.AddAiRateLimits(builder.Configuration);
///   app.MapAgentChat().RequireRateLimiting(AiRateLimits.Agent);
///
/// It adds one policy to the app's own rate limiter (backend.md, "Protect the
/// API", step 2: <c>AddRateLimiter</c> and <c>UseRateLimiter</c>). It does not
/// replace the app's global limit, its "auth" policy or its <c>OnRejected</c>,
/// and it does not touch the forwarded headers: the app's step 1 setup, from
/// <c>TRUSTED_PROXIES</c>, gives the real client IP.
/// </summary>
public static class AiRateLimits
{
    public const string Agent = "agent";

    public static IServiceCollection AddAiRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var perHour = config.GetValue("RateLimits:AgentPerHour", 30);
        // Configure, not AddRateLimiter: it adds to the options the app already set.
        services.Configure<RateLimiterOptions>(o => o.AddPolicy(Agent, new AgentPolicy(perHour)));
        return services;
    }

    private sealed class AgentPolicy(int perHour) : IRateLimiterPolicy<string>
    {
        // Used instead of the app's OnRejected, for this policy only. The app
        // shows this message, and tells it apart from 429 budgetExhausted by the code.
        public Func<OnRejectedContext, CancellationToken, ValueTask>? OnRejected { get; } = async (ctx, ct) =>
        {
            ctx.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            await ctx.HttpContext.Response.WriteAsJsonAsync(
                new { code = "rateLimited", message = "Too many questions this hour. Try again later." }, ct);
        };

        // Per account: every phone on a mobile carrier can share one address.
        // "sub", not ClaimTypes.NameIdentifier: the API sets MapInboundClaims = false
        // (backend.md, "Protect the API", step 7). Without a user (an app with no
        // accounts, references/no-accounts.md), per client IP.
        public RateLimitPartition<string> GetPartition(HttpContext http) =>
            RateLimitPartition.GetFixedWindowLimiter(
                http.User.FindFirstValue("sub") is { } id ? "u:" + id : "ip:" + http.Connection.RemoteIpAddress,
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = perHour,
                    Window = TimeSpan.FromHours(1),
                    QueueLimit = 0,
                });
    }
}
