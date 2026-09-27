using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace MyApp.Api.Agent;

/// <summary>
/// Tracing, only when there is somewhere to send it. Opt-in.
///
/// No endpoint, no exporter, no overhead. An OTLP exporter with no collector
/// retries and buffers on a background thread forever, so it is not
/// registered at all unless configured.
///
/// Everything comes from the standard OTEL_* variables, which every language's
/// SDK reads:
///   OTEL_EXPORTER_OTLP_ENDPOINT   https://cloud.langfuse.com/api/public/otel
///   OTEL_EXPORTER_OTLP_HEADERS    Authorization=Basic base64(pk-lf-...:sk-lf-...)
///   OTEL_EXPORTER_OTLP_PROTOCOL   http/protobuf   (Langfuse has no gRPC)
///   OTEL_SERVICE_NAME             myapp-api
///
/// A header value in a .env file must not be quoted, or the quotes become part
/// of the value and every export fails with 401.
/// </summary>
public static class AgentTracing
{
    public static IServiceCollection AddAgentTracing(this IServiceCollection services, IConfiguration config)
    {
        if (string.IsNullOrWhiteSpace(config["OTEL_EXPORTER_OTLP_ENDPOINT"])) return services;

        services.AddOpenTelemetry()
            .ConfigureResource(r => r.AddService(config["OTEL_SERVICE_NAME"] ?? "myapp-api"))
            .WithTracing(t => t
                .AddSource(AgentTelemetry.SourceName)
                .AddOtlpExporter());
        return services;
    }
}
