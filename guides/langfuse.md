# Langfuse (optional)

Used by: `app-features:agent-harness`, only if you turn tracing on.

## What it is and what it costs

Langfuse stores traces of your AI runs: which tools ran, in what order, how
long each took, the tokens, and the cost. The onebox harness sends it
OpenTelemetry spans that carry ids and counts, never your users' text.

Tracing is **opt-in**. Without the settings below, nothing is sent anywhere.

Checked on 2026-09-28 at https://langfuse.com/pricing:

- **Cloud, Hobby plan: free.** 50,000 units a month, 30 days of data, 2 users.
  Plenty for an app in TestFlight and early on the App Store.
- **Cloud, Core plan:** $29 a month, more units and longer retention.
- **Self-hosted: free** (open source). The Docker Compose setup runs Postgres,
  ClickHouse, Redis and object storage, and Langfuse recommends at least 4
  cores and 16 GB of memory. That is more than a small VPS. Self-host only on
  a box with memory to spare, and back it up yourself.

Start with the cloud free plan. Move later if you need to; the app only
changes one URL.

## Steps (cloud)

1. Sign up at https://cloud.langfuse.com (EU) or https://us.cloud.langfuse.com
   (US). Pick the region closest to your box; it is also where the data lives.
2. Create an organisation and a project named after the app.
3. In the project settings, create an API key pair. You get a public key
   (`pk-lf-…`) and a secret key (`sk-lf-…`). Copy both once.
4. Make the header value:
   ```bash
   printf '%s' "pk-lf-...:sk-lf-..." | base64
   ```
   Do this in a terminal, not in a chat, and do not save the output in a file
   that git tracks.

## Where the value goes

In the API's secrets, next to the other app secrets:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <the base64 value>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=myapp-api
```

Use `https://us.cloud.langfuse.com/api/public/otel` for the US region, or
`https://<your host>/api/public/otel` when self-hosted.

Optional onebox config, so a skill can find the project:

```jsonc
{ "tracing": { "otlpEndpoint": "https://cloud.langfuse.com/api/public/otel", "authRef": "LANGFUSE_OTLP_AUTH" } }
```

## Check it works

1. Restart the API and run one chat.
2. Open the project's Traces page. Within a minute there is a trace named
   `chat <model>` with `execute_tool …` children, token counts and a cost.
3. Open one span and check it holds no message text.

## Common errors

- **Nothing arrives, no error:** the endpoint variable is missing inside the
  container, so tracing never turned on (that is the opt-in working). Check
  `docker compose exec api printenv | grep OTEL`.
- **401 in the API log:** the header is quoted in the `.env` file, or the
  base64 has a newline in it. Use `printf`, not `echo`, and no quotes.
- **Wrong or zero cost:** Langfuse prices from its own model table. A new model
  may be missing or carry an old rate. Check one trace against the provider's
  price page and fix the model definition in Langfuse settings.
- **gRPC errors:** Langfuse accepts OTLP over HTTP only. Set the protocol to
  `http/protobuf`.
