"""Read request bodies the way the contract does."""

import json

from sample_api.generated.models import CreateNote


def parse_create_note(raw: str) -> CreateNote:
    """Parse the body of `POST /v1/notes`.

    The Zod schema in the contracts package is the reference: it trims the title before it checks
    the length, and it rejects `null` for the body. The generated Pydantic model checks the raw
    title and accepts `null`, so this function applies the two rules first.

    Args:
        raw: The raw request body.

    Returns:
        The validated request.

    Raises:
        ValueError: The body is not valid JSON, or it does not fit the contract.
            `pydantic.ValidationError` and `json.JSONDecodeError` are both `ValueError`.
    """
    payload = json.loads(raw)
    if isinstance(payload, dict):
        title = payload.get("title")
        if isinstance(title, str):
            payload = {**payload, "title": title.strip()}
        if "body" in payload and payload["body"] is None:
            message = "body must be a string."
            raise ValueError(message)
    return CreateNote.model_validate(payload)
