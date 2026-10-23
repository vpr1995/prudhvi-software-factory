// Package apierror writes the error envelope: {"error": {"code", "message", "requestId"}}.
package apierror

import (
	"encoding/json"
	"net/http"

	"github.com/vprprudhvi/sample/api-go/internal/gen"

	"go.opentelemetry.io/otel/trace"
)

// ContentTypeJSON is the content type of every response body.
const ContentTypeJSON = "application/json"

// Write sends the error envelope. requestId is the trace id of the request.
func Write(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	var envelope gen.ErrorEnvelope
	envelope.Error.Code = code
	envelope.Error.Message = message
	if sc := trace.SpanContextFromContext(r.Context()); sc.IsValid() {
		envelope.Error.RequestId = sc.TraceID().String()
	}
	WriteJSON(w, status, envelope)
}

// WriteJSON sends a JSON body with a status.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", ContentTypeJSON)
	w.WriteHeader(status)
	// The status is sent already. An encode error means the client is gone, so nothing is left to do.
	_ = json.NewEncoder(w).Encode(body)
}
