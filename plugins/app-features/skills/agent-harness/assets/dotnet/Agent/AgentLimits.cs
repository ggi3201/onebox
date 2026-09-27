using Microsoft.Extensions.Caching.Memory;

namespace MyApp.Api.Agent;

/// <summary>
/// What one request may ask the model to read, and how long it may take.
///
/// A rate limiter counts REQUESTS. It says nothing about their size, and every
/// field below is copied into a prompt that is billed by the token. The numbers
/// sit far above what the app sends; they bound the pathological case.
/// </summary>
public static class AgentLimits
{
    /// <summary>
    /// The client trims its history to fewer than this (chat-feature
    /// <c>MAX_HISTORY</c>). If the client does not trim, a long chat starts
    /// failing with 400 after about twenty exchanges.
    /// </summary>
    public const int MaxMessages = 40;
    public const int MaxContentChars = 16_000;
    public const int MaxTotalChars = 60_000;

    /// <summary>A base64 photo, about 4 MB decoded. The client sends about 200 KB.</summary>
    public const int MaxImageChars = 5_500_000;

    /// <summary>
    /// Wall clock for one run, chat or job. Without it, a provider that accepts
    /// the connection and then stops sending holds the request until the HTTP
    /// client's own timeout. Keep it under your proxy's idle limit (Cloudflare
    /// closes a response after about 100 s with no bytes; the keep-alive helps,
    /// but a run this long is broken anyway).
    /// </summary>
    public static readonly TimeSpan RunDeadline = TimeSpan.FromSeconds(90);

    /// <summary>One tool call. A slow database query or web fetch must not eat the run.</summary>
    public static readonly TimeSpan ToolTimeout = TimeSpan.FromSeconds(20);

    /// <summary>How often to send an SSE comment while nothing else is flowing.</summary>
    public static readonly TimeSpan KeepAliveEvery = TimeSpan.FromSeconds(15);

    /// <summary>
    /// Open runs per user. Without it, one account can hold all its hourly
    /// permits open at once: that many SSE connections, each with a database
    /// connection and an upstream request.
    /// </summary>
    public const int MaxConcurrentPerUser = 3;

    /// <summary>Null when the request is in bounds, else a short reason for a 400.</summary>
    public static string? Violation(AgentRequest request)
    {
        if (request.Messages is null || request.Messages.Count == 0) return "no messages";
        if (request.Messages.Count > MaxMessages) return $"more than {MaxMessages} messages";

        long prose = 0;
        foreach (var turn in request.Messages)
        {
            if (turn.Role is not ("user" or "assistant")) return "a message with an unknown role";
            var content = turn.Content ?? "";
            if (content.Length > MaxContentChars) return "a message over the size limit";
            if (turn.Image is { Length: > MaxImageChars }) return "an image over the size limit";

            // A photo from the phone, never a URL. The provider fetches a URL
            // on your key, and the size cap above measures the string, not what
            // it points at.
            if (!string.IsNullOrEmpty(turn.Image)
                && (!turn.Image.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)
                    || !turn.Image.Contains(";base64,", StringComparison.Ordinal)))
                return "an image that is not a photo";

            prose += content.Length;
        }

        return prose > MaxTotalChars ? "a conversation over the size limit" : null;
    }
}

/// <summary>
/// Open runs per user, in memory. Backed by <see cref="IMemoryCache"/> so that
/// entries for users who went away expire by themselves. In memory means ONE
/// API instance; with two, move this to Postgres or Redis.
/// </summary>
public sealed class AgentConcurrency(IMemoryCache cache)
{
    private static readonly object Gate = new();

    /// <summary>Null when the user is at the limit. Dispose to release.</summary>
    public IDisposable? TryEnter(string userId)
    {
        var key = $"agent:inflight:{userId}";
        lock (Gate)
        {
            var current = cache.Get<int?>(key) ?? 0;
            if (current >= AgentLimits.MaxConcurrentPerUser) return null;
            Set(key, current + 1);
        }
        return new Slot(this, key);
    }

    private void Release(string key)
    {
        lock (Gate)
        {
            var current = cache.Get<int?>(key) ?? 0;
            if (current <= 1) cache.Remove(key);
            else Set(key, current - 1);
        }
    }

    // Expires well past the deadline, so a path that forgets to dispose cannot
    // lock an account out of its own chat for good.
    private void Set(string key, int value) =>
        cache.Set(key, value, AgentLimits.RunDeadline + TimeSpan.FromMinutes(5));

    private sealed class Slot(AgentConcurrency owner, string key) : IDisposable
    {
        private int _disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0) owner.Release(key);
        }
    }
}
