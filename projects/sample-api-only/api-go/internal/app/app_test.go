package app_test

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/app"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/config"
)

func build(t *testing.T) (*app.Runtime, *bytes.Buffer) {
	t.Helper()
	cfg, err := config.Load(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	logs := &bytes.Buffer{}
	runtime, err := app.Build(context.Background(), cfg, logs)
	if err != nil {
		t.Fatal(err)
	}
	return runtime, logs
}

func TestLambdaHandlerAnswersAnAPIGatewayEvent(t *testing.T) {
	runtime, logs := build(t)
	const traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	request := events.APIGatewayV2HTTPRequest{
		RawPath: "/v1/health",
		Headers: map[string]string{"traceparent": "00-" + traceID + "-00f067aa0ba902b7-01"},
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: http.MethodGet, Path: "/v1/health"},
		},
	}

	response, err := runtime.LambdaHandler()(context.Background(), request)
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Errorf("status = %d, body = %s", response.StatusCode, response.Body)
	}
	if !strings.Contains(response.Headers["Traceparent"], traceID) {
		t.Errorf("traceparent header = %v", response.Headers)
	}
	if !strings.Contains(logs.String(), traceID) {
		t.Errorf("log lines do not carry the incoming trace id: %s", logs.String())
	}
}

func TestServeAnswersRequestsAndStopsWhenTheContextEnds(t *testing.T) {
	runtime, _ := build(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runtime.Serve(ctx, listener) }()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+listener.Addr().String()+"/v1/health", http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d", resp.StatusCode)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Serve() error = %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Serve() did not stop")
	}
	if err := runtime.Shutdown(context.Background()); err != nil {
		t.Errorf("Shutdown() error = %v", err)
	}
}

func TestServeReturnsAnErrorWhenTheListenerFails(t *testing.T) {
	runtime, _ := build(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_ = listener.Close()

	if err := runtime.Serve(context.Background(), listener); err == nil {
		t.Error("Serve() on a closed listener returned no error")
	}
}
