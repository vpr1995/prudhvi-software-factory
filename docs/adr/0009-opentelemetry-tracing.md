# ADR 0009: OpenTelemetry for end-to-end tracing and log correlation

- Status: Accepted
- Date: 2026-10-22

## Context

One user action crosses the browser, the Next.js server, an API Lambda, and AWS services. A bug report gives a request id. Without a shared trace id, an engineer must match logs by time. The API can run in TypeScript, Python, or Go. Each language needs the same log fields and the same trace behavior. The team uses open-source tools and AWS services (ADR 0004, ADR 0006).

## Decision

- Use OpenTelemetry in all parts. Use W3C Trace Context (`traceparent`) and baggage between hops.
- Add the shared package `packages/telemetry` (`@vprprudhvi/shared-telemetry`). It has `initTelemetry`, `withSpan`, and `getTraceContext`. Only this package imports the OpenTelemetry SDK. A lint rule enforces this.
- `@vprprudhvi/shared-logger` adds `trace_id`, `span_id`, and `trace_flags` to each log line. Python and Go use the same field names through mapping code in each part.
- Web: Next.js `instrumentation.ts` registers telemetry. A client component that calls the API adds `traceparent` through a browser entry of `shared-telemetry`. Browser spans are not exported.
- API (TypeScript): `@fastify/otel` names route spans `<METHOD> <route>`. Error spans record the exception. The response echoes `traceparent`. The error envelope `requestId` is the trace id.
- API (Python and Go): use the OpenTelemetry SDK with the instrumentation for each language. Do not use the Powertools Tracer. A custom Powertools formatter (Python) and a `slog` handler (Go) write the log field names.
- Lambda: the shared Lambda construct adds the ADOT collector-only Lambda layer and sets `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_PROPAGATORS=tracecontext,baggage,xray`, `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, and `OTEL_TRACES_SAMPLER_ARG` (1.0 in non-prod, 0.1 in prod). `AWS_LAMBDA_EXEC_WRAPPER` is not set. Export goes to X-Ray and CloudWatch. Lambda active tracing is on. The API is an API Gateway HTTP API. It has no X-Ray support, and it forwards `traceparent` in `event.headers`.
- Context in Lambda: `wrapLambdaHandler` in `shared-telemetry` extracts `traceparent`, sets the response `traceparent`, and flushes spans before the Lambda freezes.
- Sampling: 100% in non-prod. In prod, 10% with a parent-based head sampler.
- Local: Docker Compose runs Jaeger. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
- The rules, field names, and gates are in `docs/standards/observability.md`.

## Consequences

- Positive: One id finds the browser span, the server span, the API span, and every log line.
- Positive: The same log fields work in TypeScript, Python, and Go.
- Positive: The lint rule keeps SDK choices in one package.
- Negative: Each Lambda gains a layer. Cold starts grow a little.
- Negative: Prod sampling is head based. The Lambda layer cannot keep all error traces. Tail sampling needs a central collector. That design is open and a human owns it.
- Negative: The browser SDK adds bundle size. Sample the browser calls.
- Open: The gates (lint, Opengrep, tests, CDK assertions) are planned. Each part needs the tests listed in `docs/standards/observability.md`, section 11.
