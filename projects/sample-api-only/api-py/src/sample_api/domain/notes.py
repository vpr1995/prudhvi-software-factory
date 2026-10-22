"""Rules for notes."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sample_api.domain.result import Fail, Ok, Result
from sample_api.generated.models import CreateNote, Note

MAX_NOTES = 100

VALIDATION_ERROR = "VALIDATION_ERROR"
NOTE_TITLE_TAKEN = "NOTE_TITLE_TAKEN"
NOTE_LIMIT_REACHED = "NOTE_LIMIT_REACHED"


@dataclass(frozen=True, slots=True)
class NoteError:
    """An expected error of a note rule.

    Attributes:
        code: The error code in UPPER_SNAKE_CASE.
        message: A short message with no secrets or personal data.
    """

    code: str
    message: str


@dataclass(frozen=True, slots=True)
class NoteStamp:
    """Values that the caller creates, so the rules stay pure.

    Attributes:
        note_id: The id of the new note.
        now: The current time, with a time zone.
    """

    note_id: UUID
    now: datetime


def create_note(
    request: CreateNote,
    existing_notes: Sequence[Note],
    stamp: NoteStamp,
) -> Result[Note, NoteError]:
    """Apply the rules for a new note.

    Args:
        request: The validated request body.
        existing_notes: The stored notes.
        stamp: A new id and the current time.

    Returns:
        The new note, or an expected error.
    """
    title = request.title.strip()
    if not title:
        return Fail(NoteError(VALIDATION_ERROR, "The request is not valid."))
    if len(existing_notes) >= MAX_NOTES:
        return Fail(NoteError(NOTE_LIMIT_REACHED, f"The service stores at most {MAX_NOTES} notes."))
    key = title.lower()
    if any(note.title.lower() == key for note in existing_notes):
        return Fail(NoteError(NOTE_TITLE_TAKEN, "A note with this title exists."))
    return Ok(
        Note(id=stamp.note_id, title=title, body=request.body or "", createdAt=stamp.now),
    )


def sort_notes(notes: Sequence[Note]) -> list[Note]:
    """Sort notes by creation time, oldest first.

    Args:
        notes: The notes to sort.

    Returns:
        A new sorted list.
    """
    return sorted(notes, key=lambda note: note.createdAt)
