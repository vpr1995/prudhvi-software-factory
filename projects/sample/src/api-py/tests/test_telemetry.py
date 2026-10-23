from opentelemetry.trace import SpanContext, TraceFlags

from sample_api.config import load_settings
from sample_api.telemetry import format_traceparent, init_telemetry


def test_format_traceparent() -> None:
    context = SpanContext(
        trace_id=0x4BF92F3577B34DA6A3CE929D0E0E4736,
        span_id=0x00F067AA0BA902B7,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    assert format_traceparent(context) == "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def test_init_telemetry_sets_resource_attributes() -> None:
    provider = init_telemetry(load_settings({}))
    attributes = provider.resource.attributes
    assert attributes["service.name"] == "sample-api-py"
    assert attributes["deployment.environment"] == "local"


def test_init_telemetry_adds_an_exporter_only_with_an_endpoint() -> None:
    provider = init_telemetry(load_settings({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:1/"}))
    assert provider.force_flush()
    provider.shutdown()
