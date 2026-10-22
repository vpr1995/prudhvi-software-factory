package notes_test

import (
	"context"
	"testing"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/notes"
)

func TestMemoryStoreReturnsACopy(t *testing.T) {
	store := notes.NewMemoryStore()
	if err := store.Add(context.Background(), gen.Note{Title: "a"}); err != nil {
		t.Fatal(err)
	}
	first, err := store.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	first[0].Title = "changed"

	second, _ := store.List(context.Background())

	if second[0].Title != "a" {
		t.Errorf("the store shares its slice: %q", second[0].Title)
	}
}
