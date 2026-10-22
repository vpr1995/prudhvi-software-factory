// Package notes holds the rules, the storage and the handlers of the notes resource.
package notes

import (
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"

	"github.com/google/uuid"
)

// Limits of the contract and of the service.
const (
	MaxNotes       = 100
	maxTitleLength = 120
	maxBodyLength  = 2000
)

// Error codes. They are UPPER_SNAKE_CASE, as in the error envelope.
const (
	CodeValidation   = "VALIDATION_ERROR"
	CodeTitleTaken   = "NOTE_TITLE_TAKEN"
	CodeLimitReached = "NOTE_LIMIT_REACHED"
)

// Error is an expected failure of a note rule.
type Error struct {
	Code    string
	Message string
}

// Error returns the message.
func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Stamp holds the values that the caller creates, so Create stays a pure function.
type Stamp struct {
	ID  uuid.UUID
	Now time.Time
}

// Create applies the rules for a new note. It returns an *Error for an expected failure.
func Create(request gen.CreateNote, existing []gen.Note, stamp Stamp) (gen.Note, error) {
	title := strings.TrimSpace(request.Title)
	body := ""
	if request.Body != nil {
		body = *request.Body
	}
	if n := utf8.RuneCountInString(title); n < 1 || n > maxTitleLength || utf8.RuneCountInString(body) > maxBodyLength {
		return gen.Note{}, &Error{Code: CodeValidation, Message: "The request is not valid."}
	}
	if len(existing) >= MaxNotes {
		return gen.Note{}, &Error{Code: CodeLimitReached, Message: "The service stores at most 100 notes."}
	}
	key := strings.ToLower(title)
	if slices.ContainsFunc(existing, func(note gen.Note) bool { return strings.ToLower(note.Title) == key }) {
		return gen.Note{}, &Error{Code: CodeTitleTaken, Message: "A note with this title exists."}
	}
	return gen.Note{Id: stamp.ID, Title: title, Body: body, CreatedAt: stamp.Now}, nil
}

// Sort returns the notes ordered by creation time, oldest first. It does not change the input.
func Sort(notes []gen.Note) []gen.Note {
	sorted := slices.Clone(notes)
	slices.SortStableFunc(sorted, func(a, b gen.Note) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return sorted
}

// AsError returns the *Error inside err, if any.
func AsError(err error) (*Error, bool) {
	var noteErr *Error
	if errors.As(err, &noteErr) {
		return noteErr, true
	}
	return nil, false
}
