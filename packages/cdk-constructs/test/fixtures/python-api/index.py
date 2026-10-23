"""A handler for the tests. CDK never runs it, because the tests do not bundle."""


def handler(event: object, context: object) -> dict[str, int]:
    """Return an empty response."""
    return {"statusCode": 200}
