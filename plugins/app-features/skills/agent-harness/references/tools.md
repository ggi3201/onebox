# Tool design

## The shape

```csharp
public sealed class GetItemTool(IItemReader items) : IAgentTool
{
    public ToolSchema Schema { get; } = new("get_item", "Read one item in full, by id. ...", """{ JSON Schema }""");
    public Task<ToolResult> ExecuteAsync(JsonElement args, AgentToolContext ctx, CancellationToken ct) { ... }
}
```

- The schema is a JSON Schema string, not the SDK's types. Readable at a glance;
  mapped to the provider once, in `AgentLoop`.
- `ToolResult.ContentForModel` is for the model: every row, with ids.
  `Summary` is one line for the person ("Read 12 items"). They want different
  things.
- `Failed` is set explicitly. Use `ToolResult.Refuse(...)`.
- Scope every read by `ctx.UserId`. The model can hand you any id; the tool
  decides what that user may see.

## Rules

1. **A directory before the document.** With only `get_item`, a question about
   items in the plural gets a true and useless answer about one of them.
2. **Every read returns the ids the next tool needs.** A read that prints names
   and no ids makes the model refuse with "no usable id", in fluent prose that
   reads like a limit of your app. Nothing logs an error, every test passes,
   and a user finds it. Check each pair: can the output of tool A feed tool B?
3. **Writes propose.** A write tool returns a `ProposedChange` and says in
   `ContentForModel` what it OFFERED. The app applies it on a tap, after
   validating it against the state at THAT moment (the person may have changed
   something since the card appeared).
4. **Refuse a write that changes nothing.** A no-op accepted as a success teaches
   the model it worked, and it does it again. One model saved the same memory
   five times in four minutes; the de-duplicating upsert hid it, and only the
   trace showed it.
5. **Refusals are sentences the model can act on.** "No item with id 7. Do not
   guess ids; call list_items." Not "not found".
6. **Say "not available here", not "no such tool"**, when a tool is withheld.
   The second sends the model looking for a spelling mistake.
7. **Search terms: say "loose, short terms".** Models search for oddly specific
   words (one searched a food catalogue for "florets"). The description is
   where to steer it.
8. **Do not offer a tool that cannot succeed.** A photo-reading tool with no
   photo attached still costs a round when the model tries it. Drop it from the
   list for that run.
9. **One call that covers the request** beats several. Let a write take a list
   of commands.
10. **An auto-applied write needs visible transparency.** If a tool writes
    without a tap (for example saving a memory about the person), send an event
    that shows what was written, at the moment it was written, and give the
    person a screen to edit or delete it. Never offer such a tool to a
    background run.
11. **Register tools one by one**, and keep a test that the list matches the
    files on disk and every name in `ToolAccess` resolves.

## Proposals: the client half

- The proposal event carries `target` and untyped `commands`. The feature that
  owns those commands validates them, on arrival (to draw the card) and again
  on tap.
- A card that would do nothing (every command refused) is not shown; the
  model's sentence already explains.
- An unknown `target` is DROPPED on the client, never defaulted.

## A structured single call is not an agent

For "extract fields from this text" or "read this photo into rows", use one
call with a fixed output shape, no loop. Validate every id and number in the
answer against your own data, and fill numbers FROM your data, not from the
model. The strongest version: never show the model a number it could copy, and
give its answer no field a number could arrive in.
