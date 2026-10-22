import io
import json

import pytest

from sample_api.config import load_settings
from sample_api.logging_setup import REDACTED_TEXT, build_logger, redact, redirect_logger


def test_redirect_logger_rejects_a_logger_without_a_stream_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = build_logger(load_settings({}))
    monkeypatch.setattr(type(logger), "registered_handler", object())
    with pytest.raises(TypeError, match="stream handler"):
        redirect_logger(logger, io.StringIO())


def test_a_log_line_outside_a_span_has_no_trace_fields() -> None:
    stream = io.StringIO()
    logger = build_logger(load_settings({}))
    redirect_logger(logger, stream)
    logger.warning("outside a span")
    line = stream.getvalue()
    assert '"level":"warn"' in line
    assert "trace_id" not in line


def _redacted_log_line(fields: dict[str, object]) -> dict[str, object]:
    stream = io.StringIO()
    logger = build_logger(load_settings({}))
    redirect_logger(logger, stream)
    logger.info("http", extra=fields)
    parsed: dict[str, object] = json.loads(stream.getvalue())
    return parsed


def test_secret_keys_are_redacted_in_any_spelling() -> None:
    line = _redacted_log_line(
        {
            "access_token": "a",
            "refreshToken": "r",
            "api_key": "k",
            "password": "p",
            "accept": "json",
        },
    )
    assert line["access_token"] == REDACTED_TEXT
    assert line["refreshToken"] == REDACTED_TEXT
    assert line["api_key"] == REDACTED_TEXT
    assert line["password"] == REDACTED_TEXT
    assert line["accept"] == "json"


def test_secret_headers_are_redacted_in_nested_mappings() -> None:
    line = _redacted_log_line(
        {
            "req": {
                "headers": {
                    "authorization": "Bearer x",
                    "proxy-authorization": "Basic y",
                    "x-api-key": "k",
                    "accept": "json",
                },
            },
            "res": {"headers": [{"Set-Cookie": "sid=1"}]},
        },
    )
    assert line["req"] == {
        "headers": {
            "authorization": REDACTED_TEXT,
            "proxy-authorization": REDACTED_TEXT,
            "x-api-key": REDACTED_TEXT,
            "accept": "json",
        },
    }
    assert line["res"] == {"headers": [{"Set-Cookie": REDACTED_TEXT}]}


def test_redact_stops_below_the_depth_limit() -> None:
    deep: object = {"password": "p"}
    for _ in range(6):
        deep = {"level": deep}
    assert redact(deep) == deep
