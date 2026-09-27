using System.ClientModel;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAI;
using OpenAI.Chat;

namespace MyApp.Api.Agent;

/// <summary>
/// The model, from configuration. Any provider that speaks the OpenAI Chat
/// Completions format works: set <see cref="BaseUrl"/>, <see cref="ApiKey"/>
/// and <see cref="Model"/>. See references/providers.md for the table.
///
/// Environment variables (double underscore = section):
///   Llm__BaseUrl=https://openrouter.ai/api/v1
///   Llm__ApiKey=...                 (from your secrets tool, never committed)
///   Llm__Model=anthropic/claude-sonnet-5
/// </summary>
public sealed class LlmOptions
{
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "";

    /// <summary>Per model call. The closing call gets a quarter of it.</summary>
    public int MaxOutputTokens { get; set; } = 2048;

    /// <summary>
    /// Model calls that may ask for tools before the model must answer. A bound
    /// on the bill more than a safety net: five is enough to read a few things
    /// and explain, and short of a loop.
    /// </summary>
    public int MaxToolIterations { get; set; } = 5;

    /// <summary>
    /// Sent as <c>reasoning_effort</c> when set. Leave empty unless your
    /// provider and model need it; some reject tools together with reasoning,
    /// some ignore the field. Reasoning tokens bill as output.
    /// </summary>
    public string? ReasoningEffort { get; set; }

    /// <summary>
    /// Sends <c>cache_control: {type: ephemeral}</c> at the top level. OpenRouter
    /// needs it to cache Claude prompts. OpenAI, Gemini and DeepSeek cache on
    /// their own and ignore it. See references/providers.md.
    /// </summary>
    public bool CacheControl { get; set; }
}

public static class AgentRegistration
{
    public static IServiceCollection AddAgent(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<LlmOptions>(config.GetSection("Llm"));
        services.AddMemoryCache();
        services.AddSingleton<AgentConcurrency>();

        // Defaults. The ai-usage-limits and ai-consent skills register real
        // ones with AddScoped; the last registration wins.
        services.TryAddScoped<IUsageRecorder, LogOnlyUsageRecorder>();
        services.TryAddScoped<IAgentAccess, AllowAllAgentAccess>();

        /*
         * The client is built lazily and fails with a message that names the
         * setting. Never inject it into an endpoint signature: minimal-API
         * parameters are built BEFORE the handler runs, so a missing key would
         * turn every cheap refusal (the 400 for a huge body) into a 500. Found
         * by CI, not locally, because a developer machine has a key.
         */
        services.AddSingleton(sp =>
        {
            var o = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<LlmOptions>>().Value;
            if (string.IsNullOrWhiteSpace(o.ApiKey))
                throw new InvalidOperationException("Llm:ApiKey is not set (env Llm__ApiKey).");
            if (string.IsNullOrWhiteSpace(o.Model))
                throw new InvalidOperationException("Llm:Model is not set (env Llm__Model).");

            return new ChatClient(o.Model, new ApiKeyCredential(o.ApiKey),
                new OpenAIClientOptions { Endpoint = new Uri(o.BaseUrl) });
        });

        services.AddScoped<AgentLoop>();
        services.AddScoped<IAgentRunner>(sp => sp.GetRequiredService<AgentLoop>());

        // Tools one by one, not by assembly scan: "which tools does the agent
        // have" should be answered by reading this list. Keep a test that it
        // matches the files on disk.
        services.AddScoped<IAgentTool, ListItemsTool>();
        services.AddScoped<IAgentTool, GetItemTool>();
        services.AddScoped<IAgentTool, ProposeItemChangeTool>();

        return services;
    }
}
