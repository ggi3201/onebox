using System.Diagnostics;

namespace MyApp.Api.Agent;

/// <summary>
/// What the agent records about itself, as OpenTelemetry spans.
///
/// OPT-IN. <c>AddAgentTracing</c> registers an exporter only when
/// <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> is set. Without it, every call below is
/// a no-op: <see cref="ActivitySource.StartActivity(string, ActivityKind)"/>
/// returns null when nothing listens.
///
/// The attribute names are the OpenTelemetry GenAI conventions
/// (<c>gen_ai.*</c>), so any collector can read them. Langfuse types a span as
/// a priced GENERATION when <c>gen_ai.operation.name</c> is <c>chat</c>.
///
/// ## The rule
///
/// A span may carry ids and shapes. It may never carry contents.
///
/// A trace store holding tool arguments, prompts or replies is a third copy of
/// your users' data in a system nobody thinks of as a database. So this class
/// has no method that takes free text from a request. Arguments are recorded as
/// their LENGTH. Keep a test that feeds a real sentence through and searches
/// every tag for it.
/// </summary>
public static class AgentTelemetry
{
    /// <summary>Also the <c>AddSource</c> name when tracing is registered.</summary>
    public const string SourceName = "MyApp.Agent";

    public static readonly ActivitySource Source = new(SourceName);

    /// <summary>One span per run, parent of every tool call.</summary>
    public static Activity? StartRun(string runId, string userId, string model, string viewKind)
    {
        var a = Source.StartActivity($"chat {model}", ActivityKind.Client);
        if (a is null) return null;
        a.SetTag("gen_ai.operation.name", "chat");
        a.SetTag("gen_ai.request.model", model);
        a.SetTag("gen_ai.conversation.id", runId);
        // An id makes a trace findable when a user reports a problem. An id,
        // never a name or an email.
        a.SetTag("user.id", userId);
        a.SetTag("app.view.kind", viewKind);
        return a;
    }

    public static Activity? StartTool(string toolName, string callId)
    {
        var a = Source.StartActivity($"execute_tool {toolName}", ActivityKind.Internal);
        if (a is null) return null;
        a.SetTag("gen_ai.operation.name", "execute_tool");
        a.SetTag("gen_ai.tool.name", toolName);
        a.SetTag("gen_ai.tool.call.id", callId);
        return a;
    }

    /// <summary>
    /// A background job wrapping a run. It must NOT say
    /// <c>gen_ai.operation.name = chat</c>: Langfuse would price it as well as
    /// the run inside it, and the cost would show twice.
    /// </summary>
    public static Activity? StartJob(string jobId, string userId, string kind)
    {
        var a = Source.StartActivity($"job {kind}", ActivityKind.Consumer);
        if (a is null) return null;
        a.SetTag("app.job.id", jobId);
        a.SetTag("app.job.kind", kind);
        a.SetTag("user.id", userId);
        return a;
    }

    /// <summary>
    /// Token usage. <c>gen_ai.usage.input_cached_tokens</c> is the name Langfuse
    /// prices as cached input. Other plausible names are stored and IGNORED:
    /// the span looks instrumented and the cost does not move. It was found by
    /// probing a running Langfuse; check it again after a Langfuse upgrade.
    /// Write the cached count also when it is zero. "Asked and got nothing"
    /// and "not recorded" are different facts.
    /// </summary>
    public static void RecordUsage(Activity? a, int input, int output, int cached)
    {
        if (a is null) return;
        a.SetTag("gen_ai.usage.input_tokens", input);
        a.SetTag("gen_ai.usage.output_tokens", output);
        a.SetTag("gen_ai.usage.input_cached_tokens", cached);
    }

    public static void RecordCompletion(Activity? a, int modelCalls, string finishReason)
    {
        if (a is null) return;
        a.SetTag("app.agent.model_calls", modelCalls);
        a.SetTag("gen_ai.response.finish_reasons", new[] { finishReason });
    }

    /// <summary>The LENGTH of the arguments, never the arguments.</summary>
    public static void RecordToolResult(Activity? a, int argumentLength, bool failed)
    {
        if (a is null) return;
        a.SetTag("app.tool.arguments.length", argumentLength);
        if (failed) a.SetTag("app.tool.failed", true);
    }

    /// <summary>The target and the COUNT of commands, never the commands.</summary>
    public static void RecordProposal(Activity? a, string target, int commandCount)
    {
        if (a is null) return;
        a.SetTag("app.proposal.target", target);
        a.SetTag("app.proposal.commands", commandCount);
    }

    /// <summary>
    /// A failure. The message must come from your code or the provider, never
    /// from the user's request. <c>SetStatus</c> is what makes the span red in
    /// a trace list.
    /// </summary>
    public static void RecordFailure(Activity? a, string type, string message)
    {
        if (a is null) return;
        a.SetStatus(ActivityStatusCode.Error, message);
        a.SetTag("error.type", type);
    }
}
