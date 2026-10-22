"""OpenTelemetry setup: the tracer provider, the propagator, and the `traceparent` header."""

from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import SpanContext
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from sample_api.config import Settings

TRACEPARENT_HEADER = "traceparent"

PROPAGATOR = CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()])


def init_telemetry(settings: Settings) -> TracerProvider:
    """Create the tracer provider. Spans export only when an OTLP endpoint is set.

    The provider is not installed as the global provider. Callers take a tracer from it.
    The sampler follows the parent decision, and samples new traces by the configured ratio.

    Args:
        settings: The validated settings.

    Returns:
        The tracer provider.
    """
    resource = Resource.create(
        {
            "service.name": settings.service_name,
            "service.version": settings.service_version,
            "deployment.environment": settings.environment,
        },
    )
    provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(settings.sample_ratio)),
    )
    if settings.otlp_endpoint is not None:
        endpoint = f"{settings.otlp_endpoint.rstrip('/')}/v1/traces"
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    return provider


def format_traceparent(context: SpanContext) -> str:
    """Format a span context as a W3C `traceparent` header value.

    Args:
        context: A valid span context.

    Returns:
        The header value, for example `00-<32 hex>-<16 hex>-01`.
    """
    return f"00-{context.trace_id:032x}-{context.span_id:016x}-{int(context.trace_flags):02x}"
