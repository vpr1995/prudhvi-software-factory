package apierror_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vprprudhvi/sample/api-go/internal/apierror"
	"github.com/vprprudhvi/sample/api-go/internal/gen"
)

func TestWriteSendsTheEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", http.NoBody)

	apierror.Write(rec, req, http.StatusConflict, "SOME_CODE", "some message")

	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != apierror.ContentTypeJSON {
		t.Errorf("content type = %q", got)
	}
	var envelope gen.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "SOME_CODE" || envelope.Error.Message != "some message" {
		t.Errorf("unexpected envelope: %+v", envelope)
	}
	if envelope.Error.RequestId != "" {
		t.Errorf("requestId = %q, want empty without a span", envelope.Error.RequestId)
	}
}
