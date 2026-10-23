"""Settings of the service. This is the only module that reads the environment."""

from collections.abc import Mapping
from dataclasses import dataclass

SERVICE_NAME = "sample-api-py"

_PREFIX = "SAMPLE_API_PY_"
_DEFAULT_PORT = 3000
_MAX_PORT = 65_535
_DEFAULT_HOST = "127.0.0.1"
_DEFAULT_VERSION = "0.0.0"
_DEFAULT_ENVIRONMENT = "local"
_PROD_ENVIRONMENT = "prod"
_DEFAULT_SAMPLE_RATIO = 1.0
_PROD_SAMPLE_RATIO = 0.1
_DEFAULT_LOG_LEVEL = "INFO"
_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


@dataclass(frozen=True, slots=True)
class Settings:
    """Validated settings.

    Attributes:
        service_name: The `service.name` of logs and traces.
        service_version: The version of the deployed build.
        environment: The deployment environment, for example `local` or `prod`.
        host: The host of the local server.
        port: The port of the local server. 0 means any free port.
        log_level: The Python log level name.
        otlp_endpoint: The OTLP/HTTP base URL. `None` means no span export.
        sample_ratio: The share of new traces to sample, from 0 to 1.
    """

    service_name: str
    service_version: str
    environment: str
    host: str
    port: int
    log_level: str
    otlp_endpoint: str | None
    sample_ratio: float


def load_settings(environ: Mapping[str, str]) -> Settings:
    """Read and validate the settings.

    Args:
        environ: The environment variables.

    Returns:
        The validated settings.

    Raises:
        ValueError: A value is not valid.
    """
    port = int(environ.get(f"{_PREFIX}PORT", str(_DEFAULT_PORT)))
    if not 0 <= port <= _MAX_PORT:
        message = f"{_PREFIX}PORT must be between 0 and {_MAX_PORT}."
        raise ValueError(message)
    log_level = environ.get(f"{_PREFIX}LOG_LEVEL", _DEFAULT_LOG_LEVEL).upper()
    if log_level not in _LOG_LEVELS:
        message = f"{_PREFIX}LOG_LEVEL must be one of {sorted(_LOG_LEVELS)}."
        raise ValueError(message)
    environment = environ.get(f"{_PREFIX}ENVIRONMENT", _DEFAULT_ENVIRONMENT)
    # Same defaults as packages/telemetry: all traces outside prod, one in ten in prod.
    is_prod = environment == _PROD_ENVIRONMENT
    default_ratio = _PROD_SAMPLE_RATIO if is_prod else _DEFAULT_SAMPLE_RATIO
    raw_ratio = environ.get("OTEL_TRACES_SAMPLER_ARG", "").strip()
    sample_ratio = float(raw_ratio) if raw_ratio else default_ratio
    if not 0.0 <= sample_ratio <= 1.0:
        message = "OTEL_TRACES_SAMPLER_ARG must be between 0 and 1."
        raise ValueError(message)
    endpoint = environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    return Settings(
        service_name=SERVICE_NAME,
        service_version=environ.get(f"{_PREFIX}VERSION", _DEFAULT_VERSION),
        environment=environment,
        host=environ.get(f"{_PREFIX}HOST", _DEFAULT_HOST),
        port=port,
        log_level=log_level,
        otlp_endpoint=endpoint or None,
        sample_ratio=sample_ratio,
    )
