package telemetry_test

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/trace"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/config"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/telemetry"
)

func TestFormatTraceparent(t *testing.T) {
	traceID, _ := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	spanID, _ := trace.SpanIDFromHex("00f067aa0ba902b7")
	sc := trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled})

	got := telemetry.FormatTraceparent(sc)

	if want := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"; got != want {
		t.Errorf("FormatTraceparent() = %q, want %q", got, want)
	}
}

func TestInitCreatesAProviderWithAndWithoutAnEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
	}{
		{"without an endpoint", ""},
		{"with an endpoint", "http://127.0.0.1:1/"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, err := telemetry.Init(context.Background(), config.Config{
				ServiceName: "svc", SampleRatio: 1, OTLPEndpoint: tt.endpoint,
			})
			if err != nil {
				t.Fatalf("Init() error = %v", err)
			}
			if err := provider.Shutdown(context.Background()); err != nil {
				t.Errorf("Shutdown() error = %v", err)
			}
		})
	}
}

func TestPropagatorUsesTraceContextAndBaggage(t *testing.T) {
	if got := telemetry.Propagator().Fields(); len(got) != 3 {
		t.Errorf("Fields() = %v, want traceparent, tracestate and baggage", got)
	}
}
