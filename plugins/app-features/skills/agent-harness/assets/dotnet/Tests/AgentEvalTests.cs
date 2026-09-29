using System.Globalization;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MyApp.Api.Agent;
using Xunit;

namespace MyApp.Api.Tests;

/// <summary>
/// Evals: the real model, the real prompt, the real tools.
///
/// OFF by default, also on a machine with a key. Each one costs a model call,
/// and <c>dotnet test</c> must never spend money quietly:
///
///   APP_EVAL=1 dotnet test --filter Category=Eval
///
/// Assert on TOOL CALLS, not on prose. "Did it act or did it ask" has a data
/// answer. Whether a sentence sounds eager does not.
///
/// A model is not deterministic, so each case runs several times and reports
/// a RATE. One pass is an anecdote. Before you trust an eval, delete the prompt
/// line it guards and watch it go red, at the same number of runs.
/// </summary>
[Trait("Category", "Eval")]
public class AgentEvalTests
{
    private const int Runs = 3;

    [Fact]
    public async Task It_reads_rather_than_offering_to_read()
    {
        if (!CanRun(out var why)) { Console.WriteLine($"Skipped: {why}"); return; }

        var passes = 0;
        var failures = new StringBuilder();
        for (var i = 0; i < Runs; i++)
        {
            var run = await Chat("what is in my list?", new HomeView());
            if (run.Tools.Contains("list_items")) passes++;
            else failures.AppendLine(CultureInfo.InvariantCulture, $"- called [{string.Join(", ", run.Tools)}] and said: {run.Text}");
        }

        Assert.True(passes == Runs, $"{passes}/{Runs} runs read the list. The others:\n{failures}");
    }

    [Fact]
    public async Task It_offers_the_change_rather_than_asking_whether_to()
    {
        if (!CanRun(out var why)) { Console.WriteLine($"Skipped: {why}"); return; }

        var passes = 0;
        for (var i = 0; i < Runs; i++)
        {
            var run = await Chat("rename item 1 to Oat milk", new ItemView("1"));
            // A run that proposed nothing must fail on its own line, or every
            // assertion about WHAT it proposed passes without being tested.
            if (run.Proposals > 0) passes++;
        }

        Assert.True(passes == Runs, $"{passes}/{Runs} runs offered the rename.");
    }

    // ---------------------------------------------------------------------

    private sealed record Run(List<string> Tools, int Proposals, string Text);

    private static bool CanRun(out string why)
    {
        why = Environment.GetEnvironmentVariable("APP_EVAL") != "1" ? "set APP_EVAL=1 to spend money on evals"
            : string.IsNullOrEmpty(Environment.GetEnvironmentVariable("Llm__ApiKey")) ? "no Llm__ApiKey" : "";
        return why.Length == 0;
    }

    private static async Task<Run> Chat(string text, ViewContext view)
    {
        var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        var services = new ServiceCollection().AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddAgent(config);
        services.AddScoped<IItemReader, SeedItems>(); // your seeded test data
        await using var sp = services.BuildServiceProvider();
        using var scope = sp.CreateScope();

        var loop = scope.ServiceProvider.GetRequiredService<IAgentRunner>();
        var request = new AgentRequest([new AgentTurn("user", text)], view,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "UTC");

        var tools = new List<string>();
        var proposals = 0;
        var sb = new StringBuilder();
        await foreach (var e in loop.RunAsync(request, "eval-user", CancellationToken.None))
        {
            switch (e)
            {
                case ToolStart t: tools.Add(t.Name); break;
                case ProposalEvent: proposals++; break;
                case TextDelta d: sb.Append(d.Delta); break;
                case RunError err: throw new InvalidOperationException($"Run failed: {err.Code} {err.Message}");
            }
        }
        return new Run(tools, proposals, sb.ToString());
    }

    private sealed class SeedItems : IItemReader
    {
        private static readonly List<(string Id, string Name, string Details)> Rows =
            [("1", "Milk", "2 litres, semi-skimmed"), ("2", "Bread", "Rye")];

        public Task<IReadOnlyList<(string Id, string Name)>> ListAsync(string u, string? q, int take, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<(string, string)>>(Rows
                .Where(r => q is null || r.Name.Contains(q, StringComparison.OrdinalIgnoreCase))
                .Take(take).Select(r => (r.Id, r.Name)).ToList());

        public Task<(string Id, string Name, string Details)?> GetAsync(string u, string id, CancellationToken ct) =>
            Task.FromResult<(string, string, string)?>(Rows.FirstOrDefault(r => r.Id == id) is { Id: not null } r ? r : null);
    }
}
