"""JSON logs with the field names of docs/standards/observability.md, section 3."""

import logging
from typing import TextIO

from aws_lambda_powertools import Logger
from aws_lambda_powertools.logging.formatter import LambdaPowertoolsFormatter
from aws_lambda_powertools.logging.types import LogRecord
from opentelemetry import trace

from sample_api.config import Settings

_RENAMED_KEYS = {"message": "msg", "timestamp": "time", "service": "service.name"}
_DROPPED_KEYS = frozenset({"xray_trace_id", "location"})
_LEVEL_NAMES = {"WARNING": "warn", "CRITICAL": "error"}
REDACTED_TEXT = "[REDACTED]"
_REDACTION_DEPTH = 4
# Same keys as REDACTED_KEYS in packages/logger/src/redact.ts. A key matches when its lower case
# form without "_" and "-" is in this set, so `access_token`, `accessToken` and `Access-Token`
# all match.
_REDACTED_KEYS = frozenset(
    {
        "password",
        "passwd",
        "token",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "sessiontoken",
        "authtoken",
        "secret",
        "clientsecret",
        "apikey",
        "privatekey",
        "authorization",
        "proxyauthorization",
        "cookie",
        "setcookie",
        "xapikey",
        "xauthtoken",
        "xcsrftoken",
        "xamzsecuritytoken",
        "email",
        "phone",
        "ssn",
    },
)


def _is_secret_key(key: object) -> bool:
    """Tell whether a log key holds a secret or personal data.

    Args:
        key: A key of a log record or of a nested mapping.

    Returns:
        True when the value must be redacted.
    """
    return str(key).lower().replace("_", "").replace("-", "") in _REDACTED_KEYS


def redact(value: object, depth: int = _REDACTION_DEPTH) -> object:
    """Replace the values of secret keys with `[REDACTED]`, in nested mappings and lists.

    Args:
        value: A log value.
        depth: How many nested levels are still searched.

    Returns:
        A copy of the value where secret keys hold `[REDACTED]`. Other values are not changed.
    """
    if depth < 0:
        return value
    if isinstance(value, dict):
        return {
            key: REDACTED_TEXT if _is_secret_key(key) else redact(item, depth - 1)
            for key, item in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact(item, depth - 1) for item in value]
    return value


class TraceJsonFormatter(LambdaPowertoolsFormatter):
    """Powertools formatter that writes `trace_id`, `span_id`, `trace_flags`, `msg` and `time`.

    The default Powertools names (`message`, `timestamp`, `service`, `xray_trace_id`) do not match
    the repository log fields. This formatter renames them and writes `level` in lower case.
    The trace fields come from the active span.
    Values under secret or personal data keys (`password`, `authorization`, `set-cookie`,
    `access_token`, `api_key`, and others) are replaced with `[REDACTED]`, down to four levels.
    A log line written outside a span has no trace fields.
    """

    def serialize(self, log: LogRecord) -> str:
        """Rename the keys, add the trace fields, and serialize to JSON.

        Args:
            log: The structured log record built by Powertools.

        Returns:
            One JSON object as a string.
        """
        record: dict[str, object] = {}
        for key, value in log.items():
            if key not in _DROPPED_KEYS:
                record[_RENAMED_KEYS.get(key, key)] = (
                    REDACTED_TEXT if _is_secret_key(key) else redact(value)
                )
        level = str(record.get("level", "info"))
        record["level"] = _LEVEL_NAMES.get(level, level.lower())
        context = trace.get_current_span().get_span_context()
        if context.is_valid:
            record["trace_id"] = f"{context.trace_id:032x}"
            record["span_id"] = f"{context.span_id:016x}"
            record["trace_flags"] = f"{int(context.trace_flags):02x}"
        return super().serialize(record)


def build_logger(settings: Settings, stream: TextIO | None = None) -> Logger:
    """Create the Powertools logger.

    Powertools registers one standard logger for each service name. A second call with the same
    service name reuses the first handler and ignores `stream`. Use `redirect_logger` to move
    the output.

    Args:
        settings: The validated settings.
        stream: Where to write. Defaults to standard output.

    Returns:
        The logger.
    """
    return Logger(
        service=settings.service_name,
        level=settings.log_level,
        stream=stream,
        logger_formatter=TraceJsonFormatter(use_rfc3339=True, utc=True),
    )


def redirect_logger(logger: Logger, stream: TextIO) -> None:
    """Send the output of a logger to another stream. Tests use it to capture log lines.

    Args:
        logger: A logger from `build_logger`.
        stream: The new stream.

    Raises:
        TypeError: The logger handler does not write to a stream.
    """
    handler = logger.registered_handler
    if not isinstance(handler, logging.StreamHandler):
        message = "The logger handler is not a stream handler."
        raise TypeError(message)
    handler.setStream(stream)
