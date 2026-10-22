package health_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/health"
)

func TestHandlerReturnsServiceAndVersion(t *testing.T) {
	rec := httptest.NewRecorder()
	health.Handler("svc", "1.2.3")(rec, httptest.NewRequest(http.MethodGet, "/v1/health", http.NoBody))

	var got gen.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := gen.Health{Status: gen.Ok, Service: "svc", Version: "1.2.3"}
	if rec.Code != http.StatusOK || got != want {
		t.Errorf("got %d %+v, want 200 %+v", rec.Code, got, want)
	}
}
