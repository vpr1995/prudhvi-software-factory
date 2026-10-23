"""The routes. They sit on the Powertools `APIGatewayHttpResolver`."""

from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from uuid import uuid4

from aws_lambda_powertools import Logger
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from sample_api.adapters.notes_store import InMemoryNotesStore
from sample_api.config import Settings
from sample_api.domain.health import build_health
from sample_api.domain.notes import (
    NOTE_LIMIT_REACHED,
    NOTE_TITLE_TAKEN,
    VALIDATION_ERROR,
    NoteStamp,
    create_note,
    sort_notes,
)
from sample_api.domain.result import Fail
from sample_api.generated.models import (
    Error,
    ErrorEnvelope,
    ListNotesResponse,
)
from sample_api.parsing import parse_create_note

JSON = "application/json"

ROUTE_TEMPLATES = frozenset(
    {("GET", "/v1/health"), ("GET", "/v1/notes"), ("POST", "/v1/notes")},
)

_STATUS_BY_CODE = {
    VALIDATION_ERROR: HTTPStatus.BAD_REQUEST,
    NOTE_TITLE_TAKEN: HTTPStatus.CONFLICT,
    NOTE_LIMIT_REACHED: HTTPStatus.CONFLICT,
}


@dataclass(frozen=True, slots=True)
class AppDependencies:
    """What the app needs from the outside.

    Attributes:
        settings: The validated settings.
        logger: The structured logger.
        store: Where notes live.
    """

    settings: Settings
    logger: Logger
    store: InMemoryNotesStore


def current_trace_id() -> str | None:
    """Return the trace id of the active span.

    Returns:
        32 hex characters, or `None` when no span is active.
    """
    context = trace.get_current_span().get_span_context()
    return f"{context.trace_id:032x}" if context.is_valid else None


def json_response(status: HTTPStatus, model: BaseModel) -> Response[str]:
    """Build a JSON response from a model.

    Args:
        status: The HTTP status.
        model: The body.

    Returns:
        The Powertools response.
    """
    return Response(
        status_code=status.value,
        content_type=JSON,
        body=model.model_dump_json(),
    )


def error_response(status: HTTPStatus, code: str, message: str) -> Response[str]:
    """Build the error envelope. `requestId` is the trace id.

    Args:
        status: The HTTP status.
        code: The error code in UPPER_SNAKE_CASE.
        message: A short message with no secrets or personal data.

    Returns:
        The Powertools response.
    """
    error = Error(code=code, message=message, requestId=current_trace_id() or "")
    return json_response(status, ErrorEnvelope(error=error))


def build_app(deps: AppDependencies) -> APIGatewayHttpResolver:
    """Build the resolver with its routes and error handlers.

    Args:
        deps: The settings, the logger, and the store.

    Returns:
        The resolver. Build it once per cold start.
    """
    app = APIGatewayHttpResolver()
    settings, logger, store = deps.settings, deps.logger, deps.store

    @app.get("/v1/health")
    def get_health() -> Response[str]:
        health = build_health(settings.service_name, settings.service_version)
        return json_response(HTTPStatus.OK, health)

    @app.get("/v1/notes")
    def list_notes() -> Response[str]:
        notes = sort_notes(store.list_all())
        logger.info("notes listed", count=len(notes))
        return json_response(HTTPStatus.OK, ListNotesResponse(notes=notes))

    @app.post("/v1/notes")
    def post_note() -> Response[str]:
        try:
            request = parse_create_note(app.current_event.body or "")
        except ValueError:
            logger.info("note rejected", code=VALIDATION_ERROR)
            return error_response(
                HTTPStatus.BAD_REQUEST,
                VALIDATION_ERROR,
                "The request is not valid.",
            )
        stamp = NoteStamp(note_id=uuid4(), now=datetime.now(UTC))
        result = create_note(request, store.list_all(), stamp)
        if isinstance(result, Fail):
            logger.info("note rejected", code=result.error.code)
            status = _STATUS_BY_CODE.get(result.error.code, HTTPStatus.BAD_REQUEST)
            return error_response(status, result.error.code, result.error.message)
        store.add(result.value)
        logger.info("note created", note_id=str(result.value.id))
        return json_response(HTTPStatus.CREATED, result.value)

    @app.not_found
    def handle_not_found(_error: Exception) -> Response[str]:
        return error_response(HTTPStatus.NOT_FOUND, "NOT_FOUND", "The route does not exist.")

    @app.exception_handler(Exception)
    def handle_unexpected(error: Exception) -> Response[str]:
        logger.exception("request failed")
        span = trace.get_current_span()
        span.record_exception(error)
        span.set_status(Status(StatusCode.ERROR))
        return error_response(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "The service failed. Try again later.",
        )

    return app
