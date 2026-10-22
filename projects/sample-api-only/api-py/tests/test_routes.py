import pytest

from sample_api.server import RawRequest

from .conftest import Harness


def test_health_returns_service_and_version(harness: Harness) -> None:
    reply = harness.get("/v1/health")
    assert reply.status == 200
    assert reply.body == {"status": "ok", "service": "sample-api-only-api-py", "version": "0.0.0"}


def test_notes_list_is_empty_at_start(harness: Harness) -> None:
    reply = harness.get("/v1/notes")
    assert (reply.status, reply.body) == (200, {"notes": []})


def test_create_then_list_returns_the_note(harness: Harness) -> None:
    created = harness.post("/v1/notes", '{"title": "  First  ", "body": "text"}')
    assert created.status == 201
    assert created.body["title"] == "First"
    listed = harness.get("/v1/notes")
    notes = listed.body["notes"]
    assert isinstance(notes, list)
    assert [note["title"] for note in notes] == ["First"]


def test_create_without_body_field_uses_empty_body(harness: Harness) -> None:
    reply = harness.post("/v1/notes", '{"title": "No body"}')
    assert (reply.status, reply.body["body"]) == (201, "")


@pytest.mark.parametrize(
    "raw_body",
    ['{"title": ""}', '{"title": "   "}', "{}", "not json", '{"title": "a", "extra": 1}', ""],
)
def test_create_rejects_an_invalid_body(harness: Harness, raw_body: str) -> None:
    reply = harness.post("/v1/notes", raw_body)
    assert reply.status == 400
    assert reply.error()["code"] == "VALIDATION_ERROR"


def test_duplicate_title_conflicts_ignoring_case(harness: Harness) -> None:
    harness.post("/v1/notes", '{"title": "Same"}')
    reply = harness.post("/v1/notes", '{"title": "SAME"}')
    assert reply.status == 409
    assert reply.error()["code"] == "NOTE_TITLE_TAKEN"


def test_note_limit_conflicts(harness: Harness) -> None:
    for index in range(100):
        assert harness.post("/v1/notes", f'{{"title": "Note {index}"}}').status == 201
    reply = harness.post("/v1/notes", '{"title": "One more"}')
    assert reply.status == 409
    assert reply.error()["code"] == "NOTE_LIMIT_REACHED"


@pytest.mark.parametrize(("method", "path"), [("GET", "/nope"), ("POST", "/v1/health")])
def test_unknown_route_returns_the_envelope(harness: Harness, method: str, path: str) -> None:
    reply = harness.call(RawRequest(method, path, {}, ""))
    assert reply.status == 404
    assert reply.error()["code"] == "NOT_FOUND"
