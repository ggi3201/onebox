using System.Globalization;
using MyApp.Api.Agent;

namespace MyApp.Api.Usage;

/// <summary>Is this user subscribed? Back it with your RevenueCat webhook table.</summary>
public interface ISubscriptions
{
    Task<bool> IsActiveAsync(string userId, CancellationToken ct);
}

/// <summary>
/// The one server-side gate for EVERY endpoint that reaches a model: the chat,
/// and any other AI endpoint (a photo reader, an import). The app's own checks
/// are presentation, so a free user does not tap into a refusal; this is the
/// enforcement.
///
/// Order: consent, then subscription, then budget. Each answer has its own
/// code, because each wants different words and a different button.
///
/// <c>Payments:Enforced</c> (default false) lets you ship the gate before the
/// paywall: the budget still applies to everyone, the subscription check waits.
/// </summary>
public sealed class AiAccess(
    ISubscriptions subscriptions,
    UsageService usage,
    IConfiguration config,
    IAiConsentCheck? consent = null) : IAgentAccess
{
    public async Task<AgentDenial?> CheckAsync(string userId, CancellationToken ct)
    {
        if (consent is not null && !await consent.HasConsentedAsync(userId, ct))
            return new AgentDenial(StatusCodes.Status403Forbidden, AgentErrorCodes.ConsentRequired,
                "Allow AI features first.");

        if (config.GetValue("Payments:Enforced", false) && !await subscriptions.IsActiveAsync(userId, ct))
            return new AgentDenial(StatusCodes.Status402PaymentRequired, AgentErrorCodes.EntitlementRequired,
                "This is part of the paid plan.");

        var month = await usage.CurrentAsync(userId, ct);
        if (month.Exhausted)
            // The reset date, because the only honest sentence names it.
            return new AgentDenial(StatusCodes.Status429TooManyRequests, AgentErrorCodes.BudgetExhausted,
                "You have used this month's allowance. It resets on "
                + month.ResetsAt.ToString("d MMMM", CultureInfo.InvariantCulture) + ".");

        return null;
    }
}
