using System.ClientModel;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OpenAI.Chat;

namespace MyApp.Api.Agent;

/// <summary>
/// One turn of the agent: call the model, run the tools it asks for, call it
/// again, until it answers. Streams typed <see cref="AgentEvent"/>s.
///
/// This is the ONLY file that knows the provider SDK. It speaks OpenAI Chat
/// Completions through the official <c>OpenAI</c> package, which works with any
/// provider that offers that format (see references/providers.md). To move to a
/// native API (Anthropic Messages, OpenAI Responses), rewrite this file; the
/// tools, the prompt, the events and the client do not change.
/// </summary>
public sealed partial class AgentLoop(
    ChatClient chat,
    IEnumerable<IAgentTool> tools,
    IOptions<LlmOptions> options,
    IUsageRecorder usage,
    ILogger<AgentLoop> log) : IAgentRunner
{
    private readonly LlmOptions _o = options.Value;

    // Sorted by name: tool definitions are part of the cached prompt prefix, and
    // a stable order keeps the prefix identical across restarts.
    private readonly List<IAgentTool> _tools = [.. tools.OrderBy(t => t.Schema.Name, StringComparer.Ordinal)];

    private const string ClosingNote =
        "[Note from the app, not from the person: the tool budget for this answer is spent. "
        + "Answer now, in text, with what you already have. Do not say a change was made unless a tool made it.]";

    /// <summary>Everything a run knows about its caller, complete, before the prompt is rendered.</summary>
    public static AgentToolContext ContextFor(AgentRequest request, string userId) =>
        new(userId,
            request.View,
            DateTimeOffset.FromUnixTimeMilliseconds(request.ClientNow),
            request.Timezone,
            request.Messages.LastOrDefault(m => m.Role == "user" && !string.IsNullOrEmpty(m.Image))?.Image);

    /// <summary>
    /// The two system messages a run opens with. <see cref="SystemPrompt.Stable"/>
    /// FIRST and alone, so the provider's prefix cache covers it and the tool
    /// definitions. Everything request-shaped goes in a SECOND message. Splicing
    /// the clock into the first moves the cache boundary to a few hundred
    /// tokens and breaks it every minute. Public so a test can read exactly
    /// what the model is told.
    /// </summary>
    public static List<ChatMessage> OpeningMessages(AgentToolContext context) =>
    [
        new SystemChatMessage(SystemPrompt.Stable),
        new SystemChatMessage(SystemPrompt.Volatile(context)),
    ];

    /// <summary>
    /// One client turn to one model message.
    ///
    /// Empty assistant turns are dropped: a turn that was only tool activity
    /// has no text, and some providers reject an empty assistant message.
    /// The photo goes AFTER the text. With the image first, a model asked a
    /// question about it describes the picture before it answers.
    /// </summary>
    public static ChatMessage? RenderTurn(AgentTurn turn, bool isNewest)
    {
        if (turn.Role == "assistant")
            return string.IsNullOrWhiteSpace(turn.Content) ? null : new AssistantChatMessage(turn.Content);

        if (!isNewest || string.IsNullOrEmpty(turn.Image))
            return new UserChatMessage(string.IsNullOrWhiteSpace(turn.Content) ? "[A photo was attached earlier.]" : turn.Content);

        var parts = new List<ChatMessageContentPart>();
        // A photo alone is a whole question ("what is this?"), but the turn
        // still needs words or it reads as if nothing was said.
        parts.Add(ChatMessageContentPart.CreateTextPart(
            string.IsNullOrWhiteSpace(turn.Content) ? "[They sent a photo and no text.]" : turn.Content));

        // Decoded to bytes, not passed as a data: Uri. System.Uri has a length
        // limit of about 65 000 characters, and a photo is far longer.
        var (mediaType, bytes) = DataUrl.Decode(turn.Image);
        parts.Add(ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(bytes), mediaType));
        return new UserChatMessage(parts);
    }

    public async IAsyncEnumerable<AgentEvent> RunAsync(
        AgentRequest request, string userId, [EnumeratorCancellation] CancellationToken ct)
    {
        /*
         * The deadline lives HERE, not only in the HTTP endpoint, so background
         * jobs get it too. Linked, so a client that hangs up still cancels.
         * The caller tells a deadline from a hang-up by checking its own token.
         */
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(AgentLimits.RunDeadline);

        /*
         * Spend is recorded in a `finally`, on EVERY path. A client that closes
         * the sheet after the last word but before the usage chunk cancels the
         * run; the provider billed every token. Record it anyway.
         */
        var spend = new RunSpend();
        try
        {
            await foreach (var e in RunCoreAsync(request, userId, spend, deadline.Token))
                yield return e;
        }
        finally
        {
            spend.SettleOpenCall();
            await Record(userId, spend);
        }
    }

    private async IAsyncEnumerable<AgentEvent> RunCoreAsync(
        AgentRequest request, string userId, RunSpend spend, [EnumeratorCancellation] CancellationToken ct)
    {
        var runId = $"run_{Guid.NewGuid():N}";

        // `using`, not try/finally on the happy path: a client that stops
        // reading disposes this iterator, and those are the runs worth reading.
        using var run = AgentTelemetry.StartRun(runId, userId, _o.Model, request.View.GetType().Name);
        yield return new RunStarted(runId);

        var context = ContextFor(request, userId);
        var messages = OpeningMessages(context);
        for (var i = 0; i < request.Messages.Count; i++)
            if (RenderTurn(request.Messages[i], isNewest: i == request.Messages.Count - 1) is { } m)
                messages.Add(m);

        /*
         * Which tools this run is offered. Narrowed in TWO places on purpose:
         * withholding the definition stops the model asking, and the check in
         * Execute makes it true even if a definition leaks in some later path.
         */
        var allowed = ToolAccess.For(request.View);
        var offered = _tools
            .Where(t => allowed is null || allowed.Contains(t.Schema.Name))
            .ToDictionary(t => t.Schema.Name);
        var definitions = offered.Values.Select(Describe).ToList();

        long promptChars = messages.Sum(Chars) + definitions.Sum(d => (long)d.FunctionParameters.ToMemory().Length + d.FunctionDescription.Length);
        var images = context.Image is null ? 0 : 1;

        for (var call = 0; call <= _o.MaxToolIterations; call++)
        {
            /*
             * The last call may not use tools. Without it, a run that spends
             * every iteration ends on a tool result with no prose, and the
             * model looks broken when it was cut off.
             *
             * The tool list stays the same and `tool_choice` becomes none, so
             * the cached prefix (system + tools) is still a hit. The note goes
             * in as a user-role message: some providers hoist every system
             * message to the top, which would break the cache on this call.
             */
            var closing = call == _o.MaxToolIterations;
            if (closing)
            {
                messages.Add(new UserChatMessage(ClosingNote));
                promptChars += ClosingNote.Length;
            }

            var text = new StringBuilder();
            var calls = new SortedDictionary<int, PartialCall>();
            var messageId = $"msg_{runId}_{call}";
            var textOpen = false;
            ChatFinishReason? finish = null;
            string? failure = null;

            spend.BeginCall(promptChars, images);
            var stream = chat.CompleteChatStreamingAsync(messages, OptionsFor(definitions, closing), ct);
            await using var updates = stream.GetAsyncEnumerator(ct);

            while (true)
            {
                StreamingChatCompletionUpdate update;
                try
                {
                    if (!await updates.MoveNextAsync()) break;
                    update = updates.Current;
                }
                catch (ClientResultException e)
                {
                    // The provider refused or broke. Log the detail; send the
                    // client a code, not the provider's text.
                    failure = $"{e.Status}: {e.Message}";
                    break;
                }

                // Before anything else: the usage chunk is the final one and
                // often carries no choices at all.
                if (update.Usage is { } u)
                    spend.Report(u.InputTokenCount, u.InputTokenDetails?.CachedTokenCount ?? 0, u.OutputTokenCount);

                if (update.FinishReason is { } f) finish = f;

                foreach (var part in update.ContentUpdate)
                {
                    if (string.IsNullOrEmpty(part.Text)) continue;
                    if (!textOpen)
                    {
                        textOpen = true;
                        yield return new TextStart(messageId);
                    }
                    text.Append(part.Text);
                    spend.Streamed(part.Text.Length);
                    yield return new TextDelta(messageId, part.Text);
                }

                // Tool calls arrive in fragments: the id in one chunk, the name
                // in another, the arguments a few characters at a time. The
                // index is the only key that is stable across them.
                foreach (var t in update.ToolCallUpdates)
                {
                    if (!calls.TryGetValue(t.Index, out var p)) calls[t.Index] = p = new PartialCall();
                    if (!string.IsNullOrEmpty(t.ToolCallId)) p.Id = t.ToolCallId;
                    if (!string.IsNullOrEmpty(t.FunctionName)) p.Name = t.FunctionName;
                    var args = t.FunctionArgumentsUpdate?.ToString();
                    if (!string.IsNullOrEmpty(args))
                    {
                        p.Arguments.Append(args);
                        spend.Streamed(args.Length);
                    }
                }
            }

            if (textOpen) yield return new TextEnd(messageId);

            if (failure is not null)
            {
                spend.Abandon();
                LogProviderError(log, runId, failure);
                AgentTelemetry.RecordFailure(run, "provider_error", failure);
                yield return new RunError(AgentErrorCodes.ProviderError,
                    "The assistant could not answer that. Please try again.");
                yield break;
            }

            /*
             * Keyed on "did it ask for tools", not on finish_reason. Providers
             * behind the same format disagree: some send `tool_calls`, some send
             * `stop` with tool calls attached.
             */
            if (calls.Count == 0 || closing)
            {
                var reason = closing ? FinishReasons.ToolLimit
                    : finish == ChatFinishReason.Length ? FinishReasons.Length
                    : FinishReasons.Stop;
                AgentTelemetry.RecordUsage(run, spend.Input, spend.Output, spend.Cached);
                AgentTelemetry.RecordCompletion(run, call + 1, reason);
                yield return new RunFinished(runId, reason);
                yield break;
            }

            // One id per call, used in the assistant message, the tool message
            // AND the events. A provider that omits an id gets a stable fallback.
            var ordered = calls.Values.ToList();
            for (var i = 0; i < ordered.Count; i++) ordered[i].Id ??= $"call_{runId}_{call}_{i}";

            var assistant = new AssistantChatMessage(ordered.Select(c =>
                ChatToolCall.CreateFunctionToolCall(c.Id!, c.Name ?? "unknown", BinaryData.FromString(
                    c.Arguments.Length == 0 ? "{}" : c.Arguments.ToString()))).ToList());
            if (text.Length > 0) assistant.Content.Add(ChatMessageContentPart.CreateTextPart(text.ToString()));
            messages.Add(assistant);
            promptChars += Chars(assistant);

            foreach (var c in ordered)
            {
                var name = c.Name ?? "unknown";
                yield return new ToolStart(c.Id!, name);

                ToolResult result;
                var arguments = c.Arguments.ToString();
                using (var span = AgentTelemetry.StartTool(name, c.Id!, run))
                {
                    result = await Execute(offered, name, arguments, context, ct);
                    AgentTelemetry.RecordToolResult(span, arguments.Length, result.Failed);
                    if (result.Proposal is { } p) AgentTelemetry.RecordProposal(span, p.Target, p.Commands.Count);
                }

                // ALWAYS, so the spinner for this call always stops.
                yield return new ToolResultEvent(c.Id!, result.Summary ?? "Done", result.Failed);

                // Sent now, not after the run: an offer worth making survives a
                // provider that times out on the sentence after it.
                if (result.Proposal is { } proposal)
                    yield return new ProposalEvent($"pr_{c.Id}", proposal.Target, proposal.Commands);

                var toolMessage = new ToolChatMessage(c.Id!, result.ContentForModel);
                messages.Add(toolMessage);
                promptChars += result.ContentForModel.Length;
            }
        }
    }

    private ChatCompletionOptions OptionsFor(List<ChatTool> definitions, bool closing)
    {
        var o = new ChatCompletionOptions { MaxOutputTokenCount = closing ? Math.Max(256, _o.MaxOutputTokens / 4) : _o.MaxOutputTokens };
        foreach (var d in definitions) o.Tools.Add(d);
        if (definitions.Count > 0) o.ToolChoice = closing ? ChatToolChoice.CreateNoneChoice() : ChatToolChoice.CreateAutoChoice();

#pragma warning disable SCME0001 // Patch is marked experimental; it adds fields the typed options lack.
        if (!string.IsNullOrWhiteSpace(_o.ReasoningEffort))
            o.Patch.Set("$.reasoning_effort"u8, BinaryData.FromObjectAsJson(_o.ReasoningEffort));
        if (_o.CacheControl)
            o.Patch.Set("$.cache_control"u8, BinaryData.FromString("""{"type":"ephemeral"}"""));
#pragma warning restore SCME0001
        return o;
    }

    /// <summary>
    /// A schema that does not parse is a bug in the tool. Crash at the first
    /// run, never degrade to "this tool takes no arguments".
    /// </summary>
    private static ChatTool Describe(IAgentTool tool)
    {
        var json = tool.Schema.ParametersJson ?? """{"type":"object","properties":{}}""";
        using var _ = JsonDocument.Parse(json);
        return ChatTool.CreateFunctionTool(tool.Schema.Name, tool.Schema.Description, BinaryData.FromString(json));
    }

    /// <summary>
    /// Run one tool. Every failure becomes text the model can read: "that tool
    /// failed, try something else" is a conversation the model can have, and
    /// losing the whole turn to one bad query is worse. Cancellation of the RUN
    /// is re-thrown; a tool's own timeout is not.
    /// </summary>
    private async Task<ToolResult> Execute(
        Dictionary<string, IAgentTool> offered, string name, string arguments,
        AgentToolContext context, CancellationToken ct)
    {
        if (!offered.TryGetValue(name, out var tool))
        {
            // "Not available here", not "no such tool": the second sends the
            // model looking for a spelling mistake it did not make.
            LogToolNotOffered(log, name);
            return ToolResult.Refuse($"{name} is not available here. Use one of the tools you were given.",
                $"{name} is not available here");
        }

        JsonElement args;
        try
        {
            args = string.IsNullOrWhiteSpace(arguments) ? default : JsonDocument.Parse(arguments).RootElement;
        }
        catch (JsonException e)
        {
            return ToolResult.Refuse($"Your arguments were not valid JSON ({e.Message}). Try again.",
                $"{name} got malformed arguments");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(AgentLimits.ToolTimeout);
        try
        {
            return await tool.ExecuteAsync(args, context, timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return ToolResult.Refuse($"{name} took too long and was stopped. Answer without it or try a narrower request.",
                $"{name} timed out");
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            LogToolThrew(log, e, name);
            return ToolResult.Refuse($"The {name} tool failed. Try another way.", $"{name} failed");
        }
    }

    /// <summary>
    /// Record the spend. A failure here must not fail the run: the answer
    /// arrived and the provider billed it. Log with the user id, because it is
    /// the only warning that this user is now under-counted.
    /// </summary>
    private async Task Record(string userId, RunSpend spend)
    {
        if (spend.Recorded || (spend.Input <= 0 && spend.Output <= 0)) return;
        spend.Recorded = true;
        try
        {
            await usage.RecordAsync(userId, _o.Model, spend.Input, spend.Cached, spend.Output, CancellationToken.None);
        }
        catch (Exception e)
        {
            LogUsageNotRecorded(log, e, userId);
        }
    }

    private static long Chars(ChatMessage m)
    {
        long n = 0;
        foreach (var p in m.Content) n += p.Text?.Length ?? 0;
        if (m is AssistantChatMessage a)
            foreach (var t in a.ToolCalls) n += t.FunctionArguments.ToMemory().Length;
        return n;
    }

    private sealed class PartialCall
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public StringBuilder Arguments { get; } = new();
    }

    // Source-generated log lines. The strict analyzers (CA1848) refuse
    // log.LogInformation(...) and the other extension methods.
    [LoggerMessage(Level = LogLevel.Error, Message = "Agent run {RunId} provider error {Failure}")]
    private static partial void LogProviderError(ILogger log, string runId, string failure);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Agent asked for tool {Tool}, which this run does not offer")]
    private static partial void LogToolNotOffered(ILogger log, string tool);

    [LoggerMessage(Level = LogLevel.Error, Message = "Tool {Tool} threw")]
    private static partial void LogToolThrew(ILogger log, Exception error, string tool);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Could not record agent usage for user {User}")]
    private static partial void LogUsageNotRecorded(ILogger log, Exception error, string user);
}

/// <summary>A data URL to its media type and bytes.</summary>
public static class DataUrl
{
    public static (string MediaType, byte[] Bytes) Decode(string dataUrl)
    {
        var comma = dataUrl.IndexOf(',');
        var header = dataUrl[5..comma];                       // "image/jpeg;base64"
        var mediaType = header.Split(';')[0];
        return (mediaType, Convert.FromBase64String(dataUrl[(comma + 1)..]));
    }
}
