"""Where notes live. A real project swaps this for a database adapter."""

import threading

from sample_api.generated.models import Note


class InMemoryNotesStore:
    """Keeps notes in memory. Lambda keeps the data only while the container lives."""

    def __init__(self) -> None:
        """Create an empty store."""
        self._notes: list[Note] = []
        self._lock = threading.Lock()

    def list_all(self) -> list[Note]:
        """Return a copy of the stored notes.

        Returns:
            The notes in insertion order.
        """
        with self._lock:
            return list(self._notes)

    def add(self, note: Note) -> None:
        """Store a note.

        Args:
            note: The note to store.
        """
        with self._lock:
            self._notes.append(note)
