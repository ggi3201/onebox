namespace MyApp.Api.Agent;

/// <summary>
/// What one run has cost so far. Shared between the loop and the
/// <c>finally</c> in <see cref="AgentLoop.RunAsync"/> that records it however
/// the run ends.
///
/// The provider's usage chunk is the LAST chunk of a streamed call. A client
/// that hangs up before it arrives leaves a call the provider billed and never
/// reported. So the open call is tracked as characters and turned into an
/// estimate if the run ends with it still open. The estimate undercounts (no
/// reasoning tokens), which is the right way to be wrong for an honest user and
/// still makes hanging up cost something.
/// </summary>
public sealed class RunSpend
{
    private const int CharsPerToken = 4;

    /// <summary>A 1024 px photo as input, near enough for most vision models.</summary>
    private const int TokensPerImage = 1_000;

    /// <summary>Prompt tokens, INCLUDING the cached share, as the provider reports them.</summary>
    public int Input { get; set; }

    /// <summary>The cached share of <see cref="Input"/>. A subset, never added on top.</summary>
    public int Cached { get; set; }

    public int Output { get; set; }

    /// <summary>Set once usage is written, so it is written once.</summary>
    public bool Recorded { get; set; }

    private int? _openInputTokens;
    private int _openOutputChars;

    /// <summary>A model call starts with this much prompt.</summary>
    public void BeginCall(long promptChars, int images)
    {
        _openInputTokens = (int)Math.Min(int.MaxValue, promptChars / CharsPerToken + (long)images * TokensPerImage);
        _openOutputChars = 0;
    }

    public void Streamed(int chars)
    {
        if (_openInputTokens is not null) _openOutputChars += chars;
    }

    /// <summary>The provider reported usage for the open call.</summary>
    public void Report(int input, int cached, int output)
    {
        Input += input;
        Cached += Math.Clamp(cached, 0, Math.Max(0, input));
        Output += output;
        _openInputTokens = null;
    }

    /// <summary>The open call ended without usage and was not billed (it failed to start).</summary>
    public void Abandon() => _openInputTokens = null;

    /// <summary>Fold a call that never reported into the totals as an estimate.</summary>
    public void SettleOpenCall()
    {
        if (_openInputTokens is not { } input) return;
        Input += input;
        Output += _openOutputChars / CharsPerToken;
        _openInputTokens = null;
    }
}
