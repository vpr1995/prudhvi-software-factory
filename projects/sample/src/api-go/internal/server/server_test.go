package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/vprprudhvi/sample/api-go/internal/config"
	"github.com/vprprudhvi/sample/api-go/internal/gen"
	"github.com/vprprudhvi/sample/api-go/internal/logging"
	"github.com/vprprudhvi/sample/api-go/internal/notes"
	"github.com/vprprudhvi/sample/api-go/internal/server"
	"github.com/vprprudhvi/sample/api-go/internal/telemetry"
)

const (
	incomingTraceID     = "4bf92f3577b34da6a3ce929d0e0e4736"
	incomingTraceparent = "00-" + incomingTraceID + "-00f067aa0ba902b7-01"
)

var traceparentPattern = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$`)

type panicStore struct{}

func (panicStore) List(context.Context) ([]gen.Note, error) { panic("boom") }
func (panicStore) Add(context.Context, gen.Note) error      { return nil }

type fixture struct {
	handler http.Handler
	logs    *bytes.Buffer
}

func newFixture(t *testing.T, store notes.Store) fixture {
	t.Helper()
	cfg, err := config.Load(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	provider, err := telemetry.Init(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	logs := &bytes.Buffer{}
	return fixture{
		handler: server.New(server.Deps{
			Config: cfg, Logger: logging.New(logs, cfg), Store: store, Tracer: provider,
		}),
		logs: logs,
	}
}

func (f fixture) do(method, path, body, traceparent string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if traceparent != "" {
		req.Header.Set("traceparent", traceparent)
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func (f fixture) logRecords(t *testing.T) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(f.logs.String()), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line is not JSON: %q", line)
		}
		records = append(records, record)
	}
	return records
}

func traceIDOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	match := traceparentPattern.FindStringSubmatch(rec.Header().Get("traceparent"))
	if match == nil {
		t.Fatalf("traceparent header = %q", rec.Header().Get("traceparent"))
	}
	return match[1]
}

func errorEnvelope(t *testing.T, rec *httptest.ResponseRecorder) gen.ErrorEnvelope {
	t.Helper()
	var envelope gen.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestRoutes(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"health", http.MethodGet, "/v1/health", "", http.StatusOK, ""},
		{"list notes", http.MethodGet, "/v1/notes", "", http.StatusOK, ""},
		{"create note", http.MethodPost, "/v1/notes", `{"title":"a"}`, http.StatusCreated, ""},
		{"invalid note", http.MethodPost, "/v1/notes", `{"title":""}`, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"unknown path", http.MethodGet, "/nope", "", http.StatusNotFound, "NOT_FOUND"},
		{"wrong method", http.MethodPost, "/v1/health", "", http.StatusNotFound, "NOT_FOUND"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := newFixture(t, notes.NewMemoryStore()).do(tt.method, tt.path, tt.body, "")
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.wantStatus, rec.Body)
			}
			if tt.wantCode != "" && errorEnvelope(t, rec).Error.Code != tt.wantCode {
				t.Errorf("code = %s, want %s", rec.Body, tt.wantCode)
			}
		})
	}
}

func TestTraceIDLandsInTheLogRecordAndTheResponseHeader(t *testing.T) {
	f := newFixture(t, notes.NewMemoryStore())

	rec := f.do(http.MethodGet, "/v1/notes", "", "")

	traceID := traceIDOf(t, rec)
	records := f.logRecords(t)
	if len(records) == 0 {
		t.Fatal("the request wrote no log line")
	}
	for _, record := range records {
		if record["trace_id"] != traceID {
			t.Errorf("log trace_id = %v, want %s", record["trace_id"], traceID)
		}
		if _, ok := record["span_id"].(string); !ok {
			t.Errorf("log record has no span_id: %v", record)
		}
	}
}

func TestIncomingTraceparentIsContinued(t *testing.T) {
	f := newFixture(t, notes.NewMemoryStore())

	rec := f.do(http.MethodGet, "/v1/notes", "", incomingTraceparent)

	if got := traceIDOf(t, rec); got != incomingTraceID {
		t.Errorf("response trace id = %s, want %s", got, incomingTraceID)
	}
	for _, record := range f.logRecords(t) {
		if record["trace_id"] != incomingTraceID {
			t.Errorf("log trace_id = %v, want %s", record["trace_id"], incomingTraceID)
		}
	}
}

func TestErrorEnvelopeRequestIDIsTheTraceID(t *testing.T) {
	rec := newFixture(t, notes.NewMemoryStore()).do(http.MethodPost, "/v1/notes", `{"title":""}`, "")

	if got := errorEnvelope(t, rec).Error.RequestId; got != traceIDOf(t, rec) {
		t.Errorf("requestId = %s, want the trace id %s", got, traceIDOf(t, rec))
	}
}

func TestEveryResponseHasATraceparent(t *testing.T) {
	f := newFixture(t, notes.NewMemoryStore())
	for _, path := range []string{"/v1/health", "/v1/notes", "/missing"} {
		traceIDOf(t, f.do(http.MethodGet, path, "", ""))
	}
}

func TestAPanicReturnsAGeneric500WithTheTraceID(t *testing.T) {
	f := newFixture(t, panicStore{})

	rec := f.do(http.MethodGet, "/v1/notes", "", "")

	if rec.Code != http.StatusInternalServerError || errorEnvelope(t, rec).Error.Code != "INTERNAL_ERROR" {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Error("the response leaks the panic text")
	}
	var panicRecord map[string]any
	for _, record := range f.logRecords(t) {
		if record["msg"] == "request panicked" {
			panicRecord = record
		}
	}
	if panicRecord == nil || panicRecord["level"] != "error" || panicRecord["trace_id"] != traceIDOf(t, rec) {
		t.Errorf("panic log record = %v", panicRecord)
	}
}
