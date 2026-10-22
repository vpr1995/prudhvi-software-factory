// Package config reads the settings of the service. It is the only package that reads the environment.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
)

// ServiceName is the service.name of logs and traces.
const ServiceName = "sample-api-only-api-go"

const (
	prefix         = "SAMPLE_API_ONLY_API_GO_"
	defaultPort    = 3000
	maxPort        = 65535
	defaultHost    = "127.0.0.1"
	defaultVersion = "0.0.0"
	defaultEnv     = "local"
	prodEnv        = "prod"

	defaultSampleRatio = 1.0
	prodSampleRatio    = 0.1
)

// Config holds the validated settings.
type Config struct {
	ServiceName    string
	ServiceVersion string
	Environment    string
	Host           string
	Port           int
	LogLevel       slog.Level
	// OTLPEndpoint is the OTLP/HTTP base URL. Empty means no span export.
	OTLPEndpoint string
	// SampleRatio is the share of new traces to sample, from 0 to 1.
	SampleRatio float64
	// OnLambda is true when the process runs inside the Lambda runtime.
	OnLambda bool
}

// ErrInvalid marks a setting that is not valid.
var ErrInvalid = errors.New("invalid setting")

// Load reads and validates the settings.
// getenv returns the value of an environment variable, or an empty string.
func Load(getenv func(string) string) (Config, error) {
	port, err := parsePort(getenv(prefix + "PORT"))
	if err != nil {
		return Config{}, err
	}
	level, err := parseLevel(getenv(prefix + "LOG_LEVEL"))
	if err != nil {
		return Config{}, err
	}
	environment := valueOr(getenv(prefix+"ENVIRONMENT"), defaultEnv)
	ratio, err := parseRatio(getenv("OTEL_TRACES_SAMPLER_ARG"), environment)
	if err != nil {
		return Config{}, err
	}
	return Config{
		ServiceName:    ServiceName,
		ServiceVersion: valueOr(getenv(prefix+"VERSION"), defaultVersion),
		Environment:    environment,
		Host:           valueOr(getenv(prefix+"HOST"), defaultHost),
		Port:           port,
		LogLevel:       level,
		OTLPEndpoint:   strings.TrimSpace(getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
		SampleRatio:    ratio,
		OnLambda:       getenv("AWS_LAMBDA_RUNTIME_API") != "",
	}, nil
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func parsePort(raw string) (int, error) {
	if raw == "" {
		return defaultPort, nil
	}
	port, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%w: %sPORT: %w", ErrInvalid, prefix, err)
	}
	if port < 0 || port > maxPort {
		return 0, fmt.Errorf("%w: %sPORT must be between 0 and %d", ErrInvalid, prefix, maxPort)
	}
	return port, nil
}

func parseLevel(raw string) (slog.Level, error) {
	if raw == "" {
		return slog.LevelInfo, nil
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(raw)); err != nil {
		return 0, fmt.Errorf("%w: %sLOG_LEVEL: %w", ErrInvalid, prefix, err)
	}
	return level, nil
}

// parseRatio reads the sample ratio. When it is unset the default is every trace outside prod and
// one trace in ten in prod, the same defaults as packages/telemetry.
func parseRatio(raw, environment string) (float64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if environment == prodEnv {
			return prodSampleRatio, nil
		}
		return defaultSampleRatio, nil
	}
	ratio, err := strconv.ParseFloat(raw, 64)
	if err != nil || ratio < 0 || ratio > 1 {
		return 0, fmt.Errorf("%w: OTEL_TRACES_SAMPLER_ARG must be between 0 and 1", ErrInvalid)
	}
	return ratio, nil
}
