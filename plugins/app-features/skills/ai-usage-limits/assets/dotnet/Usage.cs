using System.Globalization;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Agent;
using Npgsql;

namespace MyApp.Api.Usage;

/// <summary>
/// Model prices, from configuration, in dollars per million tokens:
///
///   "Usage": {
///     "MonthlyBudgetUsd": 5,
///     "Prices": {
///       "anthropic/claude-sonnet-5": { "Input": 2.0, "CachedInput": 0.2, "Output": 10.0 }
///     }
///   }
///
/// <c>scripts/prices.sh</c> prints this block from OpenRouter's public list.
///
/// A local table, not the trace store's cost: this number gates the NEXT
/// request, and a budget may not be eventually consistent. The table can drift
/// from the provider's real prices, which is why the budget is a bound on
/// disaster, not an accountant.
/// </summary>
public sealed class ModelPricing(IConfiguration config)
{
    public readonly record struct Rates(decimal Input, decimal CachedInput, decimal Output);

    /// <summary>
    /// The rates for a model, or the DEAREST known rates for one nobody listed.
    /// An unpriced model is someone wiring up a new one and forgetting this
    /// table. Over-counting is the safe direction; free is the one answer that
    /// cannot be right.
    /// </summary>
    public Rates RatesFor(string model)
    {
        var table = config.GetSection("Usage:Prices").GetChildren()
            .ToDictionary(s => s.Key, s => new Rates(
                s.GetValue<decimal>("Input"), s.GetValue<decimal>("CachedInput"), s.GetValue<decimal>("Output")),
                StringComparer.OrdinalIgnoreCase);

        if (table.TryGetValue(model, out var known)) return known;
        if (table.Count == 0)
            throw new InvalidOperationException("Usage:Prices is empty. Run scripts/prices.sh and add your models.");
        return new Rates(table.Values.Max(r => r.Input), table.Values.Max(r => r.CachedInput), table.Values.Max(r => r.Output));
    }

    /// <summary>
    /// Cost in MICRODOLLARS. An integer, because it accumulates for a month and
    /// is compared with a limit; money in a double makes the limit's edge a
    /// rounding question. Rates are $/million and a micro is a millionth of a
    /// dollar, so the millions cancel and this is tokens × rate.
    /// <paramref name="cached"/> is a SUBSET of <paramref name="input"/>.
    /// </summary>
    public long CostMicros(string model, int input, int cached, int output)
    {
        var r = RatesFor(model);
        var c = Math.Clamp(cached, 0, Math.Max(0, input));
        var micros = (input - c) * r.Input + c * r.CachedInput + output * r.Output;
        return (long)Math.Round(micros, MidpointRounding.AwayFromZero);
    }
}

/// <summary>
/// One user's model spend in one calendar month (UTC). The window is UTC on
/// purpose: it must roll exactly once a month for everybody, and nobody plans
/// around it. Key: (UserId, Month).
/// </summary>
public class UserUsage
{
    public string UserId { get; set; } = "";
    /// <summary><c>yyyy-MM</c>, UTC. A string: it names a window, and a date invites local-time arithmetic.</summary>
    public string Month { get; set; } = "";
    public int Runs { get; set; }
    /// <summary>Prompt tokens INCLUDING the cached share, so it matches a trace.</summary>
    public long InputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CostMicros { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed record UsageSnapshot(string Month, int Runs, long CostMicros, long? LimitMicros, DateTime ResetsAt)
{
    public bool Exhausted => LimitMicros is { } limit && CostMicros >= limit;
}

/// <summary>
/// Records spend (the harness calls it through <see cref="IUsageRecorder"/>)
/// and reports the month so far. Register it AFTER <c>AddAgent</c>:
///   builder.Services.AddScoped&lt;ModelPricing&gt;();
///   builder.Services.AddScoped&lt;UsageService&gt;();
///   builder.Services.AddScoped&lt;IUsageRecorder&gt;(sp => sp.GetRequiredService&lt;UsageService&gt;());
/// </summary>
public sealed class UsageService(AppDb db, IConfiguration config, ModelPricing pricing) : IUsageRecorder
{
    public const decimal DefaultMonthlyUsd = 5m;

    public static string MonthOf(DateTime utc) => utc.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    public static DateTime ResetOf(DateTime utc) => new DateTime(utc.Year, utc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);

    /// <summary>
    /// The ceiling in micros, or null for none. Zero or less means NO ceiling,
    /// not "refuse everyone": a typo in config must not lock paying users out.
    /// </summary>
    public long? LimitMicros()
    {
        var usd = config.GetValue("Usage:MonthlyBudgetUsd", DefaultMonthlyUsd);
        return usd <= 0 ? null : (long)Math.Round(usd * 1_000_000m, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Add one run, ATOMICALLY. An INSERT … ON CONFLICT DO UPDATE, not an EF
    /// read-modify-write: two runs of one user finishing together would both
    /// read the same total and one run's spend would be lost, on exactly the
    /// accounts spending fastest.
    /// </summary>
    public async Task RecordAsync(string userId, string model, int input, int cached, int output, CancellationToken ct)
    {
        if (input <= 0 && output <= 0) return; // a failed call that billed nothing is not a run
        var now = DateTime.UtcNow;
        var c = Math.Clamp(cached, 0, Math.Max(0, input));

        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO "UserUsages" ("UserId", "Month", "Runs", "InputTokens", "CachedInputTokens", "OutputTokens", "CostMicros", "UpdatedAt")
            VALUES (@user, @month, 1, @input, @cached, @output, @micros, @now)
            ON CONFLICT ("UserId", "Month") DO UPDATE SET
                "Runs"              = "UserUsages"."Runs" + 1,
                "InputTokens"       = "UserUsages"."InputTokens" + @input,
                "CachedInputTokens" = "UserUsages"."CachedInputTokens" + @cached,
                "OutputTokens"      = "UserUsages"."OutputTokens" + @output,
                "CostMicros"        = "UserUsages"."CostMicros" + @micros,
                "UpdatedAt"         = @now;
            """,
            [
                new NpgsqlParameter("user", userId),
                new NpgsqlParameter("month", MonthOf(now)),
                new NpgsqlParameter("input", (long)input),
                new NpgsqlParameter("cached", (long)c),
                new NpgsqlParameter("output", (long)output),
                new NpgsqlParameter("micros", pricing.CostMicros(model, input, c, output)),
                new NpgsqlParameter("now", now),
            ], ct);
    }

    public async Task<UsageSnapshot> CurrentAsync(string userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var month = MonthOf(now);
        var row = await db.Set<UserUsage>().AsNoTracking()
            .FirstOrDefaultAsync(u => u.UserId == userId && u.Month == month, ct);
        return new UsageSnapshot(month, row?.Runs ?? 0, row?.CostMicros ?? 0, LimitMicros(), ResetOf(now));
    }
}

/// <summary>
/// The EF mapping. Call from your DbContext's OnModelCreating, then add a
/// migration: <c>dotnet ef migrations add UserUsage</c>.
/// Not tenant-filtered: jobs read it without a request user.
/// </summary>
public static class UserUsageModel
{
    public static void Map(ModelBuilder b) =>
        b.Entity<UserUsage>(e =>
        {
            e.ToTable("UserUsages");
            e.HasKey(u => new { u.UserId, u.Month });
        });
}
