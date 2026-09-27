using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Api.Agent;

/// <summary>
/// A tool as the model sees it. A plain record, not the SDK's type, so tool
/// files do not import the provider and the mapping happens once, in
/// <see cref="AgentLoop"/>.
/// </summary>
/// <param name="ParametersJson">
/// JSON Schema for the arguments object. Null for a tool with no arguments.
/// Null is not the same as an empty object: some models read "an object with
/// no properties" as "pass something".
/// </param>
public sealed record ToolSchema(string Name, string Description, string? ParametersJson = null);

/// <summary>What a tool produced.</summary>
/// <param name="ContentForModel">Goes back into the conversation. Can be long.</param>
/// <param name="Summary">One line for the person, sent as <c>toolResult</c>.</param>
/// <param name="Proposal">A change to offer, if this is a write tool. Nothing has been written.</param>
/// <param name="Failed">
/// True when the tool refused or broke. Set it explicitly. The source app
/// guessed this from the word "failed" in the summary, which is wrong both ways.
/// </param>
public sealed record ToolResult(
    string ContentForModel,
    string? Summary = null,
    ProposedChange? Proposal = null,
    bool Failed = false)
{
    /// <summary>A refusal the model can read and act on.</summary>
    public static ToolResult Refuse(string forModel, string summary) => new(forModel, summary, Failed: true);
}

/// <param name="Target">Which part of the app owns these commands, for example "list" or "settings".</param>
public sealed record ProposedChange(string Target, IReadOnlyList<object> Commands);

/// <summary>
/// Everything a tool may know about the caller. Built ONCE per run by
/// <see cref="AgentLoop.ContextFor"/>, before the prompt is rendered, so the
/// prompt and the tools see the same facts. A field added after the prompt is
/// rendered reaches the tools and not the model, and the model then says it
/// cannot see something that is right there.
/// </summary>
public sealed record AgentToolContext(
    string UserId,
    ViewContext View,
    DateTimeOffset ClientNow,
    string Timezone,
    /// <summary>The newest attached photo, as a data URL, or null.</summary>
    string? Image);

public interface IAgentTool
{
    ToolSchema Schema { get; }

    /// <summary>Arguments arrive parsed, once, in the loop.</summary>
    Task<ToolResult> ExecuteAsync(JsonElement args, AgentToolContext context, CancellationToken ct);
}

/// <summary>
/// The whole loop behind one interface, so a background job and a test can
/// run it without HTTP.
/// </summary>
public interface IAgentRunner
{
    IAsyncEnumerable<AgentEvent> RunAsync(AgentRequest request, string userId, CancellationToken ct);
}

/// <summary>
/// Which tools a run may use when the answer is not "all of them".
///
/// A background job has nobody watching. It must not reach a tool that writes
/// without a tap (memory, messages) or one that reads the open web. An
/// ALLOW-list, not a deny-list: a deny-list gives next year's new write tool to
/// every job by default. This one only fails to offer a new read tool until
/// somebody adds it. Keep a test that every name here is a registered tool.
/// </summary>
public static class ToolAccess
{
    public static readonly IReadOnlySet<string> BackgroundJob = new HashSet<string>
    {
        "list_items",
        "get_item",
    };

    /// <summary>Null means every registered tool.</summary>
    public static IReadOnlySet<string>? For(ViewContext view) => view switch
    {
        BackgroundView => BackgroundJob,
        _ => null,
    };
}

/// <summary>
/// Which screen the question was asked from. A union, not a bag of nullable
/// ids: adding a screen is adding a member, and a switch that forgets it does
/// not compile. Mirror it in the client's <c>ViewContext</c> type.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(HomeView), "home")]
[JsonDerivedType(typeof(ItemView), "item")]
[JsonDerivedType(typeof(BackgroundView), "background")]
[JsonDerivedType(typeof(NoView), "none")]
public abstract record ViewContext;

public sealed record HomeView : ViewContext;

/// <param name="ItemId">The thing on screen. An id, never the thing itself: tools read it.</param>
public sealed record ItemView(string ItemId) : ViewContext;

/// <summary>A job on a timer. Nobody asked; silence is the default answer.</summary>
public sealed record BackgroundView(string Task) : ViewContext;

public sealed record NoView : ViewContext;

/// <summary>One turn, as the client sent it.</summary>
/// <param name="Image">
/// A <c>data:image/jpeg;base64,…</c> photo, on the NEWEST user turn only.
/// Earlier photos are not re-sent: they would be uploaded and billed again on
/// every message, and the model's own words about them are already in the history.
/// </param>
public sealed record AgentTurn(string Role, string Content, string? Image = null);

/// <summary>The body of <c>POST /api/agent/chat</c>.</summary>
public sealed record AgentRequest(
    List<AgentTurn> Messages,
    ViewContext View,
    long ClientNow,
    string Timezone);
