"""Run the local server: `python -m sample_api`."""

import os

from sample_api.runtime import build_runtime
from sample_api.server import make_server


def main() -> None:
    """Start the local server and block until it stops."""
    runtime = build_runtime(os.environ)
    server = make_server(runtime)
    runtime.logger.info("server listening", port=server.server_address[1])
    try:
        server.serve_forever()
    finally:
        server.server_close()
        runtime.provider.shutdown()


main()
