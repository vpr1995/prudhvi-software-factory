"""Health of the service."""

from sample_api.generated.models import Health


def build_health(service_name: str, service_version: str) -> Health:
    """Build the health response.

    Args:
        service_name: The name of the service.
        service_version: The version of the build.

    Returns:
        The health response with status `ok`.
    """
    return Health(status="ok", service=service_name, version=service_version)
