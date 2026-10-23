package notes

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/vprprudhvi/sample/api-go/internal/apierror"
	"github.com/vprprudhvi/sample/api-go/internal/gen"

	"github.com/google/uuid"
)

const maxRequestBytes = 1 << 20

var (
	errTrailingData = errors.New("unexpected data after the JSON object")
	errNullBody     = errors.New("body must be a string or missing, not null")
)

// Handler serves GET and POST /v1/notes.
type Handler struct {
	Store  Store
	Logger *slog.Logger
	// Now and NewID are set by NewHandler. Tests replace them.
	Now   func() time.Time
	NewID func() uuid.UUID
}

// NewHandler creates the handler with the real clock and id source.
func NewHandler(store Store, logger *slog.Logger) *Handler {
	return &Handler{Store: store, Logger: logger, Now: time.Now, NewID: uuid.New}
}

// List handles GET /v1/notes.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	stored, err := h.Store.List(r.Context())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	sorted := Sort(stored)
	h.Logger.InfoContext(r.Context(), "notes listed", "count", len(sorted))
	apierror.WriteJSON(w, http.StatusOK, gen.ListNotesResponse{Notes: sorted})
}

// Create handles POST /v1/notes.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	request, err := decodeCreate(r.Body)
	if err != nil {
		h.reject(w, r, &Error{Code: CodeValidation, Message: "The request is not valid."})
		return
	}
	existing, err := h.Store.List(r.Context())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	note, err := Create(request, existing, Stamp{ID: h.NewID(), Now: h.Now().UTC()})
	if err != nil {
		if noteErr, ok := AsError(err); ok {
			h.reject(w, r, noteErr)
			return
		}
		h.fail(w, r, err)
		return
	}
	if err := h.Store.Add(r.Context(), note); err != nil {
		h.fail(w, r, err)
		return
	}
	h.Logger.InfoContext(r.Context(), "note created", "note_id", note.Id.String())
	apierror.WriteJSON(w, http.StatusCreated, note)
}

// decodeCreate reads one JSON object. It rejects unknown fields, trailing data and a null body.
// The generated type holds the body as a pointer, so it cannot tell a null from a missing field.
// The contract allows a missing body only, so the raw fields are checked too.
func decodeCreate(body io.Reader) (gen.CreateNote, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxRequestBytes))
	if err != nil {
		return gen.CreateNote{}, fmt.Errorf("read create note: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var request gen.CreateNote
	if err := decoder.Decode(&request); err != nil {
		return gen.CreateNote{}, fmt.Errorf("decode create note: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return gen.CreateNote{}, errTrailingData
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return gen.CreateNote{}, fmt.Errorf("decode create note fields: %w", err)
	}
	if value, present := fields["body"]; present && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return gen.CreateNote{}, errNullBody
	}
	return request, nil
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request, noteErr *Error) {
	h.Logger.InfoContext(r.Context(), "note rejected", "code", noteErr.Code)
	status := http.StatusConflict
	if noteErr.Code == CodeValidation {
		status = http.StatusBadRequest
	}
	apierror.Write(w, r, status, noteErr.Code, noteErr.Message)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.Logger.ErrorContext(r.Context(), "request failed", "error", err.Error())
	apierror.Write(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "The service failed. Try again later.")
}
