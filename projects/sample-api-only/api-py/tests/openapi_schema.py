"""A small OpenAPI schema checker for the contract tests.

It reads the subset of JSON Schema that the contracts package emits (type, properties, required,
items, $ref, const, minLength, maxLength, pattern, additionalProperties). No new dependency is
needed. An unknown keyword fails the check, so a new keyword in the contract cannot pass unseen.
"""

import re
from typing import Any, NamedTuple, cast

_ANNOTATIONS = frozenset({"default", "description", "format", "title", "$schema", "$id"})
_KNOWN = frozenset(
    {
        "type",
        "properties",
        "required",
        "items",
        "$ref",
        "const",
        "minLength",
        "maxLength",
        "pattern",
        "additionalProperties",
        "enum",
    },
)
_TYPES: dict[str, tuple[type, ...]] = {
    "object": (dict,),
    "array": (list,),
    "string": (str,),
    "number": (int, float),
    "integer": (int,),
    "boolean": (bool,),
    "null": (type(None),),
}


class Node(NamedTuple):
    """A value and its path, for the messages."""

    value: object
    where: str


def _resolve(schema: dict[str, Any], document: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if ref is None:
        return schema
    name = str(ref).removeprefix("#/components/schemas/")
    resolved: dict[str, Any] = document["components"]["schemas"][name]
    return resolved


def _check_type(schema: dict[str, Any], node: Node) -> list[str]:
    expected = schema.get("type")
    if expected is None:
        return []
    allowed = _TYPES[str(expected)]
    is_bool_for_number = isinstance(node.value, bool) and expected in {"number", "integer"}
    if not isinstance(node.value, allowed) or is_bool_for_number:
        return [f"{node.where}: expected {expected}, got {type(node.value).__name__}"]
    return []


def _check_string(schema: dict[str, Any], value: str, where: str) -> list[str]:
    problems: list[str] = []
    if "minLength" in schema and len(value) < schema["minLength"]:
        problems.append(f"{where}: shorter than {schema['minLength']}")
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        problems.append(f"{where}: longer than {schema['maxLength']}")
    if "pattern" in schema and re.search(schema["pattern"], value) is None:
        problems.append(f"{where}: does not match {schema['pattern']}")
    return problems


def _check_object(
    document: dict[str, Any],
    schema: dict[str, Any],
    node: Node,
) -> list[str]:
    value = cast("dict[str, Any]", node.value)
    required = schema.get("required", [])
    problems = [f"{node.where}.{name}: missing" for name in required if name not in value]
    properties: dict[str, Any] = schema.get("properties", {})
    for name, item in value.items():
        if name in properties:
            problems.extend(_check(document, properties[name], Node(item, f"{node.where}.{name}")))
        elif schema.get("additionalProperties") is False:
            problems.append(f"{node.where}.{name}: not allowed")
    return problems


def _check(document: dict[str, Any], schema: dict[str, Any], node: Node) -> list[str]:
    schema = _resolve(schema, document)
    unknown = set(schema) - _KNOWN - _ANNOTATIONS
    if unknown:
        return [f"{node.where}: the checker does not know the keyword(s) {sorted(unknown)}"]
    problems = _check_type(schema, node)
    if problems:
        return problems
    if "const" in schema and node.value != schema["const"]:
        problems.append(f"{node.where}: expected {schema['const']!r}")
    if "enum" in schema and node.value not in schema["enum"]:
        problems.append(f"{node.where}: not one of {schema['enum']}")
    if isinstance(node.value, str):
        problems.extend(_check_string(schema, node.value, node.where))
    if isinstance(node.value, dict):
        problems.extend(_check_object(document, schema, node))
    if isinstance(node.value, list) and "items" in schema:
        for index, item in enumerate(node.value):
            problems.extend(_check(document, schema["items"], Node(item, f"{node.where}[{index}]")))
    return problems


def validate(schema: dict[str, Any], value: object, document: dict[str, Any]) -> list[str]:
    """Check a value against an OpenAPI schema.

    Args:
        schema: The schema, or a `$ref` to a component.
        value: The decoded JSON value.
        document: The whole OpenAPI document (for `$ref`).

    Returns:
        The problems. An empty list means the value fits the schema.
    """
    return _check(document, schema, Node(value, "$"))
