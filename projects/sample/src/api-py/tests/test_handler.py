from aws_lambda_powertools.utilities.typing import LambdaContext

from sample_api.handler import lambda_handler
from sample_api.server import RawRequest, build_event


def test_lambda_handler_answers_an_api_gateway_event() -> None:
    response = lambda_handler(build_event(RawRequest("GET", "/v1/health", {}, "")), LambdaContext())
    assert response["statusCode"] == 200
