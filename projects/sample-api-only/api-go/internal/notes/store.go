package notes

import (
	"context"
	"slices"
	"sync"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"
)

// Store is where notes live. A real project swaps it for a database adapter.
type Store interface {
	List(ctx context.Context) ([]gen.Note, error)
	Add(ctx context.Context, note gen.Note) error
}

// MemoryStore keeps notes in memory. Lambda keeps the data only while the container lives.
type MemoryStore struct {
	mu    sync.Mutex
	notes []gen.Note
}

// NewMemoryStore creates an empty store.
func NewMemoryStore() *MemoryStore { return &MemoryStore{} }

// List returns a copy of the stored notes.
func (s *MemoryStore) List(_ context.Context) ([]gen.Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.notes), nil
}

// Add stores a note.
func (s *MemoryStore) Add(_ context.Context, note gen.Note) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notes = append(s.notes, note)
	return nil
}
