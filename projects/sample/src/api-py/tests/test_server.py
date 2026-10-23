import http.client
import json

from sample_api.runtime import build_runtime
from sample_api.server import make_server, run_in_thread


def test_local_server_serves_the_routes_with_a_traceparent() -> None:
    environ = {"SAMPLE_API_PY_PORT": "0", "SAMPLE_API_PY_LOG_LEVEL": "ERROR"}
    server = make_server(build_runtime(environ))
    run_in_thread(server)
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    try:
        connection.request("GET", "/v1/health")
        health = connection.getresponse()
        assert health.status == 200
        assert (health.getheader("traceparent") or "").startswith("00-")
        assert json.loads(health.read())["status"] == "ok"

        connection.request(
            "POST",
            "/v1/notes",
            body=b'{"title": "From the server"}',
            headers={"content-type": "application/json"},
        )
        created = connection.getresponse()
        assert created.status == 201
        created.read()
    finally:
        connection.close()
        server.shutdown()
        server.server_close()
