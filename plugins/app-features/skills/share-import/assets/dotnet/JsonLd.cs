using System.Net;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MyApp.Api.Import;

/// <summary>
/// schema.org JSON-LD: find the node you want and cut it down before a model
/// or your database sees it.
///
/// Pages embed a whole graph: the page, breadcrumbs, the organisation, video,
/// reviews, every image size. Sending all of it to a model and asking for it
/// back cost one app about six times the tokens and five times the time of
/// sending the one node, with the same result.
///
/// JSON-LD in the wild is loose: the root is an object, an array or an
/// @graph; @type is a string or an array; the wanted node can sit under
/// mainEntity. Anything this class does not understand is returned as is,
/// so the worst case is the slow path, never a lost import.
/// </summary>
public static partial class JsonLd
{
    /// <summary>Every <c>application/ld+json</c> block in an HTML page.</summary>
    public static IEnumerable<string> BlocksIn(string html)
    {
        foreach (Match m in LdScript().Matches(html))
            yield return WebUtility.HtmlDecode(m.Groups[1].Value).Trim();
    }

    /// <summary>The first node whose @type is one of <paramref name="types"/>, or null.</summary>
    public static JsonObject? Find(string json, params string[] types)
    {
        try
        {
            return Find(JsonNode.Parse(json), types, 0);
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    private static JsonObject? Find(JsonNode? node, string[] types, int depth)
    {
        if (node is null || depth > 5) return null;
        if (node is JsonArray array)
        {
            foreach (var item in array)
                if (Find(item, types, depth + 1) is { } hit) return hit;
            return null;
        }
        if (node is not JsonObject obj) return null;
        if (IsType(obj["@type"], types)) return obj;
        return Find(obj["@graph"], types, depth + 1) ?? Find(obj["mainEntity"], types, depth + 1);
    }

    private static bool IsType(JsonNode? t, string[] types) => t switch
    {
        JsonValue v when v.TryGetValue<string>(out var s) => types.Contains(Short(s), StringComparer.OrdinalIgnoreCase),
        JsonArray a => a.Any(x => IsType(x, types)),
        _ => false,
    };

    /// <summary>"https://schema.org/Recipe" and "schema:Recipe" to "Recipe".</summary>
    private static string Short(string type) => type[(type.LastIndexOfAny(['/', '#', ':']) + 1)..];

    /// <summary>Only the fields you use. Everything else is tokens you pay for twice.</summary>
    public static JsonObject Slim(JsonObject node, IEnumerable<string> keep)
    {
        var slim = new JsonObject { ["@type"] = node["@type"]?.DeepClone() };
        foreach (var field in keep)
            if (node[field] is { } value) slim[field] = value.DeepClone();
        return slim;
    }

    /// <summary>
    /// Is this node worth trusting over the page text? Many sites emit a node
    /// that is present and practically empty (a name and an image, the content
    /// left in the HTML). That looks authoritative and is missing the content.
    /// Require the fields your import cannot do without.
    /// </summary>
    public static bool HasAll(JsonObject node, params string[] required) =>
        required.All(f => node[f] switch
        {
            null => false,
            JsonValue v => v.TryGetValue<string>(out var s) ? !string.IsNullOrWhiteSpace(s) : true,
            JsonArray a => a.Count > 0,
            _ => true,
        });

    [GeneratedRegex("""<script[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>""",
        RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex LdScript();
}

/// <summary>
/// A page as text a model can read: scripts, styles and navigation removed,
/// whitespace collapsed, capped. A regex pass, not a browser: good enough for
/// articles, and it never runs the page's code.
/// </summary>
public static partial class PageText
{
    public const int MaxChars = 40_000;

    public static string From(string html)
    {
        var s = Drop().Replace(html, " ");
        s = Tag().Replace(s, m => m.Value.StartsWith("</p", StringComparison.OrdinalIgnoreCase)
            || m.Value.StartsWith("<br", StringComparison.OrdinalIgnoreCase)
            || m.Value.StartsWith("</li", StringComparison.OrdinalIgnoreCase)
            || m.Value.StartsWith("</h", StringComparison.OrdinalIgnoreCase) ? "\n" : " ");
        s = WebUtility.HtmlDecode(s);
        s = Spaces().Replace(s, " ");
        s = Lines().Replace(s, "\n\n").Trim();
        return s.Length > MaxChars ? s[..MaxChars] : s;
    }

    [GeneratedRegex(@"<(script|style|noscript|svg|nav|footer|header|form)\b.*?</\1>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex Drop();
    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex Tag();
    [GeneratedRegex(@"[ \t\r\f\v]+")]
    private static partial Regex Spaces();
    [GeneratedRegex(@"\s*\n\s*(\n\s*)+")]
    private static partial Regex Lines();
}
