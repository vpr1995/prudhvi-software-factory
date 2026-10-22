// Package logging builds the JSON logger with the field names of docs/standards/observability.md.
package logging

import (
	"context"
	"io"
	"log/slog"
	"strings"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/config"

	"go.opentelemetry.io/otel/trace"
)

// traceHandler adds trace_id, span_id and trace_flags of the active span to each record.
type traceHandler struct {
	slog.Handler
}

// Handle adds the trace fields. A record written outside a span gets no trace fields.
func (h traceHandler) Handle(ctx context.Context, record slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		record.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
			slog.String("trace_flags", sc.TraceFlags().String()),
		)
	}
	return h.Handler.Handle(ctx, record)
}

// WithAttrs keeps the trace handler around the inner handler.
func (h traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return traceHandler{Handler: h.Handler.WithAttrs(attrs)}
}

// WithGroup keeps the trace handler around the inner handler.
func (h traceHandler) WithGroup(name string) slog.Handler {
	return traceHandler{Handler: h.Handler.WithGroup(name)}
}

// replaceAttr writes level in lower case.
func replaceAttr(groups []string, attr slog.Attr) slog.Attr {
	if len(groups) == 0 && attr.Key == slog.LevelKey {
		if level, ok := attr.Value.Any().(slog.Level); ok {
			return slog.String(slog.LevelKey, strings.ToLower(level.String()))
		}
	}
	return attr
}

// New creates the logger. It writes one JSON object per line to w.
// Use the Context variants of the logger methods (InfoContext) so the trace fields are added.
func New(w io.Writer, cfg config.Config) *slog.Logger {
	inner := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       cfg.LogLevel,
		ReplaceAttr: replaceAttr,
	})
	return slog.New(traceHandler{Handler: inner}).With("service.name", cfg.ServiceName)
}
