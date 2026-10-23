package logging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"

	"github.com/vprprudhvi/sample/api-go/internal/config"
	"github.com/vprprudhvi/sample/api-go/internal/logging"
)

const (
	traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	spanID  = "00f067aa0ba902b7"
)

func spanContext(t *testing.T) context.Context {
	t.Helper()
	tid, err := trace.TraceIDFromHex(traceID)
	if err != nil {
		t.Fatal(err)
	}
	sid, err := trace.SpanIDFromHex(spanID)
	if err != nil {
		t.Fatal(err)
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled,
	})
	return trace.ContextWithSpanContext(context.Background(), sc)
}

func record(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	var fields map[string]any
	if err := json.Unmarshal(buf.Bytes(), &fields); err != nil {
		t.Fatalf("log line is not JSON: %v: %q", err, buf.String())
	}
	return fields
}

func TestLogRecordHasTheTraceID(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf, config.Config{ServiceName: "svc", LogLevel: slog.LevelInfo})
	logger.InfoContext(spanContext(t), "order exported", "order_id", "o-1")

	fields := record(t, &buf)
	want := map[string]any{
		"trace_id":     traceID,
		"span_id":      spanID,
		"trace_flags":  "01",
		"service.name": "svc",
		"level":        "info",
		"msg":          "order exported",
		"order_id":     "o-1",
	}
	for key, value := range want {
		if fields[key] != value {
			t.Errorf("field %q = %v, want %v", key, fields[key], value)
		}
	}
	if !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T`).MatchString(fields["time"].(string)) {
		t.Errorf("time = %v, want an ISO 8601 time stamp", fields["time"])
	}
}

func TestLogRecordWithoutASpanHasNoTraceFields(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf, config.Config{ServiceName: "svc", LogLevel: slog.LevelInfo})
	logger.InfoContext(context.Background(), "no span")
	if strings.Contains(buf.String(), "trace_id") {
		t.Errorf("log line has a trace id outside a span: %s", buf.String())
	}
}

func TestLevelsAreLowerCase(t *testing.T) {
	tests := []struct {
		name  string
		log   func(*slog.Logger)
		level string
	}{
		{"debug", func(l *slog.Logger) { l.Debug("m") }, "debug"},
		{"warn", func(l *slog.Logger) { l.Warn("m") }, "warn"},
		{"error", func(l *slog.Logger) { l.Error("m") }, "error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := logging.New(&buf, config.Config{ServiceName: "svc", LogLevel: slog.LevelDebug})
			tt.log(logger)
			if got := record(t, &buf)["level"]; got != tt.level {
				t.Errorf("level = %v, want %s", got, tt.level)
			}
		})
	}
}

func TestWithGroupAndAttrsKeepTheTraceFields(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf, config.Config{ServiceName: "svc", LogLevel: slog.LevelInfo})
	logger.With("component", "x").WithGroup("g").InfoContext(spanContext(t), "m", "k", "v")
	if !strings.Contains(buf.String(), traceID) {
		t.Errorf("trace id is missing: %s", buf.String())
	}
}
