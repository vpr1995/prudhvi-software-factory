import re

from sample_api.server import RawRequest

from .conftest import INCOMING_TRACE_ID, INCOMING_TRACEPARENT, TRACEPARENT, Harness

TRACEPARENT_PATTERN = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")


def _trace_id(header: str) -> str:
    match = TRACEPARENT_PATTERN.match(header)
    assert match is not None
    return match.group(1)


def test_every_response_has_a_traceparent_header(harness: Harness) -> None:
    for method, path in [("GET", "/v1/health"), ("GET", "/v1/notes"), ("GET", "/missing")]:
        assert TRACEPARENT_PATTERN.match(
            harness.call(RawRequest(method, path, {}, "")).headers[TRACEPARENT]
        )


def test_trace_id_lands_in_the_log_record_and_the_response_header(harness: Harness) -> None:
    reply = harness.get("/v1/notes")
    trace_id = _trace_id(reply.headers[TRACEPARENT])
    records = harness.log_records()
    assert records, "the request must write a log line"
    for record in records:
        assert record["trace_id"] == trace_id
        assert re.fullmatch(r"[0-9a-f]{16}", str(record["span_id"]))
        assert re.fullmatch(r"[0-9a-f]{2}", str(record["trace_flags"]))


def test_incoming_traceparent_is_continued(harness: Harness) -> None:
    reply = harness.get("/v1/notes", headers={TRACEPARENT: INCOMING_TRACEPARENT})
    assert _trace_id(reply.headers[TRACEPARENT]) == INCOMING_TRACE_ID
    assert {record["trace_id"] for record in harness.log_records()} == {INCOMING_TRACE_ID}


def test_error_envelope_request_id_is_the_trace_id(harness: Harness) -> None:
    reply = harness.post("/v1/notes", '{"title": ""}')
    assert reply.error()["requestId"] == _trace_id(reply.headers[TRACEPARENT])


def test_log_lines_use_the_shared_field_names(harness: Harness) -> None:
    harness.get("/v1/notes")
    record = harness.log_records()[0]
    assert record["service.name"] == "sample-api-only-api-py"
    assert record["level"] == "info"
    assert {"msg", "time"} <= record.keys()
    assert not {"message", "timestamp", "service", "xray_trace_id"} & record.keys()
