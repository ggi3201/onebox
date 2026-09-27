using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Api.Agent;

/// <summary>
/// The wire protocol between the agent and the app. The TypeScript twin is
/// `protocol.ts` in the chat-feature skill. Keep the two in step by hand, and
/// keep a test that says every kind here is a kind the client can parse.
///
/// Typed events, not a flat token stream. A stream of prose with markers such
/// as `[Tool:x]` in it breaks when a marker is split across two network
/// chunks, and it makes the MODEL responsible for emitting UI.
///
/// The names follow AG-UI's event vocabulary, so adopting it later is a rename.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(RunStarted), "runStarted")]
[JsonDerivedType(typeof(TextStart), "textStart")]
[JsonDerivedType(typeof(TextDelta), "textDelta")]
[JsonDerivedType(typeof(TextEnd), "textEnd")]
[JsonDerivedType(typeof(ToolStart), "toolStart")]
[JsonDerivedType(typeof(ToolResultEvent), "toolResult")]
[JsonDerivedType(typeof(ProposalEvent), "proposal")]
[JsonDerivedType(typeof(RunFinished), "runFinished")]
[JsonDerivedType(typeof(RunError), "runError")]
public abstract record AgentEvent;

public sealed record RunStarted(string RunId) : AgentEvent;

/// <summary>
/// Text arrives as start, deltas, end against one message id. A tool call can
/// sit between two messages in one run, and without ids they merge.
/// </summary>
public sealed record TextStart(string MessageId) : AgentEvent;
public sealed record TextDelta(string MessageId, string Delta) : AgentEvent;
public sealed record TextEnd(string MessageId) : AgentEvent;

/// <summary>The model called a tool. The name is enough for a status chip.</summary>
public sealed record ToolStart(string CallId, string Name) : AgentEvent;

/// <summary>
/// One line for the person. The model gets the full result; this is only so
/// the app does not look frozen.
///
/// ALWAYS sent, also when the tool failed. The first version of the source app
/// sent it only on success, and every failure left a spinner that never stopped.
/// </summary>
public sealed record ToolResultEvent(string CallId, string Summary, bool Failed = false) : AgentEvent;

/// <summary>
/// A change the agent offers. Nothing has been written yet: the person taps to
/// apply it. <paramref name="Target"/> names which part of the app owns the
/// commands. The commands stay untyped here; the client validates them against
/// the current state when the card arrives and again when it is tapped.
/// </summary>
public sealed record ProposalEvent(string ProposalId, string Target, IReadOnlyList<object> Commands) : AgentEvent;

/// <summary>
/// The run completed. <paramref name="Reason"/> tells the client whether the
/// answer is whole:
/// - <c>stop</c>: the model finished.
/// - <c>length</c>: the output token cap cut the answer off.
/// - <c>toolLimit</c>: the tool budget ran out and the model had to answer
///   with what it had.
/// </summary>
public sealed record RunFinished(string RunId, string Reason = FinishReasons.Stop) : AgentEvent;

/// <summary>Terminal, and different from the stream just stopping.</summary>
public sealed record RunError(string Code, string Message) : AgentEvent;

public static class FinishReasons
{
    public const string Stop = "stop";
    public const string Length = "length";
    public const string ToolLimit = "toolLimit";
}

/// <summary>
/// Error codes the client has a branch for. Anything else is narrowed to
/// <c>unknown</c> on the client, which keeps the message but loses the branch.
/// </summary>
public static class AgentErrorCodes
{
    public const string Unauthorized = "unauthorized";
    public const string RateLimited = "rateLimited";
    public const string ProviderError = "providerError";
    public const string Timeout = "timeout";
    public const string Unknown = "unknown";

    /// <summary>No subscription. The client opens the paywall.</summary>
    public const string EntitlementRequired = "entitlementRequired";

    /// <summary>
    /// This month's budget is spent. Not the same as <see cref="RateLimited"/>:
    /// waiting a minute does not help, so the message names the reset date.
    /// </summary>
    public const string BudgetExhausted = "budgetExhausted";

    /// <summary>The person has not agreed to send data to the AI provider.</summary>
    public const string ConsentRequired = "consentRequired";
}

/// <summary>Framing. One event, one <c>data:</c> line, one blank line.</summary>
public static class Sse
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Serialise as the BASE type. System.Text.Json writes the <c>type</c>
    /// discriminator only when the declared type is the polymorphic base.
    /// Passing <c>evt.GetType()</c> drops it, the client parses nothing, and
    /// the chat stays empty while the server logs a successful run.
    /// </summary>
    public static string Frame(AgentEvent evt) =>
        $"data: {JsonSerializer.Serialize<AgentEvent>(evt, Options)}\n\n";

    /// <summary>
    /// An SSE comment. Proxies close idle connections, and a model that thinks
    /// for twenty seconds before its first token looks idle. The client decoder
    /// drops comment frames, so this is safe to send at any time.
    /// </summary>
    public const string KeepAlive = ": keep-alive\n\n";
}
