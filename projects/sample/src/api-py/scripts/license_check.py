"""Check Python dependency licenses against tooling/license-allowlist.json.

The policy is the same as scripts/security/license-check.sh for JavaScript:

- runtime dependencies must use a license of the strict ``runtime`` list,
- dev-only dependencies can use a license of the ``runtime`` or the ``tooling`` list.

``pip-licenses`` reports the license text from the package metadata, not an SPDX id.
This script maps the known texts to SPDX ids and fails on any text it does not know.
An entry of ``excludePackages`` skips one package. It is ``name@version`` or ``name@major``,
as in the JavaScript check.
"""

import json
import re
import sys
from pathlib import Path

EXPECTED_ARGUMENTS = 5

# What pip-licenses prints -> SPDX ids that it can stand for. "BSD License" does not say
# which BSD license it is, so it stands for any BSD id.
LICENSE_TEXTS: dict[str, tuple[str, ...]] = {
    "MIT License": ("MIT",),
    "Apache Software License": ("Apache-2.0",),
    "BSD License": ("BSD-2-Clause", "BSD-3-Clause"),
    "3-Clause BSD License": ("BSD-3-Clause",),
    "ISC License (ISCL)": ("ISC",),
    "Mozilla Public License 2.0 (MPL 2.0)": ("MPL-2.0",),
    "Python Software Foundation License": ("PSF-2.0",),
    "MIT No Attribution License (MIT-0)": ("MIT-0",),
}


def normalize_name(name: str) -> str:
    """Return a package name in the canonical form of PEP 503.

    Args:
        name: A package name.

    Returns:
        The lower-case name with runs of ``-``, ``_`` and ``.`` replaced by ``-``.
    """
    return re.sub(r"[-_.]+", "-", name).lower()


def _term_allowed(term: str, allowed: frozenset[str]) -> bool:
    """Check one license term: an SPDX id or a known text."""
    candidates = LICENSE_TEXTS.get(term.strip(), (term.strip(),))
    return any(candidate in allowed for candidate in candidates)


def _unwrap(option: str) -> str:
    """Remove the parentheses that wrap a whole option, as in ``(MIT OR CC0-1.0)``."""
    stripped = option.strip()
    return stripped[1:-1] if stripped.startswith("(") and stripped.endswith(")") else stripped


def license_allowed(text: str, allowed: frozenset[str]) -> bool:
    """Check a license expression.

    ``A OR B`` passes when one side passes. ``A; B`` and ``A AND B`` pass when both sides pass.

    Args:
        text: The license text from pip-licenses.
        allowed: The allowed SPDX ids.

    Returns:
        True when the expression is allowed.
    """
    options = [_unwrap(option) for option in re.split(r"\s+OR\s+", text)]
    return any(
        all(_term_allowed(term, allowed) for term in re.split(r";|\s+AND\s+", option))
        for option in options
    )


def runtime_names(requirements: str) -> frozenset[str]:
    """Read package names from the output of ``uv export``.

    Args:
        requirements: The text of a requirements file.

    Returns:
        The normalized package names.
    """
    names = set()
    for line in requirements.splitlines():
        match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==", line.strip())
        if match:
            names.add(normalize_name(match.group(1)))
    return frozenset(names)


def find_violations(
    packages: list[dict[str, str]],
    runtime: frozenset[str],
    allowlist: dict[str, list[str]],
) -> list[str]:
    """Return one message for each package with a license that is not allowed.

    Args:
        packages: The pip-licenses JSON rows (``Name``, ``Version``, ``License``).
        runtime: The normalized names of the runtime packages.
        allowlist: The parsed allowlist file.

    Returns:
        The violation messages. An empty list means pass.
    """
    strict = frozenset(allowlist["runtime"])
    relaxed = strict | frozenset(allowlist["tooling"])
    excluded = {entry.lower() for entry in allowlist.get("excludePackages", [])}
    messages = []
    for package in packages:
        name, version, text = package["Name"], package["Version"], package["License"]
        key = f"{normalize_name(name)}@"
        if {f"{key}{version}".lower(), f"{key}{version.split('.')[0]}".lower()} & excluded:
            continue
        if name.startswith("sample-api-py"):
            continue
        is_runtime = normalize_name(name) in runtime
        if not license_allowed(text, strict if is_runtime else relaxed):
            kind = "runtime (strict list)" if is_runtime else "dev (runtime + tooling list)"
            messages.append(f"{name}@{version}: license '{text}' is not allowed for {kind}")
    return messages


def main(arguments: list[str]) -> int:
    """Run the check.

    Args:
        arguments: ``[script, allowlist.json, runtime-requirements.txt, licenses.json, label]``.

    Returns:
        0 on pass, 1 on violations, 2 on bad usage.
    """
    if len(arguments) != EXPECTED_ARGUMENTS:
        sys.stderr.write(
            "usage: license_check.py <allowlist> <runtime.txt> <licenses.json> <label>\n"
        )
        return 2
    allowlist = json.loads(Path(arguments[1]).read_text(encoding="utf-8"))
    runtime = runtime_names(Path(arguments[2]).read_text(encoding="utf-8"))
    packages = json.loads(Path(arguments[3]).read_text(encoding="utf-8"))
    messages = find_violations(packages, runtime, allowlist)
    if messages:
        sys.stderr.write("\n".join(messages) + f"\nlicense-check ({arguments[4]}): FAIL\n")
        return 1
    sys.stdout.write(f"license-check ({arguments[4]}): all licenses allowed\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
