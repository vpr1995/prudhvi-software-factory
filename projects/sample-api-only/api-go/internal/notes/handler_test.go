package notes_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/notes"
)

var errStorage = errors.New("storage is down")

type brokenStore struct {
	listErr error
	addErr  error
}

func (s brokenStore) List(context.Context) ([]gen.Note, error) { return nil, s.listErr }
func (s brokenStore) Add(context.Context, gen.Note) error      { return s.addErr }

func newHandler(store notes.Store) *notes.Handler {
	handler := notes.NewHandler(store, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	handler.Now = func() time.Time { return now }
	handler.NewID = uuid.New
	return handler
}

func do(t *testing.T, handler http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(method, "/v1/notes", strings.NewReader(body)))
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var envelope gen.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Error.Code
}

func TestCreateThenList(t *testing.T) {
	handler := newHandler(notes.NewMemoryStore())

	created := do(t, handler.Create, http.MethodPost, `{"title":"  First ","body":"text"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", created.Code, created.Body)
	}
	listed := do(t, handler.List, http.MethodGet, "")
	var response gen.ListNotesResponse
	if err := json.Unmarshal(listed.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if listed.Code != http.StatusOK || len(response.Notes) != 1 || response.Notes[0].Title != "First" {
		t.Errorf("list = %d %+v", listed.Code, response)
	}
}

func TestCreateErrors(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"empty title", `{"title":""}`, http.StatusBadRequest, notes.CodeValidation},
		{"missing title", `{}`, http.StatusBadRequest, notes.CodeValidation},
		{"not JSON", `nope`, http.StatusBadRequest, notes.CodeValidation},
		{"empty body", ``, http.StatusBadRequest, notes.CodeValidation},
		{"unknown field", `{"title":"a","extra":1}`, http.StatusBadRequest, notes.CodeValidation},
		{"wrong type", `{"title":5}`, http.StatusBadRequest, notes.CodeValidation},
		{"null body", `{"title":"a","body":null}`, http.StatusBadRequest, notes.CodeValidation},
		{"null title", `{"title":null}`, http.StatusBadRequest, notes.CodeValidation},
		{"JSON null", `null`, http.StatusBadRequest, notes.CodeValidation},
		{"trailing data", `{"title":"a"} {"title":"b"}`, http.StatusBadRequest, notes.CodeValidation},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, newHandler(notes.NewMemoryStore()).Create, http.MethodPost, tt.body)
			if rec.Code != tt.wantStatus || errorCode(t, rec) != tt.wantCode {
				t.Errorf("got %d %s, want %d %s", rec.Code, rec.Body, tt.wantStatus, tt.wantCode)
			}
		})
	}
}

func TestCreateConflict(t *testing.T) {
	handler := newHandler(notes.NewMemoryStore())
	do(t, handler.Create, http.MethodPost, `{"title":"Same"}`)

	rec := do(t, handler.Create, http.MethodPost, `{"title":"SAME"}`)

	if rec.Code != http.StatusConflict || errorCode(t, rec) != notes.CodeTitleTaken {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}

func TestStoreFailuresReturnAGeneric500(t *testing.T) {
	tests := []struct {
		name    string
		store   notes.Store
		handler func(*notes.Handler) http.HandlerFunc
		method  string
		body    string
	}{
		{"list fails on list", brokenStore{listErr: errStorage}, func(h *notes.Handler) http.HandlerFunc { return h.List }, http.MethodGet, ""},
		{"create fails on list", brokenStore{listErr: errStorage}, func(h *notes.Handler) http.HandlerFunc { return h.Create }, http.MethodPost, `{"title":"a"}`},
		{"create fails on add", brokenStore{addErr: errStorage}, func(h *notes.Handler) http.HandlerFunc { return h.Create }, http.MethodPost, `{"title":"a"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, tt.handler(newHandler(tt.store)), tt.method, tt.body)
			if rec.Code != http.StatusInternalServerError || errorCode(t, rec) != "INTERNAL_ERROR" {
				t.Errorf("got %d %s", rec.Code, rec.Body)
			}
			if strings.Contains(rec.Body.String(), "storage is down") {
				t.Error("the response leaks the error text")
			}
		})
	}
}
