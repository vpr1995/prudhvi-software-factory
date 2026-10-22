from sample_api.adapters.notes_store import InMemoryNotesStore
from sample_api.generated.models import Note

from .conftest import Harness, make_harness


class BrokenStore(InMemoryNotesStore):
    def list_all(self) -> list[Note]:
        message = "storage is down"
        raise RuntimeError(message)


def test_unexpected_error_returns_a_generic_500_with_the_trace_id() -> None:
    harness: Harness = make_harness(BrokenStore())
    reply = harness.get("/v1/notes")
    assert reply.status == 500
    assert reply.error()["code"] == "INTERNAL_ERROR"
    assert "storage is down" not in str(reply.body)
    trace_id = reply.headers["traceparent"].split("-")[1]
    assert reply.error()["requestId"] == trace_id
    error_records = [record for record in harness.log_records() if record["level"] == "error"]
    assert error_records
    assert error_records[0]["trace_id"] == trace_id
