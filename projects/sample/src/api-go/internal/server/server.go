// Package server wires the routes and the middleware into one http.Handler.
package server

import (
	"log/slog"
	"net/http"

	"github.com/vprprudhvi/sample/api-go/internal/apierror"
	"github.com/vprprudhvi/sample/api-go/internal/config"
	"github.com/vprprudhvi/sample/api-go/internal/health"
	"github.com/vprprudhvi/sample/api-go/internal/notes"
	"github.com/vprprudhvi/sample/api-go/internal/telemetry"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const traceparentHeader = "traceparent"

// routes are the route templates. A span of a known route is named "<METHOD> <path>".
var routes = map[string]struct{}{
	"GET /v1/health": {},
	"GET /v1/notes":  {},
	"POST /v1/notes": {},
}

// Deps is what New needs from the outside.
type Deps struct {
	Config config.Config
	Logger *slog.Logger
	Store  notes.Store
	Tracer trace.TracerProvider
}

// New builds the handler: tracing, traceparent echo, request log, panic recovery, then the routes.
func New(deps Deps) http.Handler {
	notesHandler := notes.NewHandler(deps.Store, deps.Logger)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", health.Handler(deps.Config.ServiceName, deps.Config.ServiceVersion))
	mux.HandleFunc("GET /v1/notes", notesHandler.List)
	mux.HandleFunc("POST /v1/notes", notesHandler.Create)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		apierror.Write(w, r, http.StatusNotFound, "NOT_FOUND", "The route does not exist.")
	})

	var handler http.Handler = mux
	handler = recoverPanics(deps.Logger, handler)
	handler = echoTraceparent(handler)
	handler = logRequests(deps.Logger, handler)
	return otelhttp.NewHandler(handler, "http.server",
		otelhttp.WithTracerProvider(deps.Tracer),
		otelhttp.WithPropagators(telemetry.Propagator()),
		otelhttp.WithSpanNameFormatter(spanName),
	)
}

// spanName names a server span "<METHOD> <route template>". Unknown paths share one name,
// so the span name has a bounded set of values.
func spanName(_ string, r *http.Request) string {
	key := r.Method + " " + r.URL.Path
	if _, known := routes[key]; known {
		return key
	}
	return r.Method + " unmatched"
}

// statusRecorder remembers the status code of a response.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

// Unwrap lets http.ResponseController reach the inner writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// echoTraceparent sets the response header traceparent from the active span.
func echoTraceparent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sc := trace.SpanContextFromContext(r.Context()); sc.IsValid() {
			w.Header().Set(traceparentHeader, telemetry.FormatTraceparent(sc))
		}
		next.ServeHTTP(w, r)
	})
}

// logRequests writes one "request completed" line for each request and marks 5xx spans as errors.
func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		if recorder.status >= http.StatusInternalServerError {
			trace.SpanFromContext(r.Context()).SetStatus(codes.Error, "server error")
		}
		logger.InfoContext(r.Context(), "request completed",
			"http_method", r.Method, "status_code", recorder.status)
	})
}

// recoverPanics turns a panic into a 500 error envelope. A handler does not panic on purpose.
func recoverPanics(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(r.Context(), "request panicked", "panic", recovered)
				trace.SpanFromContext(r.Context()).SetStatus(codes.Error, "panic")
				apierror.Write(w, r, http.StatusInternalServerError, "INTERNAL_ERROR",
					"The service failed. Try again later.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
