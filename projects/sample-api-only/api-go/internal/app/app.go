// Package app builds the service and runs it on Lambda or as a local HTTP server.
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/config"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/logging"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/notes"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/server"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/telemetry"

	"github.com/aws/aws-lambda-go/events"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	readHeaderTimeout = 5 * time.Second
	shutdownTimeout   = 5 * time.Second
)

// Runtime is the wired service. Build it once per cold start.
type Runtime struct {
	Config   config.Config
	Logger   *slog.Logger
	Handler  http.Handler
	provider *sdktrace.TracerProvider
}

// Build wires telemetry, logger, store and routes. Logs go to logOutput.
func Build(ctx context.Context, cfg config.Config, logOutput io.Writer) (*Runtime, error) {
	provider, err := telemetry.Init(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("init telemetry: %w", err)
	}
	logger := logging.New(logOutput, cfg)
	handler := server.New(server.Deps{
		Config: cfg,
		Logger: logger,
		Store:  notes.NewMemoryStore(),
		Tracer: provider,
	})
	return &Runtime{Config: cfg, Logger: logger, Handler: handler, provider: provider}, nil
}

// Shutdown flushes and stops the tracer provider.
func (r *Runtime) Shutdown(ctx context.Context) error {
	if err := r.provider.Shutdown(ctx); err != nil {
		return fmt.Errorf("shut down tracer provider: %w", err)
	}
	return nil
}

// LambdaHandler returns the handler for API Gateway HTTP API (payload format 2.0).
// It flushes the spans before it returns, because Lambda can freeze the process after that.
func (r *Runtime) LambdaHandler() func(context.Context, events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	adapter := httpadapter.NewV2(r.Handler)
	return func(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
		response, err := adapter.ProxyWithContext(ctx, request)
		if flushErr := r.provider.ForceFlush(ctx); flushErr != nil {
			r.Logger.ErrorContext(ctx, "flush spans failed", "error", flushErr.Error())
		}
		if err != nil {
			return response, fmt.Errorf("proxy request: %w", err)
		}
		return response, nil
	}
}

// Serve serves HTTP on the listener until ctx ends, then shuts down gracefully.
func (r *Runtime) Serve(ctx context.Context, listener net.Listener) error {
	srv := &http.Server{Handler: r.Handler, ReadHeaderTimeout: readHeaderTimeout}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(listener) }()
	select {
	case err := <-done:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shut down server: %w", err)
	}
	if err := <-done; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}
