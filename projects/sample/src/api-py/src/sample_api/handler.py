"""The AWS Lambda entry point: `sample_api.handler.lambda_handler`."""

import os

from sample_api.runtime import build_runtime

_RUNTIME = build_runtime(os.environ)

lambda_handler = _RUNTIME.handle
