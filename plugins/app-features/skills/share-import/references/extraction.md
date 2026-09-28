# Getting the content out

## The ladder

| Step | Source | Model? | Why this order |
|---|---|---|---|
| 1 | JSON-LD the extension took from the reader's page | no | faithful, free, and past bot walls |
| 2 | page text the extension took | yes | the reader's own copy; nothing to fetch |
| 3 | fetch the URL, JSON-LD in the HTML | no | works for most sites that do not block |
| 4 | the fetched page as text | yes | last resort |

A blocked fetch (401, 402, 403, 429) fails with a sentence that says: open
the page in Safari and share it from there. That path works because the
reader's page is not blocked.

A readable-text proxy (a hosted "reader" service) can be a step 5, but it
sends the user's URL to a third party: add it to the privacy policy and the
consent text if you use one.

## JSON-LD in the wild

- The root is an object, an array, or an `@graph`; the node can sit under
  `mainEntity`.
- `@type` is a string, an array, or a full URL (`https://schema.org/Recipe`).
- Nodes are often present and practically empty (a name and an image). Check
  the fields you cannot do without (`HasAll`) before you trust it over the text.
- List fields come in several shapes. Instructions alone: a string, a list of
  strings, `HowToStep` objects, or `HowToSection` wrapping more of them.
- Slim the node to the fields you use before storing it or sending it to a
  model. One app measured about six times the tokens and five times the time
  for the whole graph, with the same result.
- Log a fallback with the site HOST and the node's shape, so formats you miss
  can be added over time. Never log the content.

## One structured call

- Force a tool with a JSON Schema (`tool_choice` = that function). It works on
  every OpenAI-compatible provider; `response_format` is ignored by some.
- `found: false` plus a reason is a valid answer. Say so in the prompt.
- Validate in code. On a bad answer, send the error back once and retry once.
- The text is data: tell the model to ignore instructions inside it.
- Keep the author's words, amounts and units. Converting units is a separate,
  explicit feature, done in code where possible. One app paid a full model
  round trip on every import to re-emit a recipe "for unit conversion" even
  when it was already in the right units.
- Pass the cancellation token to the call.

## Social video (Instagram, TikTok, YouTube)

The share gives you a link and, at best, a caption. Options, cheapest first:

1. **The caption.** oEmbed or the page's meta description often has the full
   text. Many creators put the whole recipe there.
2. **The platform's API** where there is one (YouTube Data API for the
   description).
3. **The transcript.** Download the audio (yt-dlp) and transcribe it (Whisper,
   locally or on the box). On the server it is a job of its own: slow, and
   heavy on CPU.
4. Nothing usable: fail with a sentence. Do not build a record from the title.

Downloading from these platforms can break their terms. Decide that before you
build step 3, and keep it out of the App Store description.

## Images in imports

Re-host images (download through the guarded client, store in your object
storage) instead of hot-linking the source. Hot-linked images break, leak your
users' reading to the source, and can be swapped.
