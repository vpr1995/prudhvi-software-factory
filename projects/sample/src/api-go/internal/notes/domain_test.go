package notes_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/vprprudhvi/sample/api-go/internal/gen"
	"github.com/vprprudhvi/sample/api-go/internal/notes"
)

var now = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func stamp() notes.Stamp { return notes.Stamp{ID: uuid.New(), Now: now} }

func titled(title string) gen.Note { return gen.Note{Title: title, CreatedAt: now} }

func many(count int) []gen.Note {
	out := make([]gen.Note, count)
	for i := range out {
		out[i] = titled(fmt.Sprintf("Note %d", i))
	}
	return out
}

func ptr(s string) *string { return &s }

func TestCreate(t *testing.T) {
	tests := []struct {
		name     string
		request  gen.CreateNote
		existing []gen.Note
		wantCode string
		wantNote string
	}{
		{name: "trims the title", request: gen.CreateNote{Title: "  Hi  "}, wantNote: "Hi"},
		{name: "keeps the body", request: gen.CreateNote{Title: "a", Body: ptr("text")}, wantNote: "a"},
		{name: "rejects an empty title", request: gen.CreateNote{Title: ""}, wantCode: notes.CodeValidation},
		{name: "rejects a blank title", request: gen.CreateNote{Title: "   "}, wantCode: notes.CodeValidation},
		{
			name:     "rejects a long title",
			request:  gen.CreateNote{Title: strings.Repeat("a", 121)},
			wantCode: notes.CodeValidation,
		},
		{
			name:     "rejects a long body",
			request:  gen.CreateNote{Title: "a", Body: ptr(strings.Repeat("b", 2001))},
			wantCode: notes.CodeValidation,
		},
		{
			name:     "rejects a duplicate title ignoring case",
			request:  gen.CreateNote{Title: "hi"},
			existing: []gen.Note{titled("HI")},
			wantCode: notes.CodeTitleTaken,
		},
		{
			name:     "rejects when the limit is reached",
			request:  gen.CreateNote{Title: "new"},
			existing: many(notes.MaxNotes),
			wantCode: notes.CodeLimitReached,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			note, err := notes.Create(tt.request, tt.existing, stamp())
			if tt.wantCode != "" {
				noteErr, ok := notes.AsError(err)
				if !ok || noteErr.Code != tt.wantCode {
					t.Fatalf("Create() error = %v, want code %s", err, tt.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if note.Title != tt.wantNote {
				t.Errorf("title = %q, want %q", note.Title, tt.wantNote)
			}
		})
	}
}

func TestAsErrorIgnoresOtherErrors(t *testing.T) {
	if _, ok := notes.AsError(fmt.Errorf("plain")); ok {
		t.Error("AsError() = true for a plain error")
	}
	if got := (&notes.Error{Code: "X", Message: "m"}).Error(); got != "X: m" {
		t.Errorf("Error() = %q", got)
	}
}

func TestSortOrdersOldestFirstWithoutChangingTheInput(t *testing.T) {
	older := gen.Note{Title: "older", CreatedAt: now.Add(-time.Hour)}
	newer := gen.Note{Title: "newer", CreatedAt: now}
	input := []gen.Note{newer, older}

	got := notes.Sort(input)

	if got[0].Title != "older" || got[1].Title != "newer" {
		t.Errorf("Sort() = %v", got)
	}
	if input[0].Title != "newer" {
		t.Error("Sort() changed its input")
	}
}
