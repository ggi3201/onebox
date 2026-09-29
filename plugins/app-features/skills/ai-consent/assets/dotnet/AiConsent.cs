using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Usage;

namespace MyApp.Api.Consent;

/// <summary>
/// The server's record of "yes, send my data to the AI provider", per user,
/// with the version of the text they agreed to.
///
/// Why on the server too: the app's gate can be skipped by an old build, a
/// bug, or a direct API call. The server is where "nothing goes to the
/// provider without a yes" becomes true.
///
/// Rollout: <c>AiConsent:Enforced</c> is false by default. Builds already in
/// the store do not send consent yet. Ship the app version that records it,
/// raise your minimum app version, THEN set Enforced=true.
/// </summary>
public class AiConsentRecord
{
    public string UserId { get; set; } = "";
    public int Version { get; set; }
    public DateTime GrantedAt { get; set; }
}

public static class AiConsentModel
{
    public static void Map(ModelBuilder b) =>
        b.Entity<AiConsentRecord>(e =>
        {
            e.ToTable("AiConsents");
            e.HasKey(c => c.UserId);
        });
}

public sealed class AiConsentCheck(AppDb db, IConfiguration config) : IAiConsentCheck
{
    public int CurrentVersion => config.GetValue("AiConsent:Version", 1);

    public async Task<bool> HasConsentedAsync(string userId, CancellationToken ct)
    {
        if (!config.GetValue("AiConsent:Enforced", false)) return true;
        return await db.Set<AiConsentRecord>().AsNoTracking()
            .AnyAsync(c => c.UserId == userId && c.Version >= CurrentVersion, ct);
    }
}

public static class AiConsentEndpoints
{
    /// <summary>
    /// GET, POST and DELETE on /api/me/ai-consent. Register the check with
    ///   builder.Services.AddScoped&lt;IAiConsentCheck, AiConsentCheck&gt;();
    /// DELETE is what a "Stop using AI" switch in Settings calls. Account
    /// deletion must remove the row too.
    /// </summary>
    public static IEndpointRouteBuilder MapAiConsent(this IEndpointRouteBuilder app)
    {
        // The user id is the token's "sub". The API sets MapInboundClaims = false
        // (backend.md, "Protect the API", step 7), so it is not ClaimTypes.NameIdentifier.
        var group = app.MapGroup("/api/me/ai-consent").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDb db, CancellationToken ct) =>
        {
            var id = user.FindFirstValue("sub")!;
            var row = await db.Set<AiConsentRecord>().AsNoTracking().FirstOrDefaultAsync(c => c.UserId == id, ct);
            return Results.Ok(new { version = row?.Version, grantedAt = row?.GrantedAt });
        });

        group.MapPost("/", async (ConsentBody body, ClaimsPrincipal user, AppDb db, CancellationToken ct) =>
        {
            if (body.Version < 1) return Results.BadRequest(new { code = "badRequest", message = "version is required" });
            var id = user.FindFirstValue("sub")!;
            var row = await db.Set<AiConsentRecord>().FirstOrDefaultAsync(c => c.UserId == id, ct);
            if (row is null) db.Add(new AiConsentRecord { UserId = id, Version = body.Version, GrantedAt = DateTime.UtcNow });
            else if (body.Version > row.Version) { row.Version = body.Version; row.GrantedAt = DateTime.UtcNow; }
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapDelete("/", async (ClaimsPrincipal user, AppDb db, CancellationToken ct) =>
        {
            var id = user.FindFirstValue("sub")!;
            await db.Set<AiConsentRecord>().Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });

        return app;
    }

    public sealed record ConsentBody(int Version);
}
