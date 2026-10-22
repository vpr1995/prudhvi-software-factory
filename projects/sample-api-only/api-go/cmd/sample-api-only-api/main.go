// Command sample-api-only-api is the Go API of sample-api-only.
// It runs as an AWS Lambda function (provided.al2023) or, outside Lambda, as a local HTTP server.
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/app"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/config"

	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	runtime, err := app.Build(ctx, cfg, os.Stdout)
	if err != nil {
		return fmt.Errorf("build service: %w", err)
	}
	defer func() { _ = runtime.Shutdown(context.WithoutCancel(ctx)) }()

	if cfg.OnLambda {
		lambda.Start(runtime.LambdaHandler())
		return nil
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	runtime.Logger.InfoContext(ctx, "server listening", "addr", listener.Addr().String())
	return runtime.Serve(ctx, listener)
}
