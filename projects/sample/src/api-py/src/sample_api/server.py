"""A local HTTP server for development and e2e. It turns each request into an HTTP API v2 event."""

import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from aws_lambda_powertools.utilities.typing import LambdaContext

from sample_api.runtime import LambdaEvent, Runtime

_MAX_BODY_BYTES = 1_000_000
_STAGE = "$default"


@dataclass(frozen=True, slots=True)
class RawRequest:
    """One HTTP request as the local server reads it.

    Attributes:
        method: The HTTP method.
        target: The request target, path and query.
        headers: The request headers with lower-case names.
        body: The request body.
    """

    method: str
    target: str
    headers: dict[str, str]
    body: str


def build_event(request: RawRequest) -> LambdaEvent:
    """Build an API Gateway HTTP API v2 event.

    Args:
        request: The raw HTTP request.

    Returns:
        The event.
    """
    parts = urlsplit(request.target)
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": parts.path,
        "rawQueryString": parts.query,
        "headers": request.headers,
        "requestContext": {
            "stage": _STAGE,
            "requestId": "local",
            "http": {
                "method": request.method,
                "path": parts.path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": request.headers.get("user-agent", ""),
            },
        },
        "body": request.body,
        "isBase64Encoded": False,
    }


def make_server(runtime: Runtime) -> ThreadingHTTPServer:
    """Create the server. Call `serve_forever` to run it.

    It binds the host and the port from the settings of the runtime.

    Args:
        runtime: The wired service.

    Returns:
        The server. `server.server_address[1]` holds the port.
    """
    context = LambdaContext()
    handler = runtime.handle
    logger = runtime.logger

    class RequestHandler(BaseHTTPRequestHandler):
        """Adapts one HTTP request to one Lambda invocation."""

        def _respond(self) -> None:
            length = min(int(self.headers.get("content-length") or 0), _MAX_BODY_BYTES)
            body = self.rfile.read(length).decode("utf-8") if length else ""
            headers = {name.lower(): value for name, value in self.headers.items()}
            event = build_event(RawRequest(self.command, self.path, headers, body))
            response = handler(event, context)
            payload = str(response.get("body") or "").encode("utf-8")
            self.send_response(int(str(response["statusCode"])))
            raw_headers = response.get("headers")
            if isinstance(raw_headers, dict):
                for name, value in raw_headers.items():
                    self.send_header(str(name), str(value))
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:
            """Handle a GET request."""
            self._respond()

        def do_POST(self) -> None:
            """Handle a POST request."""
            self._respond()

        def log_message(self, format: str, *args: object) -> None:
            """Send the default access log to the debug level. The app logs each request."""
            logger.debug("http server", detail=format % args)

    return ThreadingHTTPServer((runtime.settings.host, runtime.settings.port), RequestHandler)


def run_in_thread(server: ThreadingHTTPServer) -> threading.Thread:
    """Run the server in a daemon thread.

    Args:
        server: The server from `make_server`.

    Returns:
        The started thread.
    """
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread
