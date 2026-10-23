from datetime import UTC, datetime
from uuid import uuid4

from sample_api.domain.health import build_health
from sample_api.domain.notes import (
    MAX_NOTES,
    NOTE_LIMIT_REACHED,
    NOTE_TITLE_TAKEN,
    VALIDATION_ERROR,
    NoteStamp,
    create_note,
    sort_notes,
)
from sample_api.domain.result import Fail, Ok
from sample_api.generated.models import CreateNote, Note

NOW = datetime(2026, 1, 1, tzinfo=UTC)


def _note(title: str, created_at: datetime = NOW) -> Note:
    return Note(id=uuid4(), title=title, body="", createdAt=created_at)


def _stamp() -> NoteStamp:
    return NoteStamp(note_id=uuid4(), now=NOW)


def test_create_note_trims_the_title() -> None:
    result = create_note(CreateNote(title="  Hi  "), [], _stamp())
    assert isinstance(result, Ok)
    assert result.value.title == "Hi"


def test_create_note_rejects_a_blank_title() -> None:
    result = create_note(CreateNote(title="   "), [], _stamp())
    assert isinstance(result, Fail)
    assert result.error.code == VALIDATION_ERROR


def test_create_note_rejects_a_duplicate_title() -> None:
    result = create_note(CreateNote(title="hi"), [_note("HI")], _stamp())
    assert isinstance(result, Fail)
    assert result.error.code == NOTE_TITLE_TAKEN


def test_create_note_rejects_when_the_limit_is_reached() -> None:
    notes = [_note(f"Note {index}") for index in range(MAX_NOTES)]
    result = create_note(CreateNote(title="New"), notes, _stamp())
    assert isinstance(result, Fail)
    assert result.error.code == NOTE_LIMIT_REACHED


def test_sort_notes_orders_oldest_first() -> None:
    older = _note("older", datetime(2025, 1, 1, tzinfo=UTC))
    newer = _note("newer", datetime(2026, 1, 1, tzinfo=UTC))
    assert [note.title for note in sort_notes([newer, older])] == ["older", "newer"]


def test_build_health_reports_ok() -> None:
    assert build_health("svc", "1.2.3").model_dump() == {
        "status": "ok",
        "service": "svc",
        "version": "1.2.3",
    }
