using System.Globalization;
using System.Text;
using System.Text.Json;

namespace MyApp.Api.Agent;

/*
 * Three example tools: a directory, a detail read, and a write that PROPOSES.
 * Replace "item" with your app's noun. The shape is the part to keep:
 *
 * - A directory before the document. With only get_item, a question about
 *   items in the plural gets a true and useless answer about one of them.
 * - Every read returns the IDS the next tool needs. A read that prints names
 *   and no ids makes the model refuse ("no usable id") in fluent prose that
 *   looks like a limitation of your app. Nothing logs an error.
 * - A write returns a proposal and says in ContentForModel what it OFFERED.
 */

/// <summary>Your data access. Stands in for your DbContext or repository.</summary>
public interface IItemReader
{
    Task<IReadOnlyList<(string Id, string Name)>> ListAsync(string userId, string? query, int take, CancellationToken ct);
    Task<(string Id, string Name, string Details)?> GetAsync(string userId, string id, CancellationToken ct);
}

public sealed class ListItemsTool(IItemReader items) : IAgentTool
{
    public ToolSchema Schema { get; } = new(
        "list_items",
        "List the person's items, newest first, with the id of each. Use it before get_item "
        + "when you do not have an id, and for any question about items in the plural.",
        """
        {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Optional words to filter by name. Use loose, short terms." },
            "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
          }
        }
        """);

    public async Task<ToolResult> ExecuteAsync(JsonElement args, AgentToolContext context, CancellationToken ct)
    {
        var query = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("query", out var q) ? q.GetString() : null;
        var limit = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("limit", out var l) && l.TryGetInt32(out var n)
            ? Math.Clamp(n, 1, 50) : 20;

        var rows = await items.ListAsync(context.UserId, query, limit, ct);
        if (rows.Count == 0)
            return new ToolResult(query is null ? "They have no items." : $"No items match \"{query}\". Try a shorter term.",
                "Found nothing");

        var sb = new StringBuilder();
        foreach (var (id, name) in rows) sb.AppendLine(CultureInfo.InvariantCulture, $"- id={id} name={name}");
        return new ToolResult(sb.ToString(), $"Read {rows.Count} items");
    }
}

public sealed class GetItemTool(IItemReader items) : IAgentTool
{
    public ToolSchema Schema { get; } = new(
        "get_item",
        "Read one item in full, by id. Ids come from list_items or from the screen they are on.",
        """
        {
          "type": "object",
          "properties": { "id": { "type": "string" } },
          "required": ["id"]
        }
        """);

    public async Task<ToolResult> ExecuteAsync(JsonElement args, AgentToolContext context, CancellationToken ct)
    {
        var id = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("id", out var v) ? v.GetString() : null;
        if (string.IsNullOrWhiteSpace(id))
            return ToolResult.Refuse("get_item needs an id. Call list_items to find it.", "No id given");

        // Scoped to the caller by userId, always. Never trust an id alone.
        var item = await items.GetAsync(context.UserId, id, ct);
        return item is { } i
            ? new ToolResult($"id={i.Id}\nname={i.Name}\n{i.Details}", $"Read {i.Name}")
            : ToolResult.Refuse($"No item with id {id}. Do not guess ids; call list_items.", "Item not found");
    }
}

public sealed class ProposeItemChangeTool(IItemReader items) : IAgentTool
{
    public ToolSchema Schema { get; } = new(
        "propose_item_change",
        "Offer to rename an item. This does NOT change anything: it shows the person a card, "
        + "and they tap to apply it. Say it is offered, not done.",
        """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "newName": { "type": "string", "minLength": 1, "maxLength": 200 }
          },
          "required": ["id", "newName"]
        }
        """);

    public async Task<ToolResult> ExecuteAsync(JsonElement args, AgentToolContext context, CancellationToken ct)
    {
        var id = args.GetProperty("id").GetString() ?? "";
        var newName = args.GetProperty("newName").GetString()?.Trim() ?? "";

        var item = await items.GetAsync(context.UserId, id, ct);
        if (item is null) return ToolResult.Refuse($"No item with id {id}.", "Item not found");

        // A write that would change nothing is refused. A no-op accepted as a
        // success teaches the model it worked, and it will do it again.
        if (string.Equals(item.Value.Name, newName, StringComparison.Ordinal))
            return ToolResult.Refuse("That is already its name. Nothing to offer.", "Already named that");

        var command = new { op = "rename", id, name = newName };
        return new ToolResult(
            $"Offered: rename \"{item.Value.Name}\" to \"{newName}\". It applies when they tap the card.",
            $"Offered a rename",
            new ProposedChange("item", [command]));
    }
}
