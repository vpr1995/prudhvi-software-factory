// Package telemetry sets up OpenTelemetry tracing and the W3C traceparent header.
package telemetry

import (
	"context"
	"fmt"
	"strings"

	"github.com/vprprudhvi/sample/api-go/internal/config"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// Propagator returns the W3C trace context and baggage propagator.
func Propagator() propagation.TextMapPropagator {
	return propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{})
}

// Init creates the tracer provider. Spans export only when an OTLP endpoint is set.
// The provider is not installed as the global provider. Callers take a tracer from it.
// The sampler follows the parent decision and samples new traces by the configured ratio.
func Init(ctx context.Context, cfg config.Config) (*sdktrace.TracerProvider, error) {
	res := resource.NewSchemaless(
		attribute.String("service.name", cfg.ServiceName),
		attribute.String("service.version", cfg.ServiceVersion),
		attribute.String("deployment.environment", cfg.Environment),
	)
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(cfg.SampleRatio))),
	}
	if cfg.OTLPEndpoint != "" {
		endpoint := strings.TrimRight(cfg.OTLPEndpoint, "/") + "/v1/traces"
		exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint))
		if err != nil {
			return nil, fmt.Errorf("create OTLP exporter: %w", err)
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}
	return sdktrace.NewTracerProvider(options...), nil
}

// FormatTraceparent formats a span context as a W3C traceparent header value.
func FormatTraceparent(sc trace.SpanContext) string {
	return fmt.Sprintf("00-%s-%s-%02x", sc.TraceID(), sc.SpanID(), byte(sc.TraceFlags()))
}
