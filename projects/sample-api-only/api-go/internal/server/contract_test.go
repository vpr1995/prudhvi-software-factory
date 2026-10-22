package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/vprprudhvi/sample-api-only/api-go/internal/gen"
	"github.com/vprprudhvi/sample-api-only/api-go/internal/notes"
)

const openAPIPath = "../../../contracts/dist/openapi.json"

// TestEveryRouteOfTheContractIsImplemented reads the OpenAPI document of the contracts package.
func TestEveryRouteOfTheContractIsImplemented(t *testing.T) {
	raw, err := os.ReadFile(filepath.FromSlash(openAPIPath))
	if err != nil {
		t.Fatalf("read the contract (build the contracts package first): %v", err)
	}
	var document struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Paths) == 0 {
		t.Fatal("the contract has no paths")
	}
	f := newFixture(t, notes.NewMemoryStore())
	for path, methods := range document.Paths {
		for method := range methods {
			t.Run(strings.ToUpper(method)+" "+path, func(t *testing.T) {
				body := ""
				if strings.EqualFold(method, http.MethodPost) {
					body = "{}"
				}
				rec := f.do(strings.ToUpper(method), path, body, "")
				if rec.Code == http.StatusNotFound || rec.Code >= http.StatusInternalServerError {
					t.Errorf("status = %d: %s", rec.Code, rec.Body)
				}
			})
		}
	}
}

func TestGeneratedTypesRoundTrip(t *testing.T) {
	note := `{"id":"` + uuid.NewString() + `","title":"t","body":"b","createdAt":"2026-01-01T00:00:00Z"}`
	tests := []struct {
		name  string
		input string
		into  any
	}{
		{"Note", note, &gen.Note{}},
		{"ListNotesResponse", `{"notes":[` + note + `]}`, &gen.ListNotesResponse{}},
		{"Health", `{"status":"ok","service":"s","version":"1"}`, &gen.Health{}},
		{"CreateNote", `{"title":"t","body":"b"}`, &gen.CreateNote{}},
		{"ErrorEnvelope", `{"error":{"code":"C","message":"m","requestId":"r"}}`, &gen.ErrorEnvelope{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(tt.input), tt.into); err != nil {
				t.Fatalf("Unmarshal() error = %v", err)
			}
			out, err := json.Marshal(tt.into)
			if err != nil {
				t.Fatal(err)
			}
			var want, got any
			_ = json.Unmarshal([]byte(tt.input), &want)
			_ = json.Unmarshal(out, &got)
			if !jsonEqual(want, got) {
				t.Errorf("round trip changed the value: %s -> %s", tt.input, out)
			}
		})
	}
}

func jsonEqual(a, b any) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return string(left) == string(right)
}

func loadDocument(t *testing.T) schema {
	t.Helper()
	raw, err := os.ReadFile(filepath.FromSlash(openAPIPath))
	if err != nil {
		t.Fatalf("read the contract (build the contracts package first): %v", err)
	}
	var document schema
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

// responseSchema returns the JSON schema of one documented response.
func responseSchema(t *testing.T, document schema, method, path, status string) schema {
	t.Helper()
	paths, _ := document["paths"].(map[string]any)
	methods, _ := paths[path].(map[string]any)
	operation, _ := methods[strings.ToLower(method)].(map[string]any)
	responses, _ := operation["responses"].(map[string]any)
	response, _ := responses[status].(map[string]any)
	content, _ := response["content"].(map[string]any)
	media, _ := content["application/json"].(map[string]any)
	found, ok := media["schema"].(map[string]any)
	if !ok {
		t.Fatalf("the contract has no JSON schema for %s %s %s", method, path, status)
	}
	return found
}

// decodeStrict decodes a body into a generated type and rejects fields that the type lacks.
func decodeStrict(t *testing.T, body []byte, into any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		t.Fatalf("the body does not fit the generated type: %v: %s", err, body)
	}
}

type scenario struct {
	method, path, status string
	run                  func(f fixture) *httptest.ResponseRecorder
	into                 func() any
}

func TestEveryDocumentedResponseHasAScenarioThatFitsTheSchemaAndTheGeneratedType(t *testing.T) {
	document := loadDocument(t)
	const valid = `{"title":"First"}`
	scenarios := []scenario{
		{http.MethodGet, "/v1/health", "200", func(f fixture) *httptest.ResponseRecorder {
			return f.do(http.MethodGet, "/v1/health", "", "")
		}, func() any { return &gen.Health{} }},
		{http.MethodGet, "/v1/notes", "200", func(f fixture) *httptest.ResponseRecorder {
			f.do(http.MethodPost, "/v1/notes", valid, "")
			return f.do(http.MethodGet, "/v1/notes", "", "")
		}, func() any { return &gen.ListNotesResponse{} }},
		{http.MethodPost, "/v1/notes", "201", func(f fixture) *httptest.ResponseRecorder {
			return f.do(http.MethodPost, "/v1/notes", valid, "")
		}, func() any { return &gen.Note{} }},
		{http.MethodPost, "/v1/notes", "400", func(f fixture) *httptest.ResponseRecorder {
			return f.do(http.MethodPost, "/v1/notes", `{"title":""}`, "")
		}, func() any { return &gen.ErrorEnvelope{} }},
		{http.MethodPost, "/v1/notes", "409", func(f fixture) *httptest.ResponseRecorder {
			f.do(http.MethodPost, "/v1/notes", valid, "")
			return f.do(http.MethodPost, "/v1/notes", valid, "")
		}, func() any { return &gen.ErrorEnvelope{} }},
	}

	covered := map[string]bool{}
	for _, sc := range scenarios {
		covered[sc.method+" "+sc.path+" "+sc.status] = true
		t.Run(sc.method+" "+sc.path+" "+sc.status, func(t *testing.T) {
			rec := sc.run(newFixture(t, notes.NewMemoryStore()))
			if strconv.Itoa(rec.Code) != sc.status {
				t.Fatalf("status = %d, want %s: %s", rec.Code, sc.status, rec.Body)
			}
			var decoded any
			if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
				t.Fatal(err)
			}
			if problems := validate(document, responseSchema(t, document, sc.method, sc.path, sc.status), decoded); len(problems) > 0 {
				t.Errorf("the body does not fit the schema: %v: %s", problems, rec.Body)
			}
			decodeStrict(t, rec.Body.Bytes(), sc.into())
		})
	}

	paths, _ := document["paths"].(map[string]any)
	for path, methods := range paths {
		for method, operation := range methods.(map[string]any) {
			responses, _ := operation.(map[string]any)["responses"].(map[string]any)
			for status := range responses {
				if key := strings.ToUpper(method) + " " + path + " " + status; !covered[key] {
					t.Errorf("the contract documents %s but no scenario causes it", key)
				}
			}
		}
	}
}

func TestTheCheckerFindsAWrongBody(t *testing.T) {
	document := loadDocument(t)
	note := schema{"$ref": "#/components/schemas/Note"}
	wrong := map[string]any{"id": "x", "title": "", "body": 5.0, "createdAt": "yesterday"}

	if problems := validate(document, note, wrong); len(problems) < 4 {
		t.Errorf("problems = %v, want at least 4", problems)
	}
	if problems := validate(document, note, map[string]any{}); len(problems) == 0 {
		t.Error("an empty object fits the Note schema")
	}
}

type createCase struct {
	Name   string `json:"name"`
	Raw    string `json:"raw"`
	Status int    `json:"status"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

// TestCreateNoteEdgeCasesAgreeWithTheContract runs the cases that contracts and api-py run too.
func TestCreateNoteEdgeCasesAgreeWithTheContract(t *testing.T) {
	document := loadDocument(t)
	raw, err := os.ReadFile(filepath.FromSlash("../../../contracts/fixtures/create-note-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtureFile struct {
		Cases []createCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixtureFile); err != nil {
		t.Fatal(err)
	}
	if len(fixtureFile.Cases) == 0 {
		t.Fatal("the fixture has no cases")
	}
	for _, tt := range fixtureFile.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			rec := newFixture(t, notes.NewMemoryStore()).do(http.MethodPost, "/v1/notes", tt.Raw, "")
			if rec.Code != tt.Status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.Status, rec.Body)
			}
			var decoded map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
				t.Fatal(err)
			}
			status := strconv.Itoa(tt.Status)
			if problems := validate(document, responseSchema(t, document, http.MethodPost, "/v1/notes", status), decoded); len(problems) > 0 {
				t.Errorf("the body does not fit the schema: %v: %s", problems, rec.Body)
			}
			if tt.Status == http.StatusCreated && (decoded["title"] != tt.Title || decoded["body"] != tt.Body) {
				t.Errorf("stored title and body = %q and %q, want %q and %q", decoded["title"], decoded["body"], tt.Title, tt.Body)
			}
		})
	}
}
