package config_test

import (
	"errors"
	"log/slog"
	"testing"

	"github.com/vprprudhvi/sample/api-go/internal/config"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := config.Load(env(nil))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 3000 || cfg.LogLevel != slog.LevelInfo {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	if cfg.OTLPEndpoint != "" || cfg.SampleRatio != 1 || cfg.OnLambda {
		t.Errorf("unexpected telemetry defaults: %+v", cfg)
	}
}

func TestLoadSampleRatioDefaultsByEnvironment(t *testing.T) {
	tests := []struct {
		name   string
		values map[string]string
		want   float64
	}{
		{"local keeps every trace", map[string]string{}, 1},
		{"prod keeps one in ten", map[string]string{"SAMPLE_API_GO_ENVIRONMENT": "prod"}, 0.1},
		{"explicit ratio wins in prod", map[string]string{
			"SAMPLE_API_GO_ENVIRONMENT": "prod", "OTEL_TRACES_SAMPLER_ARG": "0.5",
		}, 0.5},
		{"blank ratio counts as unset in prod", map[string]string{
			"SAMPLE_API_GO_ENVIRONMENT": "prod", "OTEL_TRACES_SAMPLER_ARG": " ",
		}, 0.1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := config.Load(env(tt.values))
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if cfg.SampleRatio != tt.want {
				t.Errorf("SampleRatio = %v, want %v", cfg.SampleRatio, tt.want)
			}
		})
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"SAMPLE_API_GO_PORT":          "0",
		"SAMPLE_API_GO_LOG_LEVEL":     "warn",
		"SAMPLE_API_GO_VERSION":       "1.2.3",
		"OTEL_EXPORTER_OTLP_ENDPOINT": " http://localhost:4318 ",
		"OTEL_TRACES_SAMPLER_ARG":     "0.25",
		"AWS_LAMBDA_RUNTIME_API":      "127.0.0.1:9001",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Port != 0 || cfg.LogLevel != slog.LevelWarn || cfg.ServiceVersion != "1.2.3" {
		t.Errorf("unexpected values: %+v", cfg)
	}
	if cfg.OTLPEndpoint != "http://localhost:4318" || cfg.SampleRatio != 0.25 || !cfg.OnLambda {
		t.Errorf("unexpected telemetry values: %+v", cfg)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
	}{
		{"port is not a number", map[string]string{"SAMPLE_API_GO_PORT": "abc"}},
		{"port is too large", map[string]string{"SAMPLE_API_GO_PORT": "70000"}},
		{"level is unknown", map[string]string{"SAMPLE_API_GO_LOG_LEVEL": "loud"}},
		{"ratio is above one", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "2"}},
		{"ratio is not a number", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "x"}},
		{"ratio is NaN", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "NaN"}},
		{"ratio is positive infinity", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "+Inf"}},
		{"ratio is negative", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "-1"}},
		{"ratio is one and a half", map[string]string{"OTEL_TRACES_SAMPLER_ARG": "1.5"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := config.Load(env(tt.env)); !errors.Is(err, config.ErrInvalid) {
				t.Errorf("Load() error = %v, want ErrInvalid", err)
			}
		})
	}
}
