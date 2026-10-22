"""Check the app against the OpenAPI document from the contracts package.

Each route must exist, each documented response must happen, and each real response body must fit
the schema of the document and the generated Pydantic model. The shared edge cases in
`contracts/fixtures/create-note-cases.json` run against the real handler too.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from sample_api.generated import models
from sample_api.server import RawRequest

from .conftest import Harness, Reply
from .openapi_schema import validate

CONTRACTS = Path(__file__).parents[2] / "contracts"
DOCUMENT: dict[str, Any] = json.loads((CONTRACTS / "dist" / "openapi.json").read_text("utf-8"))
CASES: list[dict[str, Any]] = json.loads(
    (CONTRACTS / "fixtures" / "create-note-cases.json").read_text("utf-8"),
)["cases"]
OPERATIONS = [
    (method.upper(), path) for path, methods in DOCUMENT["paths"].items() for method in methods
]
RESPONSES = [
    (method.upper(), path, status)
    for path, methods in DOCUMENT["paths"].items()
    for method, operation in methods.items()
    for status in operation["responses"]
]
VALID = json.dumps({"title": "First"})


def _create_valid(harness: Harness) -> Reply:
    return harness.post("/v1/notes", VALID)


def _create_invalid(harness: Harness) -> Reply:
    return harness.post("/v1/notes", json.dumps({"title": ""}))


def _create_duplicate(harness: Harness) -> Reply:
    harness.post("/v1/notes", VALID)
    return harness.post("/v1/notes", VALID)


def _list_with_a_note(harness: Harness) -> Reply:
    harness.post("/v1/notes", VALID)
    return harness.get("/v1/notes")


# One way to cause each documented response. A new route or status in the contract fails
# `test_every_documented_response_has_a_scenario` until a scenario exists here.
SCENARIOS: dict[tuple[str, str, str], Callable[[Harness], Reply]] = {
    ("GET", "/v1/health", "200"): lambda harness: harness.get("/v1/health"),
    ("GET", "/v1/notes", "200"): _list_with_a_note,
    ("POST", "/v1/notes", "201"): _create_valid,
    ("POST", "/v1/notes", "400"): _create_invalid,
    ("POST", "/v1/notes", "409"): _create_duplicate,
}


def _schema_of(method: str, path: str, status: str) -> dict[str, Any]:
    response = DOCUMENT["paths"][path][method.lower()]["responses"][status]
    schema: dict[str, Any] = response["content"]["application/json"]["schema"]
    return schema


def _model_of(schema: dict[str, Any]) -> type[BaseModel]:
    model: object = getattr(models, str(schema["$ref"]).rsplit("/", maxsplit=1)[-1])
    assert isinstance(model, type)
    assert issubclass(model, BaseModel)
    return model


@pytest.mark.parametrize(("method", "path"), OPERATIONS)
def test_route_in_the_contract_is_implemented(harness: Harness, method: str, path: str) -> None:
    reply = harness.call(RawRequest(method, path, {}, "{}" if method == "POST" else ""))
    assert reply.status != 404
    assert reply.status < 500


def test_the_contract_has_routes() -> None:
    assert OPERATIONS
    assert RESPONSES


@pytest.mark.parametrize(("method", "path", "status"), RESPONSES)
def test_every_documented_response_has_a_scenario(method: str, path: str, status: str) -> None:
    assert (method, path, status) in SCENARIOS


@pytest.mark.parametrize("response", RESPONSES)
def test_the_response_body_fits_the_schema_and_the_generated_model(
    harness: Harness,
    response: tuple[str, str, str],
) -> None:
    method, path, status = response
    reply = SCENARIOS[response](harness)
    schema = _schema_of(method, path, status)
    assert str(reply.status) == status
    assert validate(schema, reply.body, DOCUMENT) == []
    _model_of(schema).model_validate(reply.body)


def test_the_checker_finds_a_wrong_body() -> None:
    schema = {"$ref": "#/components/schemas/Note"}
    wrong = {"id": "x", "title": "", "body": 5, "createdAt": "yesterday", "extra": 1}
    problems = validate(schema, wrong, DOCUMENT)
    assert len(problems) >= 4
    assert validate(schema, {}, DOCUMENT) != []


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_create_note_edge_cases_agree_with_the_contract(
    make: Callable[[None], Harness],
    case: dict[str, Any],
) -> None:
    reply = make(None).call(RawRequest("POST", "/v1/notes", {}, case["raw"]))
    assert reply.status == case["status"]
    if case["status"] == 201:
        assert validate(_schema_of("POST", "/v1/notes", "201"), reply.body, DOCUMENT) == []
        assert reply.body["title"] == case["title"]
        assert reply.body["body"] == case["body"]
    else:
        assert validate(_schema_of("POST", "/v1/notes", "400"), reply.body, DOCUMENT) == []
