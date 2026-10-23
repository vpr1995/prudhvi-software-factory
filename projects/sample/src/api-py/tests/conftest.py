import io
import json
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from aws_lambda_powertools.utilities.typing import LambdaContext

from sample_api.adapters.notes_store import InMemoryNotesStore
from sample_api.config import load_settings
from sample_api.logging_setup import build_logger, redirect_logger
from sample_api.runtime import Runtime, build_runtime
from sample_api.server import RawRequest, build_event

TRACEPARENT = "traceparent"
INCOMING_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
INCOMING_TRACEPARENT = f"00-{INCOMING_TRACE_ID}-00f067aa0ba902b7-01"


@dataclass
class Reply:
    status: int
    headers: dict[str, str]
    body: dict[str, object]

    def error(self) -> dict[str, object]:
        error = self.body["error"]
        assert isinstance(error, dict)
        return error


@dataclass
class Harness:
    runtime: Runtime
    stream: io.StringIO
    context: LambdaContext = field(default_factory=LambdaContext)

    def get(self, path: str, headers: dict[str, str] | None = None) -> Reply:
        return self.call(RawRequest("GET", path, headers or {}, ""))

    def post(self, path: str, body: str) -> Reply:
        return self.call(RawRequest("POST", path, {}, body))

    def call(self, request: RawRequest) -> Reply:
        event = build_event(request)
        response = self.runtime.handle(event, self.context)
        raw_body = str(response["body"])
        raw_headers = response["headers"]
        assert isinstance(raw_headers, dict)
        return Reply(
            status=int(str(response["statusCode"])),
            headers={str(name).lower(): str(value) for name, value in raw_headers.items()},
            body=json.loads(raw_body) if raw_body else {},
        )

    def log_records(self) -> list[dict[str, object]]:
        lines = [line for line in self.stream.getvalue().splitlines() if line.strip()]
        return [json.loads(line) for line in lines]


def make_harness(store: InMemoryNotesStore | None = None) -> Harness:
    settings = load_settings({})
    stream = io.StringIO()
    logger = build_logger(settings)
    redirect_logger(logger, stream)
    return Harness(build_runtime({}, logger=logger, store=store), stream)


@pytest.fixture
def harness() -> Harness:
    return make_harness()


@pytest.fixture
def make() -> Callable[[InMemoryNotesStore | None], Harness]:
    return make_harness
