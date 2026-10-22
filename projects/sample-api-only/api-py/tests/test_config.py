import pytest

from sample_api.config import load_settings


def test_defaults() -> None:
    settings = load_settings({})
    assert (settings.host, settings.port, settings.log_level) == ("127.0.0.1", 3000, "INFO")
    assert settings.otlp_endpoint is None
    assert settings.sample_ratio == 1.0


def test_prod_samples_one_trace_in_ten_by_default() -> None:
    settings = load_settings({"SAMPLE_API_ONLY_API_PY_ENVIRONMENT": "prod"})
    assert settings.sample_ratio == 0.1


def test_an_explicit_ratio_wins_in_prod() -> None:
    settings = load_settings(
        {"SAMPLE_API_ONLY_API_PY_ENVIRONMENT": "prod", "OTEL_TRACES_SAMPLER_ARG": "0.5"},
    )
    assert settings.sample_ratio == 0.5


def test_an_empty_ratio_counts_as_unset() -> None:
    assert load_settings({"OTEL_TRACES_SAMPLER_ARG": ""}).sample_ratio == 1.0
    prod = {"SAMPLE_API_ONLY_API_PY_ENVIRONMENT": "prod", "OTEL_TRACES_SAMPLER_ARG": " "}
    assert load_settings(prod).sample_ratio == 0.1


def test_reads_overrides() -> None:
    settings = load_settings(
        {
            "SAMPLE_API_ONLY_API_PY_PORT": "0",
            "SAMPLE_API_ONLY_API_PY_LOG_LEVEL": "warning",
            "SAMPLE_API_ONLY_API_PY_VERSION": "1.2.3",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
            "OTEL_TRACES_SAMPLER_ARG": "0.1",
        },
    )
    assert settings.port == 0
    assert settings.log_level == "WARNING"
    assert settings.service_version == "1.2.3"
    assert settings.otlp_endpoint == "http://localhost:4318"
    assert settings.sample_ratio == 0.1


@pytest.mark.parametrize(
    "environ",
    [
        {"SAMPLE_API_ONLY_API_PY_PORT": "70000"},
        {"SAMPLE_API_ONLY_API_PY_LOG_LEVEL": "loud"},
        {"OTEL_TRACES_SAMPLER_ARG": "2"},
    ],
)
def test_rejects_invalid_values(environ: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="must be"):
        load_settings(environ)
