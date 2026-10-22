import json
from uuid import uuid4

import pytest
from pydantic import ValidationError

from sample_api.generated.models import CreateNote, ErrorEnvelope, Health, ListNotesResponse, Note

VALID_NOTE = {
    "id": str(uuid4()),
    "title": "A title",
    "body": "",
    "createdAt": "2026-01-01T00:00:00.000Z",
}


def test_note_round_trips() -> None:
    note = Note.model_validate_json(json.dumps(VALID_NOTE))
    assert json.loads(note.model_dump_json())["title"] == "A title"


def test_list_response_round_trips() -> None:
    parsed = ListNotesResponse.model_validate({"notes": [VALID_NOTE]})
    assert len(parsed.notes) == 1


def test_health_round_trips_and_rejects_a_wrong_status() -> None:
    assert Health.model_validate({"status": "ok", "service": "s", "version": "1"}).status == "ok"
    with pytest.raises(ValidationError):
        Health.model_validate({"status": "down", "service": "s", "version": "1"})


def test_error_envelope_rejects_a_lower_case_code() -> None:
    with pytest.raises(ValidationError):
        ErrorEnvelope.model_validate({"error": {"code": "bad", "message": "m", "requestId": "r"}})


@pytest.mark.parametrize("payload", [{"title": ""}, {"title": "a" * 121}, {"title": "a", "x": 1}])
def test_create_note_rejects_invalid_bodies(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CreateNote.model_validate(payload)
