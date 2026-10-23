"""Prepare the OpenAPI document for datamodel-code-generator.

Zod emits a ``pattern`` next to ``format: uuid`` and ``format: date-time``. Pydantic cannot apply a
``pattern`` to a ``UUID`` or ``datetime`` type and raises ``TypeError`` when the model loads. The
format already carries the rule, so this script drops the pattern in that case only. It never
changes the contracts package.
"""

import json
import sys
from pathlib import Path

FORMATS_WITH_TYPE = frozenset({"uuid", "date-time"})
INDENT = 2
EXPECTED_ARGUMENTS = 3


def strip_patterns(node: object) -> object:
    """Return a copy of ``node`` without the ``pattern`` of typed string formats.

    Args:
        node: A JSON value (dict, list, or scalar).

    Returns:
        The same structure, with ``pattern`` removed where ``format`` is a typed format.
    """
    if isinstance(node, dict):
        cleaned = {key: strip_patterns(value) for key, value in node.items()}
        if cleaned.get("format") in FORMATS_WITH_TYPE:
            cleaned.pop("pattern", None)
        return cleaned
    if isinstance(node, list):
        return [strip_patterns(item) for item in node]
    return node


def main(arguments: list[str]) -> int:
    """Read the source document and write the prepared document.

    Args:
        arguments: ``[script, source_path, target_path]``.

    Returns:
        The process exit code.
    """
    if len(arguments) != EXPECTED_ARGUMENTS:
        sys.stderr.write("usage: prepare_schema.py <source.json> <target.json>\n")
        return 2
    source = json.loads(Path(arguments[1]).read_text(encoding="utf-8"))
    prepared = json.dumps(strip_patterns(source), indent=INDENT)
    Path(arguments[2]).write_text(f"{prepared}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
