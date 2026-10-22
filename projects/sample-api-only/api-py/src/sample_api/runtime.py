"""The Lambda entry logic: continue the trace, run the app, echo `traceparent`, flush spans."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import SpanKind, Status, StatusCode

from sample_api.adapters.notes_store import InMemoryNotesStore
from sample_api.app import ROUTE_TEMPLATES, AppDependencies, build_app
from sample_api.config import Settings, load_settings
from sample_api.logging_setup import build_logger
from sample_api.telemetry import (
    PROPAGATOR,
    TRACEPARENT_HEADER,
    format_traceparent,
    init_telemetry,
)

_SERVER_ERROR_FLOOR = 500
FLUSH_TIMEOUT_MILLIS = 2000
_UNMATCHED = "unmatched"

type LambdaEvent = dict[str, object]
type LambdaResponse = dict[str, object]
type EventHandler = Callable[[LambdaEvent, LambdaContext], LambdaResponse]


@dataclass(frozen=True, slots=True)
class Runtime:
    """The wired service.

    Attributes:
        settings: The validated settings.
        logger: The structured logger.
        provider: The tracer provider.
        handle: The Lambda handler. It takes an HTTP API v2 event and returns the response.
    """

    settings: Settings
    logger: Logger
    provider: TracerProvider
    handle: EventHandler


def _request_line(event: LambdaEvent) -> tuple[str, str]:
    """Read the method and the path of an HTTP API v2 event."""
    context = event.get("requestContext")
    http = context.get("http") if isinstance(context, dict) else None
    if not isinstance(http, dict):
        return "GET", str(event.get("rawPath", "/"))
    return str(http.get("method", "GET")).upper(), str(http.get("path", "/"))


def _headers(event: LambdaEvent) -> dict[str, str]:
    """Return the request headers with lower-case names."""
    raw = event.get("headers")
    if not isinstance(raw, dict):
        return {}
    return {str(name).lower(): str(value) for name, value in raw.items()}


def _span_name(method: str, path: str) -> str:
    """Name a server span `<METHOD> <route template>`. Unknown paths share one name."""
    return f"{method} {path if (method, path) in ROUTE_TEMPLATES else _UNMATCHED}"


def _flush_spans(provider: TracerProvider, log: Logger) -> None:
    """Flush the pending spans without raising and without waiting longer than the bound.

    A collector that fails or hangs must not replace or delay the response. The problem is only
    logged as a warning.

    Args:
        provider: The tracer provider.
        log: The logger for the warning.
    """
    try:
        flushed = provider.force_flush(timeout_millis=FLUSH_TIMEOUT_MILLIS)
    # Network and exporter failures (OSError covers ConnectionError and timeouts) must not
    # replace the response.
    except (OSError, RuntimeError, ValueError) as error:
        log.warning("flush spans failed", error=str(error))
        return
    if not flushed:
        log.warning("flush spans timed out", timeout_millis=FLUSH_TIMEOUT_MILLIS)


def build_runtime(
    environ: Mapping[str, str],
    logger: Logger | None = None,
    store: InMemoryNotesStore | None = None,
) -> Runtime:
    """Wire settings, telemetry, logger, store, and app.

    Args:
        environ: The environment variables.
        logger: A logger to use. Tests pass one that writes to a buffer.
        store: A notes store to use. Defaults to an empty in-memory store.

    Returns:
        The runtime. Build it once per cold start.
    """
    settings = load_settings(environ)
    provider = init_telemetry(settings)
    tracer = provider.get_tracer("sample_api")
    log = logger if logger is not None else build_logger(settings)
    app = build_app(
        AppDependencies(settings=settings, logger=log, store=store or InMemoryNotesStore())
    )

    def handle(event: LambdaEvent, context: LambdaContext) -> LambdaResponse:
        method, path = _request_line(event)
        parent = PROPAGATOR.extract(_headers(event))
        with tracer.start_as_current_span(
            _span_name(method, path),
            context=parent,
            kind=SpanKind.SERVER,
            attributes={"http.request.method": method},
        ) as span:
            response = app.resolve(event, context)
            status = int(response["statusCode"])
            span.set_attribute("http.response.status_code", status)
            if status >= _SERVER_ERROR_FLOOR:
                span.set_status(Status(StatusCode.ERROR))
            headers = dict(response.get("headers") or {})
            headers[TRACEPARENT_HEADER] = format_traceparent(span.get_span_context())
            response["headers"] = headers
            log.info("request completed", http_method=method, status_code=status)
        _flush_spans(provider, log)
        return dict(response)

    return Runtime(settings=settings, logger=log, provider=provider, handle=handle)
