"""A small Result type. Expected errors are values. Bugs raise."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Ok[T]:
    """A success.

    Attributes:
        value: The result value.
    """

    value: T


@dataclass(frozen=True, slots=True)
class Fail[E]:
    """An expected failure.

    Attributes:
        error: The error value.
    """

    error: E


type Result[T, E] = Ok[T] | Fail[E]
