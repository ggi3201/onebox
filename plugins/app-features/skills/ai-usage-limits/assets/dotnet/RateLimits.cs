using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;

namespace MyApp.Api.Usage;

/// <summary>
/// Rate limits for AI endpoints, per ACCOUNT, and the forwarded-headers setup
/// that makes per-IP limits (sign-up, webhooks) mean per client.
///
///   builder.Services.AddAiRateLimits(builder.Configuration);
///   app.UseAiForwardedHeaders();                        // first in the pipeline
///   app.UseRateLimiter();                               // after auth
///   app.MapAgentChat().RequireRateLimiting(AiRateLimits.Agent);
/// </summary>
public static partial class AiRateLimits
{
    public const string Agent = "agent";

    public static IServiceCollection AddAiRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var perHour = config.GetValue("RateLimits:AgentPerHour", 30);

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = async (ctx, ct) =>
            {
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                    ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString(CultureInfo.InvariantCulture);
                await ctx.HttpContext.Response.WriteAsJsonAsync(
                    new { code = "rateLimited", message = "Too many questions. Give it a minute." }, ct);
            };

            // Per account, never per IP: every phone on a mobile carrier can
            // share one address, and behind a proxy EVERY request shares one.
            // "sub", not ClaimTypes.NameIdentifier: the API sets MapInboundClaims = false
            // (backend.md, "Protect the API", step 7).
            o.AddPolicy(Agent, http => RateLimitPartition.GetFixedWindowLimiter(
                http.User.FindFirstValue("sub") ?? "anonymous",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = perHour,
                    Window = TimeSpan.FromHours(1),
                    QueueLimit = 0,
                }));
        });
        return services;
    }

    /// <summary>
    /// Behind Traefik (and a Cloudflare Tunnel), <c>RemoteIpAddress</c> is the
    /// PROXY for every request. A per-IP limit keyed on it is one global limit:
    /// twenty sign-ups an hour, shared by the whole internet. A smoke test from
    /// one address cannot tell a working per-IP limit from a broken global one.
    ///
    /// Config:
    ///   Network__TrustedProxies=172.18.0.0/16   (the proxy network: docker network inspect proxy)
    ///   Network__ForwardLimit=2                 (default)
    ///
    /// ForwardLimit 2, because through the tunnel the header arrives as
    /// <c>client, gateway</c>. Reading one entry gives the Docker gateway, the
    /// same for everyone. Cloudflare overwrites the header, so a client cannot
    /// forge it through the tunnel; if the box ALSO accepts direct traffic on
    /// 443, a forged header on a direct request is read. Close direct ingress,
    /// or set the limit to 1 when there is no tunnel.
    ///
    /// Pass <c>app</c>, and read <c>app.Configuration</c>: after <c>Build()</c>
    /// the builder's configuration returns empty for every key, which silently
    /// turns this into a no-op.
    /// </summary>
    public static WebApplication UseAiForwardedHeaders(this WebApplication app)
    {
        var entries = (app.Configuration["Network:TrustedProxies"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (entries.Length == 0)
        {
            LogNoTrustedProxies(app.Logger);
            return app;
        }

        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor,
            ForwardLimit = app.Configuration.GetValue("Network:ForwardLimit", 2),
        };
        // Cleared, not added to: the defaults trust loopback.
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (var entry in entries)
        {
            if (entry.Contains('/')) options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(entry));
            else if (IPAddress.TryParse(entry, out var ip)) options.KnownProxies.Add(ip);
            // A value that cannot be parsed would be ignored, leaving everyone in one bucket. Fail instead.
            else throw new InvalidOperationException($"Network:TrustedProxies has '{entry}', which is not an IP or CIDR.");
        }

        app.UseForwardedHeaders(options);
        LogTrustedProxies(app.Logger, string.Join(", ", entries));
        return app;
    }

    // Source-generated log lines. The strict analyzers (CA1848) refuse
    // log.LogInformation(...) and the other extension methods.
    [LoggerMessage(Level = LogLevel.Warning, Message = "Network:TrustedProxies is empty: per-IP limits see the proxy, not the client.")]
    private static partial void LogNoTrustedProxies(ILogger log);

    [LoggerMessage(Level = LogLevel.Information, Message = "Trusting X-Forwarded-For from {Proxies}")]
    private static partial void LogTrustedProxies(ILogger log, string proxies);
}
